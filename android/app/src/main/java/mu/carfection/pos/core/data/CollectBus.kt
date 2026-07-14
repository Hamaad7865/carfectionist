package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

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
 */
@Singleton
class CollectBus @Inject constructor() {
    data class Request(val invoiceId: String, val amountCents: Long?)

    private val _pending = MutableStateFlow<Request?>(null)
    val pending = _pending.asStateFlow()

    fun request(invoiceId: String, amountCents: Long? = null) {
        _pending.value = Request(invoiceId, amountCents)
    }

    fun consume() { _pending.value = null }
}
