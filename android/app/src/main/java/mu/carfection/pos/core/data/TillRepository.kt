package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.PosApi
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
}
