package mu.carfection.pos.feature.jobs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.network.ChecklistItemDto
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.TechnicianDto
import java.time.Instant
import javax.inject.Inject

/** The four kanban columns, in order, with the handoff's dot colours. */
enum class JobCol(val key: String, val label: String, val dot: Long) {
    SCHEDULED("scheduled", "Scheduled", 0xFF5A67D8),
    IN_PROGRESS("in_progress", "In progress", 0xFFC17A00),
    READY("ready", "Ready", 0xFF1FA361),
    DELIVERED("delivered", "Delivered", 0xFF68788A),
}

data class JobsState(
    val loading: Boolean = true,
    val jobs: List<JobBoardDto> = emptyList(),
    val technicians: List<TechnicianDto> = emptyList(),
    val activeJobId: String? = null,
    val busy: Boolean = false,
    val toast: String? = null,
    val error: String? = null,
)

@HiltViewModel
class JobsViewModel @Inject constructor(private val api: PosApi) : ViewModel() {
    private val _s = MutableStateFlow(JobsState())
    val state = _s.asStateFlow()

    init {
        load()
        viewModelScope.launch { runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } } }
    }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchJobs() }
                .onSuccess { j -> _s.update { it.copy(loading = false, jobs = j) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun jobsFor(s: JobsState, col: JobCol): List<JobBoardDto> = s.jobs.filter { it.status == col.key }
    fun active(s: JobsState): JobBoardDto? = s.jobs.firstOrNull { it.id == s.activeJobId }

    fun open(id: String) = _s.update { it.copy(activeJobId = id) }
    fun close() = _s.update { it.copy(activeJobId = null) }
    fun clearToast() = _s.update { it.copy(toast = null) }
    fun note(msg: String) = _s.update { it.copy(toast = msg) }

    fun assignTech(techId: String) {
        val id = _s.value.activeJobId ?: return
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(technicianId = techId) else it }) }
        viewModelScope.launch { runCatching { api.assignTechnician(id, techId) }.onFailure { load() } }
    }

    fun toggleChecklist(index: Int) {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id } ?: return
        if (job.status == "delivered") { _s.update { it.copy(toast = "Job already delivered") }; return }
        val updated = job.checklist.mapIndexed { i, c -> if (i == index) c.copy(done = !c.done) else c }
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(checklist = updated) else it }) }
        val json = buildJsonArray { updated.forEach { add(buildJsonObject { put("label", it.label); put("done", it.done) }) } }
        viewModelScope.launch { runCatching { api.setChecklist(id, json) }.onFailure { load() } }
    }

    fun startJob() {
        val id = _s.value.activeJobId ?: return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.startJob(id, Instant.now().toString()) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Job started") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    fun markReady() {
        val id = _s.value.activeJobId ?: return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.markJobReady(id) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Marked ready for collection") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }
}
