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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import mu.carfection.pos.core.network.PosApi
import java.time.Instant
import java.util.UUID
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

    // Nullable: taking the last person off a job leaves it unassigned, which is a real state.
    @Serializable private data class AssignTech(val jobId: String, val technicianId: String? = null)
    @Serializable private data class SetChecklist(val jobId: String, val checklist: JsonArray)
    @Serializable private data class AuditEvent(
        val id: String,          // client-minted UUID — what makes the append replay-safe
        val tenantId: String,
        val eventType: String,
        val deviceId: String?,
        val payload: String,     // JsonObject, serialized
        val createdAt: String,   // the moment it happened, not the moment it flushed
    )

    /** The latest still-queued checklist / technician per job — what the server hasn't caught up to. */
    // technicianQueued distinguishes "an assign op is waiting" from "no assign op": a queued
    // UNassign is itself a null technicianId, and without the flag it would read as no overlay
    // and let the stale server snapshot put the old lead back.
    data class JobOverlay(
        val checklist: JsonArray? = null,
        val technicianId: String? = null,
        val technicianQueued: Boolean = false,
    )

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
                    out[it.jobId] = (out[it.jobId] ?: JobOverlay())
                        .copy(technicianId = it.technicianId, technicianQueued = true)
                }
            }
        }
        return out
    }

    /** Reassign a job's technician, or null to leave it unassigned. Safe to replay. */
    suspend fun enqueueAssignTech(jobId: String, technicianId: String?, label: String) =
        enqueue(OP_ASSIGN_TECH, json.encodeToString(AssignTech(jobId, technicianId)), "assign:$jobId", label)

    /** Persist a job's checklist state. Idempotent — the last write for a job wins. */
    suspend fun enqueueSetChecklist(jobId: String, checklist: JsonArray, label: String) =
        enqueue(OP_SET_CHECKLIST, json.encodeToString(SetChecklist(jobId, checklist)), "checklist:$jobId", label)

    /**
     * Record a traceability event that must SURVIVE a network blip — the owner reads
     * these (receipt printed / skipped) as the device's history, so silently dropping
     * one falsifies the record. An audit INSERT is an append, which the outbox normally
     * refuses (replays double-count) — this one is made replay-safe by minting the row
     * id HERE: a replay of the same UUID hits the primary key, and [dispatch] reads
     * that duplicate as "already landed", not as a failure.
     */
    suspend fun enqueueAuditEvent(tenantId: String, eventType: String, deviceId: String?, payload: JsonObject, label: String) {
        val id = UUID.randomUUID().toString()
        val op = AuditEvent(
            id = id, tenantId = tenantId, eventType = eventType, deviceId = deviceId,
            payload = payload.toString(), createdAt = Instant.now().toString(),
        )
        enqueue(OP_AUDIT_EVENT, json.encodeToString(op), "audit:$id", label)
    }

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
        OP_AUDIT_EVENT -> json.decodeFromString<AuditEvent>(op.payload).let {
            try {
                api.insertAuditEvent(
                    tenantId = it.tenantId, eventType = it.eventType, deviceId = it.deviceId,
                    payload = json.parseToJsonElement(it.payload).jsonObject,
                    id = it.id, createdAt = it.createdAt,
                )
            } catch (e: Exception) {
                // The insert of a client-minted id can only collide with ITSELF: a lost
                // response whose write actually landed. That is success, not failure.
                if (!isDuplicateKey(e)) throw e
            }
        }
        else -> error("unknown outbox op: ${op.opType}")
    }

    private fun isDuplicateKey(e: Exception): Boolean {
        val m = e.message ?: return false
        return m.contains("23505") || m.contains("duplicate key", ignoreCase = true)
    }

    companion object {
        const val OP_ASSIGN_TECH = "assign_tech"
        const val OP_SET_CHECKLIST = "set_checklist"
        const val OP_AUDIT_EVENT = "audit_event"
        private const val MAX_ATTEMPTS = 5
        private const val RETRY_INTERVAL_MS = 10_000L
        private const val TAG = "Outbox"
    }
}
