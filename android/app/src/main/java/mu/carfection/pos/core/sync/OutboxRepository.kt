package mu.carfection.pos.core.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
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
        // Flush whatever is queued each time real internet comes back.
        scope.launch { connectivity.online.collect { online -> if (online) drain() } }
    }

    @Serializable private data class AssignTech(val jobId: String, val technicianId: String)
    @Serializable private data class SetChecklist(val jobId: String, val checklist: JsonArray)

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
        private const val TAG = "Outbox"
    }
}
