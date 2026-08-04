package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Bill this quote, and let them add to it" — requested from the jobs board when a finished
 * job is invoiced, consumed by the quote screen.
 *
 * The board has no catalogue on it, and the bill needs one: a customer collecting their car
 * is the customer most likely to be holding something they picked up while they waited. So
 * the board hands the quote over rather than issuing behind their back, and the basket opens
 * where the products already are.
 *
 * Latched (StateFlow), not an event, exactly like OpenJobBus: the shell navigates to Quotes
 * only after the request is made, so the request has to survive until that ViewModel exists.
 */
@Singleton
class BillQuoteBus @Inject constructor() {
    private val _pending = MutableStateFlow<String?>(null)
    val pending = _pending.asStateFlow()
    fun request(quoteId: String) { _pending.value = quoteId }
    fun consume() { _pending.value = null }
}
