package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Open this quote in the builder" — requested from the checkout TO COLLECT list, where an
 * open bill names the quote it was raised from and a cashier who asks "what exactly did they
 * sign?" can tap straight through. Consumed by the quote screen like [BillQuoteBus], but
 * VIEW-only: the bill already exists, so this must NOT arm bill-on-open — that path would
 * start a second bill from the same quote.
 *
 * Latched (StateFlow), not an event, exactly like OpenJobBus: the shell navigates to Quotes
 * only after the request is made, so the request has to survive until that ViewModel exists.
 */
@Singleton
class OpenQuoteBus @Inject constructor() {
    private val _pending = MutableStateFlow<String?>(null)
    val pending = _pending.asStateFlow()
    fun request(quoteId: String) { _pending.value = quoteId }
    fun consume() { _pending.value = null }
}
