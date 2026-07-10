package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Open this job on the board" — requested from the quote builder (View job) and consumed by
 * the Jobs screen. Latched (StateFlow), not an event, so it survives until the Jobs ViewModel
 * exists to act on it: the shell may navigate to Jobs, creating that ViewModel, only after the
 * request is made.
 */
@Singleton
class OpenJobBus @Inject constructor() {
    private val _pending = MutableStateFlow<String?>(null)
    val pending = _pending.asStateFlow()
    fun request(jobId: String) { _pending.value = jobId }
    fun consume() { _pending.value = null }
}
