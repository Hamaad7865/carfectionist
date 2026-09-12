package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * How long a collect request stays live. Four hours is a shift: a deposit agreed at
 * signing is collected the same shift, and anything older is somebody's yesterday that
 * should be re-selected manually from TO COLLECT rather than springing the pad open on
 * a bill nobody has looked at since. The counter still consumes an expired latch — a
 * stale request must never fire on the next unrelated visit to Checkout.
 */
const val COLLECT_REQUEST_TTL_MS = 4L * 60 * 60 * 1000

/**
 * Is this request too old to open the pad for?
 *
 * Pulled out of the counter so the rule can be tested without a ViewModel. Both ends
 * are millis since epoch; a request from the future (clock skew between tablets is
 * seconds, never hours) reads as fresh rather than as expired a shift from now.
 */
fun isCollectRequestExpired(requestedAtMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean =
    nowMs - requestedAtMs > COLLECT_REQUEST_TTL_MS

/**
 * "Collect on this bill, and open the pad at this figure" — requested when a customer signs
 * a quote and leaves a deposit, consumed by Checkout.
 *
 * Latched (StateFlow), not an event, exactly like OpenJobBus: the shell navigates to
 * Checkout only after the request is made, so the counter's ViewModel may not exist yet to
 * hear it. The request waits.
 *
 * [amountCents] is a suggestion the cashier can still change at the pad — the money is not
 * taken until they press the button with the customer's cash in hand.
 *
 * [requestedAtMs] is when the request was latched. The counter ignores (but still
 * consumes) a request older than [COLLECT_REQUEST_TTL_MS] — without it a deposit latched
 * before lunch would spring the pad open on whoever next visits Checkout, over a bill
 * nobody has looked at for a shift.
 */
@Singleton
class CollectBus @Inject constructor() {
    data class Request(val invoiceId: String, val amountCents: Long?, val requestedAtMs: Long = System.currentTimeMillis())

    private val _pending = MutableStateFlow<Request?>(null)
    val pending = _pending.asStateFlow()

    fun request(invoiceId: String, amountCents: Long? = null) {
        _pending.value = Request(invoiceId, amountCents)
    }

    fun consume() { _pending.value = null }
}
