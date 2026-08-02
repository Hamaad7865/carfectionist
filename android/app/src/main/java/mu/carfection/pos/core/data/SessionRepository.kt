package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import mu.carfection.pos.core.network.PinSessionDto
import mu.carfection.pos.core.network.RosterEntry
import mu.carfection.pos.core.sync.OnlineSignal
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auth + device identity. RLS ties every query to the logged-in user's tenant.
 *
 * Two layers, deliberately distinct since offline sign-in arrived:
 *
 *  - the SUPABASE SESSION — the device's transport credentials, minted only by the server
 *    at an online sign-in. Every API write rides it, including the offline-sale replay.
 *  - the OPERATOR — who is standing at the till. Online the two coincide (a PIN login
 *    mints a session for that person). Offline they cannot: no server, no new session.
 *    So an offline unlock verifies the PIN locally ([OfflinePinStore]) and sets only the
 *    operator layer, while the device's LAST online session stays cached for the queue.
 *
 * Which is why signing out while offline must not call the real sign-out: destroying the
 * cached session wouldn't just log someone out, it would strand every held sale with no
 * credentials to replay under. Offline, the staff chip LOCKS the operator instead.
 */
@Singleton
class SessionRepository @Inject constructor(
    private val client: SupabaseClient,
    private val prefs: DataStore<Preferences>,
    private val connectivity: OnlineSignal,
) {
    private val deviceKey = stringPreferencesKey("device_id")
    private val opNameKey = stringPreferencesKey("op_name")
    private val opRoleKey = stringPreferencesKey("op_role")
    private val opIdKey = stringPreferencesKey("op_id")
    private val opOfflineKey = booleanPreferencesKey("op_offline_unlocked")
    private val opLockedKey = booleanPreferencesKey("op_locked")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** True when the current operator was admitted by the LOCAL verifier, not the server. */
    private val offlineUnlocked = MutableStateFlow(false)

    /**
     * True when the operator layer is locked (switch-cashier while offline). Overrides a
     * still-alive Supabase session: the tokens stay cached for the sale queue, but nobody
     * is signed in at the counter until a PIN admits them again.
     */
    private val operatorLocked = MutableStateFlow(false)

    init {
        // Restore the operator identity persisted at last login, so a process restart shows the
        // right name/role even when the post-login metadata refresh had failed (importSession keeps
        // user=null, so currentUser metadata would otherwise be blank → generic "Staff"/"POS").
        // The offline/locked flags restore with it: a tablet that dies mid-outage comes back
        // in the state the operator left it — unlocked stays unlocked, locked stays locked.
        scope.launch {
            val p = prefs.data.first()
            if (opName == null) opName = p[opNameKey]
            if (opRole == null) opRole = p[opRoleKey]
            if (opId == null) opId = p[opIdKey]
            offlineUnlocked.value = p[opOfflineKey] ?: false
            operatorLocked.value = p[opLockedKey] ?: false
        }
    }

    /** null = still restoring; true/false = known. */
    val isLoggedIn: Flow<Boolean?> = combine(
        client.auth.sessionStatus, offlineUnlocked, operatorLocked,
    ) { status, offline, locked ->
        when {
            // A lock outranks everything, including a live session: the tokens are the
            // DEVICE's, the lock is about the PERSON.
            locked -> false
            offline -> true
            else -> when (status) {
                is SessionStatus.Initializing -> null
                is SessionStatus.Authenticated -> true
                // A refresh failure (a network blip on the hourly token refresh) keeps the
                // tokens and retries — it is NOT a sign-out. Collapsing it to false wiped the
                // cashier's in-progress cart mid-sale (audit #8). Only a real NotAuthenticated
                // is a sign-out.
                is SessionStatus.RefreshFailure -> true
                else -> false
            }
        }
    }

    val userEmail: String?
        get() = client.auth.currentUserOrNull()?.email

    private fun meta(key: String): String? =
        (client.auth.currentUserOrNull()?.userMetadata?.get(key) as? JsonPrimitive)?.contentOrNull

    // Operator identity from the PIN-login response, so the header is right from the first frame
    // (importSession flips to Authenticated before the user's metadata finishes loading). Metadata
    // covers the restore-on-restart case, when these are null.
    @Volatile private var opName: String? = null
    @Volatile private var opRole: String? = null
    @Volatile private var opId: String? = null

    /** Display name (e.g. "Rakesh (Owner)" → "Rakesh") for the header staff chip. */
    val userName: String
        get() = (opName ?: meta("display_name") ?: userEmail?.substringBefore("@") ?: "Staff")
            .replace(Regex("\\s*\\(.*\\)\\s*$"), "").trim()

    val userRole: String
        get() = (opRole ?: meta("role"))?.replaceFirstChar { it.uppercase() } ?: "POS"

    /** app_users.id of the operator at the till — who actually rang what the tablet records. */
    val operatorId: String? get() = opId

    suspend fun signIn(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    /**
     * Adopt the session minted by the PIN-login endpoint. The tokens are a normal Supabase session,
     * so RLS and the header name/role (from the user's metadata) work exactly as with a password
     * sign-in; we refresh the user so its metadata is populated and persisted for restarts.
     */
    suspend fun signInWithPin(s: PinSessionDto) {
        opName = s.operator.displayName
        opRole = s.operator.role
        opId = s.operator.appUserId
        offlineUnlocked.value = false // a real session owns the state again
        operatorLocked.value = false
        // Durably remember who signed in — the metadata refresh below can fail on a flaky link and
        // isn't retried, so this is what a restart falls back to (see the init block).
        runCatching {
            prefs.edit {
                it[opNameKey] = s.operator.displayName
                it[opRoleKey] = s.operator.role
                it[opIdKey] = s.operator.appUserId
                it[opOfflineKey] = false
                it[opLockedKey] = false
            }
        }
        val nowSec = System.currentTimeMillis() / 1000
        val expiresIn = ((s.expiresAt ?: (nowSec + 3600)) - nowSec).coerceAtLeast(60)
        client.auth.importSession(
            UserSession(
                accessToken = s.accessToken,
                refreshToken = s.refreshToken,
                expiresIn = expiresIn,
                tokenType = "bearer",
                user = null,
            )
        )
        runCatching { client.auth.retrieveUserForCurrentSession(updateSession = true) }
    }

    /**
     * Admit an operator the LOCAL verifier just accepted — the offline path. No tokens are
     * touched: whatever Supabase session the device last held stays cached, and every write
     * the tablet queues while offline replays under it when the network returns.
     */
    suspend fun signInOffline(operator: RosterEntry) {
        opName = operator.displayName
        opRole = operator.role
        opId = operator.appUserId
        offlineUnlocked.value = true
        operatorLocked.value = false
        runCatching {
            prefs.edit {
                it[opNameKey] = operator.displayName
                it[opRoleKey] = operator.role
                it[opIdKey] = operator.appUserId
                it[opOfflineKey] = true
                it[opLockedKey] = false
            }
        }
    }

    /**
     * The staff chip's action. Online it is a real sign-out. Offline it LOCKS instead:
     * the operator layer clears and the PIN gate comes up, but the device's cached session
     * survives — destroying it would strand every held sale with nothing to replay under.
     */
    suspend fun signOut() {
        opName = null; opRole = null; opId = null
        if (connectivity.online.value) {
            offlineUnlocked.value = false
            operatorLocked.value = false
            runCatching {
                prefs.edit {
                    it.remove(opNameKey); it.remove(opRoleKey); it.remove(opIdKey)
                    it[opOfflineKey] = false; it[opLockedKey] = false
                }
            }
            client.auth.signOut()
        } else {
            offlineUnlocked.value = false
            operatorLocked.value = true
            runCatching {
                prefs.edit {
                    it.remove(opNameKey); it.remove(opRoleKey); it.remove(opIdKey)
                    it[opOfflineKey] = false; it[opLockedKey] = true
                }
            }
        }
    }

    /** Stable per-tablet id for the till (one open session per device). */
    suspend fun deviceId(): String {
        val current = prefs.data.first()[deviceKey]
        if (current != null) return current
        val fresh = "TAB-" + java.util.UUID.randomUUID().toString().take(4).uppercase()
        prefs.edit { it[deviceKey] = fresh }
        return fresh
    }
}
