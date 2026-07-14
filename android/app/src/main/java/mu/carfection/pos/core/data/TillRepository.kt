package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
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
) {
    /**
     * The device's open session, shared so the checkout's till chip flips the moment the till
     * screen opens or closes one — no stale "Till closed" while a refresh round-trips.
     */
    private val _current = MutableStateFlow<CashSessionDto?>(null)
    val current = _current.asStateFlow()

    suspend fun openSession(): CashSessionDto? =
        api.openSessionForDevice(session.deviceId()).also { _current.value = it }

    suspend fun open(openingFloatCents: Long): CashSessionDto =
        api.openCashSession(session.deviceId(), centsToRupees(openingFloatCents)).also { _current.value = it }

    suspend fun close(sessionId: String, closingCountCents: Long): CashSessionDto =
        api.closeCashSession(sessionId, centsToRupees(closingCountCents)).also { _current.value = null }

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
        api.closeService(sessionId, countedCash, remit, note).also { _current.value = null }

    /** Seals the day — nothing more can be taken until it is reopened. */
    suspend fun closeDay(dayId: String) = api.closeDay(dayId).also { _current.value = null }
}
