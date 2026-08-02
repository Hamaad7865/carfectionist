package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mu.carfection.pos.core.network.RosterEntry
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What this tablet remembers so the PIN gate keeps working with no network.
 *
 * Two things are cached, both refreshed on every successful ONLINE interaction:
 *  - the ROSTER (names + roles), so the sign-in tiles still render during an outage;
 *  - one VERIFIER per operator ([PinHasher]), minted at their successful online sign-in,
 *    so their PIN can be checked locally.
 *
 * An operator who has never signed in on this tablet has no verifier and cannot get in
 * offline — deliberately. The server stays the only authority that can admit someone for
 * the first time; this cache only re-admits people it has already seen it admit.
 *
 * Staleness: if a PIN is changed from the web while the tablet is offline, the old PIN
 * keeps unlocking THIS tablet until it next verifies online. The window closes itself:
 * the first ONLINE sign-in attempt with the old PIN is refused by the server, and when
 * the refused PIN matches the cached verifier the verifier is dropped ([noteServerRefusal]).
 */
@Singleton
class OfflinePinStore @Inject constructor(
    private val prefs: DataStore<Preferences>,
) {
    private val verifiersKey = stringPreferencesKey("opin_verifiers")
    private val rosterKey = stringPreferencesKey("opin_roster")
    private val failsKey = stringPreferencesKey("opin_fails")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Serializable
    data class Verifier(
        val appUserId: String,
        val displayName: String,
        val role: String,
        val verifier: String,
        val updatedAt: Long,
    )

    @Serializable
    private data class FailState(val fails: Int = 0, val lastFailAt: Long = 0)

    /** The outcome of an offline PIN check — everything the login screen needs to say. */
    sealed interface Result {
        data class Ok(val operator: RosterEntry) : Result
        data object WrongPin : Result
        data class Locked(val remainingMs: Long) : Result
        /** No verifier for this operator: they have never signed in on this tablet. */
        data object Unknown : Result
    }

    /**
     * Remember a roster the server actually served — the offline sign-in tiles, and now the
     * verifiers riding on them, reconciled by [reconcileVerifiers]. After one sync, every
     * staff member the server can vouch for offline can be admitted by this tablet, whether
     * or not they have ever touched it.
     */
    suspend fun rememberRoster(roster: List<RosterEntry>) {
        if (roster.isEmpty()) return // an empty answer is a failure, not a staff purge
        val now = System.currentTimeMillis()
        prefs.edit { p ->
            // The tiles store no verifiers — those live in one place, the verifier map.
            p[rosterKey] = json.encodeToString(roster.map { it.copy(verifier = null) })
            p[verifiersKey] = json.encodeToString(reconcileVerifiers(loadVerifiers(p), roster, now))
        }
    }

    suspend fun cachedRoster(): List<RosterEntry> =
        prefs.data.first()[rosterKey]?.let { runCatching { json.decodeFromString<List<RosterEntry>>(it) }.getOrNull() }
            ?: emptyList()

    /**
     * The moment of truth for the cache: an ONLINE sign-in just succeeded, so the correct
     * PIN is briefly in hand. Mint the local verifier from it, and clear the fail counter —
     * the server has spoken.
     */
    suspend fun rememberSuccessfulLogin(operator: RosterEntry, pin: String) {
        val minted = Verifier(
            appUserId = operator.appUserId,
            displayName = operator.displayName,
            role = operator.role,
            verifier = PinHasher.hash(pin),
            updatedAt = System.currentTimeMillis(),
        )
        prefs.edit { p ->
            p[verifiersKey] = json.encodeToString(loadVerifiers(p).filter { it.appUserId != operator.appUserId } + minted)
            p[failsKey] = json.encodeToString(loadFails(p) - operator.appUserId)
        }
    }

    /** Check a PIN with no server in reach. Throttled — this replaces the server's lockout. */
    suspend fun verifyOffline(appUserId: String, pin: String, nowMs: Long = System.currentTimeMillis()): Result {
        val p = prefs.data.first()
        val v = loadVerifiers(p).firstOrNull { it.appUserId == appUserId } ?: return Result.Unknown
        val fail = loadFails(p)[appUserId] ?: FailState()
        val wait = PinThrottle.lockRemainingMs(fail.fails, fail.lastFailAt, nowMs)
        if (wait > 0) return Result.Locked(wait)
        return if (PinHasher.verify(pin, v.verifier)) {
            prefs.edit { it[failsKey] = json.encodeToString(loadFails(it) - appUserId) }
            Result.Ok(RosterEntry(v.appUserId, v.displayName, v.role))
        } else {
            prefs.edit {
                it[failsKey] = json.encodeToString(
                    loadFails(it) + (appUserId to FailState(fail.fails + 1, nowMs)),
                )
            }
            Result.WrongPin
        }
    }

    /**
     * The server refused a PIN that the local verifier ACCEPTS: the PIN was changed from
     * the web after this verifier was minted. The server is the authority — drop the stale
     * verifier so the old PIN stops unlocking this tablet.
     */
    suspend fun noteServerRefusal(appUserId: String, refusedPin: String) {
        val v = loadVerifiers(prefs.data.first()).firstOrNull { it.appUserId == appUserId } ?: return
        if (!PinHasher.verify(refusedPin, v.verifier)) return // ordinary typo, verifier still good
        prefs.edit { p ->
            p[verifiersKey] = json.encodeToString(loadVerifiers(p).filter { it.appUserId != appUserId })
        }
    }

    /** Whether this operator could sign in offline right now (the login screen's hint). */
    suspend fun hasVerifier(appUserId: String): Boolean =
        loadVerifiers(prefs.data.first()).any { it.appUserId == appUserId }

    private fun loadVerifiers(p: Preferences): List<Verifier> =
        p[verifiersKey]?.let { runCatching { json.decodeFromString<List<Verifier>>(it) }.getOrNull() } ?: emptyList()

    private fun loadFails(p: Preferences): Map<String, FailState> =
        p[failsKey]?.let { runCatching { json.decodeFromString<Map<String, FailState>>(it) }.getOrNull() } ?: emptyMap()

    companion object {
        /**
         * Fold a server roster into the held verifiers. The server is the authority:
         *
         *  - an entry CARRYING a verifier replaces whatever is held — it reflects the PIN
         *    as the server currently knows it;
         *  - an entry WITHOUT one changes nothing — the server has nothing to say yet, and
         *    a verifier this tablet minted at an online sign-in is still the freshest truth;
         *  - someone absent from the roster loses their verifier — deactivated staff and
         *    cleared PINs must stop unlocking tills the moment a till hears about it.
         */
        fun reconcileVerifiers(held: List<Verifier>, roster: List<RosterEntry>, now: Long): List<Verifier> {
            val byId = roster.associateBy { it.appUserId }
            val kept = held.filter { it.appUserId in byId }
            val replaced = kept.map { h ->
                val server = byId.getValue(h.appUserId)
                val v = server.verifier
                if (v != null) Verifier(server.appUserId, server.displayName, server.role, v, now) else h
            }
            val newlySeeded = roster.filter { r ->
                r.verifier != null && replaced.none { it.appUserId == r.appUserId }
            }.map { Verifier(it.appUserId, it.displayName, it.role, it.verifier!!, now) }
            return replaced + newlySeeded
        }
    }
}
