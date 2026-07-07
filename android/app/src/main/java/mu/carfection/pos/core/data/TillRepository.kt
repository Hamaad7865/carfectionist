package mu.carfection.pos.core.data

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
    suspend fun openSession(): CashSessionDto? = api.openSessionForDevice(session.deviceId())

    suspend fun open(openingFloatCents: Long): CashSessionDto =
        api.openCashSession(session.deviceId(), centsToRupees(openingFloatCents))

    suspend fun close(sessionId: String, closingCountCents: Long): CashSessionDto =
        api.closeCashSession(sessionId, centsToRupees(closingCountCents))
}
