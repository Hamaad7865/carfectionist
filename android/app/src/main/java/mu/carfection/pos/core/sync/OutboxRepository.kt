package mu.carfection.pos.core.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import mu.carfection.pos.core.network.PosApi
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The tablet's write buffer. Callers update their own UI optimistically and enqueue the write;
 * the repository flushes the queue immediately when online and again on every reconnect, so a
 * dropped Wi-Fi frame at the counter never loses a change. Ops replay FIFO and the drain stops at
 * the first transient failure to preserve order; an op the server keeps rejecting (stale/bad data,
 * not a network drop) is dead-lettered after [MAX_ATTEMPTS] so it can't wedge the queue behind it.
 *
 * Only writes that are safe to apply more than once live here — a lost response triggers a replay,
 * so every op must be an idempotent UPDATE (assign, checklist). Non-idempotent writes stay online:
 * stock movements are appends (would double-count) and the money path needs a server-assigned
 * number to show the cashier.
 */
@Singleton
class OutboxRepository @Inject constructor(
    private val dao: OutboxDao,
    private val api: PosApi,
    private val connectivity: ConnectivityObserver,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val draining = AtomicBoolean(false)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Number of writes still waiting to reach the server — drives the sync pill. */
    val pending: Flow<Int> = dao.count()

    init {
        // Flush whatever is queued each time real internet comes back (false -> true edge),
        // and once at startup so ops that outlived the process get sent.
        scope.launch { connectivity.online.collect { online -> if (online) drain() } }
        // Safety net: a socket that drops without the connectivity flag flipping leaves an op
        // stranded with no reconnect edge to retrigger it. While anything is queued, keep retrying.
        scope.launch {
            pending.collectLatest { count ->
                while (count > 0) {
                    delay(RETRY_INTERVAL_MS)
                    drain() // clearing the queue emits 0, which cancels this loop via collectLatest
                }
            }
        }
    }

    @Serializable private data class AssignTech(val jobId: String, val technicianId: String)
    @Serializable private data class SetChecklist(val jobId: String, val checklist: JsonArray)

    /** The latest still-queued checklist / technician per job — what the server hasn't caught up to. */
    data class JobOverlay(val checklist: JsonArray? = null, val technicianId: String? = null)

    /**
     * A fresh fetchJobs() is behind any writes still in the queue; overlay those so re-entering the
     * board (or building the next edit) sees the queued state, not the stale server snapshot that
     * would otherwise revert an already-enqueued change. FIFO order → the last op per field wins.
     */
    suspend fun pendingJobOverlays(): Map<String, JobOverlay> {
        val out = HashMap<String, JobOverlay>()
        for (op in dao.all()) {
            when (op.opType) {
                OP_SET_CHECKLIST -> json.decodeFromString<SetChecklist>(op.payload).let {
                    out[it.jobId] = (out[it.jobId] ?: JobOverlay()).copy(checklist = it.checklist)
                }
                OP_ASSIGN_TECH -> json.decodeFromString<AssignTech>(op.payload).let {
                    out[it.jobId] = (out[it.jobId] ?: JobOverlay()).copy(technicianId = it.technicianId)
                }
            }
        }
        return out
    }

    /** Reassign a job's technician. Idempotent — safe to replay after a reconnect. */
    suspend fun enqueueAssignTech(jobId: String, technicianId: String, label: String) =
        enqueue(OP_ASSIGN_TECH, json.encodeToString(AssignTech(jobId, technicianId)), "assign:$jobId", label)

    /** Persist a job's checklist state. Idempotent — the last write for a job wins. */
    suspend fun enqueueSetChecklist(jobId: String, checklist: JsonArray, label: String) =
        enqueue(OP_SET_CHECKLIST, json.encodeToString(SetChecklist(jobId, checklist)), "checklist:$jobId", label)

    private suspend fun enqueue(opType: String, payload: String, idempotencyKey: String, label: String) {
        dao.insert(OutboxOp(opType = opType, payload = payload, idempotencyKey = idempotencyKey, label = label, createdAt = System.currentTimeMillis()))
        drain() // best-effort immediate send; a no-op while offline
    }

    /** Fire-and-forget flush for callers that shouldn't block on the network. */
    fun drainAsync() { scope.launch { drain() } }

    suspend fun drain() {
        if (!connectivity.online.value) return // don't burn attempts while offline
        if (!draining.compareAndSet(false, true)) return
        try {
            for (op in dao.all()) {
                val result = runCatching { dispatch(op) }
                if (result.isSuccess) {
                    dao.delete(op.id)
                } else {
                    val attempts = op.attempts + 1
                    val err = result.exceptionOrNull()?.message
                    if (attempts >= MAX_ATTEMPTS) {
                        Log.w(TAG, "dropping poisoned op ${op.opType} after $attempts attempts: $err — ${op.label}")
                        dao.delete(op.id) // a bad op shouldn't block the rest of the queue
                    } else {
                        dao.markFailure(op.id, attempts, err)
                        return // likely a transient drop; retry the whole queue on next reconnect
                    }
                }
            }
        } finally {
            draining.set(false)
        }
    }

    private suspend fun dispatch(op: OutboxOp) = when (op.opType) {
        OP_ASSIGN_TECH -> json.decodeFromString<AssignTech>(op.payload).let { api.assignTechnician(it.jobId, it.technicianId) }
        OP_SET_CHECKLIST -> json.decodeFromString<SetChecklist>(op.payload).let { api.setChecklist(it.jobId, it.checklist) }
        else -> error("unknown outbox op: ${op.opType}")
    }

    companion object {
        const val OP_ASSIGN_TECH = "assign_tech"
        const val OP_SET_CHECKLIST = "set_checklist"
        private const val MAX_ATTEMPTS = 5
        private const val RETRY_INTERVAL_MS = 10_000L
        private const val TAG = "Outbox"
    }
}
