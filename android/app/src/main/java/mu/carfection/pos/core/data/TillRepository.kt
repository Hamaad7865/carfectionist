package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.feature.till.MethodRow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TillRepository @Inject constructor(
    private val api: PosApi,
    private val session: SessionRepository,
    private val prefs: DataStore<Preferences>,
) {
    /**
     * The device's open session, shared so the checkout's till chip flips the moment the till
     * screen opens or closes one — no stale "Till closed" while a refresh round-trips.
     */
    private val _current = MutableStateFlow<CashSessionDto?>(null)
    val current = _current.asStateFlow()

    /**
     * The last session we KNEW was open on this device, kept on disk.
     *
     * Which till is open is something only the server can be asked, and asking needs a
     * network. Without this cache, a tablet that restarts during an outage comes back not
     * knowing its own till — and since every payment must name one, the counter would
     * refuse to ring anything at all, exactly when offline selling has to work. So the
     * answer is remembered, and cleared the moment the till is actually closed.
     */
    private val cachedSessionKey = stringPreferencesKey("open_cash_session")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private suspend fun remember(s: CashSessionDto?) {
        prefs.edit { p ->
            if (s == null) p.remove(cachedSessionKey) else p[cachedSessionKey] = json.encodeToString(s)
        }
    }

    /** Restore the remembered till at startup, so an offline relaunch can still sell. */
    suspend fun restoreCached(): CashSessionDto? {
        if (_current.value != null) return _current.value
        val raw = prefs.data.first()[cachedSessionKey] ?: return null
        return runCatching { json.decodeFromString<CashSessionDto>(raw) }
            .getOrNull()
            ?.takeIf { it.status == "open" }
            ?.also { _current.value = it }
    }

    /**
     * Ask the server which session is open on this device. Offline this throws, and the
     * caller keeps whatever [restoreCached] recovered — a stale-but-real till beats no till.
     * Online, the server's answer is authoritative in both directions, including "none".
     */
    suspend fun openSession(): CashSessionDto? =
        api.openSessionForDevice(session.deviceId()).also { _current.value = it; remember(it) }

    suspend fun open(openingFloatCents: Long): CashSessionDto =
        api.openCashSession(session.deviceId(), centsToRupees(openingFloatCents))
            .also { _current.value = it; remember(it) }

    suspend fun close(sessionId: String, closingCountCents: Long): CashSessionDto =
        api.closeCashSession(sessionId, centsToRupees(closingCountCents))
            .also { _current.value = null; remember(null) }

    /** Petty cash out of the open till — the server audits it and shrinks the expected drawer cash. */
    suspend fun cashOut(sessionId: String, amountCents: Long, reason: String) =
        api.recordTillCashOut(sessionId, centsToRupees(amountCents), reason, java.util.UUID.randomUUID().toString())

    // ── The Cashmag close ───────────────────────────────────────────────────
    /** "Check your cash register before closing": the rows, the expected drawer, the service no. */
    suspend fun preClose(sessionId: String): Triple<List<MethodRow>, Double, Int> {
        val j = api.preCloseSummary(sessionId)
        fun d(o: JsonObject, k: String) = o[k]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
        val rows = (j["methods"]?.jsonArray ?: JsonArray(emptyList())).map { e ->
            val o = e.jsonObject
            MethodRow(
                method = o["method"]?.jsonPrimitive?.content ?: "cash",
                takings = d(o, "takings"),
                accumulation = d(o, "accumulation"),
            )
        }
        return Triple(
            rows,
            d(j, "expected_cash"),
            j["service_no"]?.jsonPrimitive?.content?.toIntOrNull() ?: 1,
        )
    }

    /** Closes the service, banks the ticked methods, cuts the Z. */
    suspend fun closeService(sessionId: String, countedCash: Double, remit: List<String>, note: String?) =
        api.closeService(sessionId, countedCash, remit, note).also { _current.value = null; remember(null) }

    /** Seals the day — nothing more can be taken until it is reopened. */
    suspend fun closeDay(dayId: String) = api.closeDay(dayId).also { _current.value = null; remember(null) }

    /**
     * Unseals today's day so a late customer can still be served. Owner/manager only.
     * Touches no cached session — the till is still closed afterwards, and opening one
     * is a separate, counted act.
     */
    suspend fun reopenToday(reason: String) = api.reopenToday(reason)
}
