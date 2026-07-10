package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserSession
import mu.carfection.pos.core.network.PinSessionDto
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Auth + device identity. RLS ties every query to the logged-in user's tenant. */
@Singleton
class SessionRepository @Inject constructor(
    private val client: SupabaseClient,
    private val prefs: DataStore<Preferences>,
) {
    private val deviceKey = stringPreferencesKey("device_id")
    private val opNameKey = stringPreferencesKey("op_name")
    private val opRoleKey = stringPreferencesKey("op_role")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        // Restore the operator identity persisted at last login, so a process restart shows the
        // right name/role even when the post-login metadata refresh had failed (importSession keeps
        // user=null, so currentUser metadata would otherwise be blank → generic "Staff"/"POS").
        scope.launch {
            val p = prefs.data.first()
            if (opName == null) opName = p[opNameKey]
            if (opRole == null) opRole = p[opRoleKey]
        }
    }

    /** null = still restoring; true/false = known. */
    val isLoggedIn: Flow<Boolean?> = client.auth.sessionStatus.map { status ->
        when (status) {
            is SessionStatus.Initializing -> null
            is SessionStatus.Authenticated -> true
            else -> false
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

    /** Display name (e.g. "Rakesh (Owner)" → "Rakesh") for the header staff chip. */
    val userName: String
        get() = (opName ?: meta("display_name") ?: userEmail?.substringBefore("@") ?: "Staff")
            .replace(Regex("\\s*\\(.*\\)\\s*$"), "").trim()

    val userRole: String
        get() = (opRole ?: meta("role"))?.replaceFirstChar { it.uppercase() } ?: "POS"

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
        // Durably remember who signed in — the metadata refresh below can fail on a flaky link and
        // isn't retried, so this is what a restart falls back to (see the init block).
        runCatching { prefs.edit { it[opNameKey] = s.operator.displayName; it[opRoleKey] = s.operator.role } }
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

    suspend fun signOut() {
        opName = null; opRole = null
        runCatching { prefs.edit { it.remove(opNameKey); it.remove(opRoleKey) } }
        client.auth.signOut()
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
