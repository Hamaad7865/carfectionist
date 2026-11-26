package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import mu.carfection.pos.core.network.JobBoardDto
import javax.inject.Inject
import javax.inject.Singleton

/** Latch a finished job while the shell switches to the appointment editor. */
@Singleton
class AppointmentFromJobBus @Inject constructor() {
    private val _pending = MutableStateFlow<JobBoardDto?>(null)
    val pending = _pending.asStateFlow()

    fun request(job: JobBoardDto) { _pending.value = job }
    fun consume() { _pending.value = null }
}
