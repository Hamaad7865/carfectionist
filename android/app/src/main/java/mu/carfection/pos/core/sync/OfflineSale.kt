package mu.carfection.pos.core.sync

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

/**
 * A sale the cashier rang while the tablet had no network.
 *
 * The money path is online-only for a real reason: `issue_document` mints the gapless
 * fiscal number, and no client may invent one. So an offline sale is NOT an invoice —
 * it is the complete, durable record of a sale that HAPPENED, waiting to become one.
 * The customer leaves with a provisional slip carrying [localRef]; the VAT invoice and
 * its number are assigned when this replays through the very same RPCs an online sale
 * uses, under the very same idempotency keys. Nothing about numbering changes.
 *
 * Everything needed to replay is frozen here at capture time — prices, discounts,
 * tenders, the till it was rung on, the customer — because the catalogue cache will
 * have moved on by the time the network returns, and the customer paid THESE prices.
 */
@Entity(tableName = "offline_sales")
data class OfflineSaleRow(
    /** The idempotency root. Reused verbatim on every replay, so the server can only apply this sale once. */
    @PrimaryKey val saleKey: String,
    /** Per-device counter behind [localRef] — what makes the slip's reference readable and ordered. */
    val seq: Int,
    /** What the customer's slip says, e.g. "OFF-66D2-014". Never a fiscal number. */
    val localRef: String,
    /** When the money actually changed hands — not when it reached the server. */
    val capturedAt: Long,
    val tenantId: String,
    val deviceId: String,
    /** The till that rang it. The sale must reach the server before this service closes. */
    val cashSessionId: String?,
    /** Resolved from the offline customer cache. */
    val customerId: String?,
    /**
     * Set when the cashier typed a customer the cache had never seen: the row is minted
     * client-side with this id and inserted at replay. A replayed insert collides with
     * itself on the primary key, which reads as already-landed — the same trick
     * [OutboxRepository.enqueueAuditEvent] relies on.
     */
    val newCustomerId: String? = null,
    val newCustomerName: String? = null,
    /** What the slip prints for "Client". */
    val customerLabel: String,
    val linesJson: String,
    val orderDiscountKind: String? = null,
    val orderDiscountValue: Double = 0.0,
    val tendersJson: String,
    /** Client-computed, by the same arithmetic the DB uses. Reconciled against the server total on replay. */
    val totalCents: Long,
    val changeCents: Long,
    val comment: String? = null,
    val status: String = STATUS_PENDING,
    val attempts: Int = 0,
    val lastError: String? = null,
    /** Filled in once it lands. [invoiceNumber] is the real fiscal number the slip never had. */
    val invoiceId: String? = null,
    val invoiceNumber: String? = null,
    val syncedAt: Long? = null,
) {
    companion object {
        /** Waiting for the network. The normal state of a sale rung during an outage. */
        const val STATUS_PENDING = "pending"
        /**
         * The server refused for a reason no retry can fix — the till it was rung on has
         * closed, or its day has. A human has to decide where this money belongs, so it
         * stops here rather than being dropped or silently refiled onto today's till.
         */
        const val STATUS_BLOCKED = "blocked"
        /** It reached the server and has a real invoice number. */
        const val STATUS_SYNCED = "synced"
    }
}

/** One cart row, frozen at the price the customer actually paid. */
@Serializable
data class OfflineSaleLine(
    val productId: String?, // null for an ad-hoc typed line
    val title: String,
    val qty: Double,
    val unitCents: Long,
    val discountPct: Double = 0.0,
    val discountKind: String = "percent",
    val discountAmountInclCents: Long = 0,
    val vatRatePct: Double,
)

/** One tender against the sale — the split table, or a single method. */
@Serializable
data class OfflineTender(
    val method: String, // PayMethod.name
    val amountCents: Long,
    val tenderedCents: Long? = null,
    val ref: String? = null,
)

@Dao
interface OfflineSaleDao {
    @Insert suspend fun insert(row: OfflineSaleRow)

    @Query("SELECT * FROM offline_sales ORDER BY capturedAt ASC, seq ASC")
    suspend fun all(): List<OfflineSaleRow>

    @Query("SELECT * FROM offline_sales ORDER BY capturedAt DESC, seq DESC")
    fun observeAll(): Flow<List<OfflineSaleRow>>

    @Query("SELECT * FROM offline_sales WHERE status != 'synced' ORDER BY capturedAt ASC, seq ASC")
    suspend fun unsynced(): List<OfflineSaleRow>

    /**
     * What the pill counts and what blocks a till close: sales that have NOT reached the
     * server. Synced rows stay in the table so the cashier can still reprint the real
     * invoice from the device that rang it.
     */
    @Query("SELECT COUNT(*) FROM offline_sales WHERE status != 'synced'")
    fun unsyncedCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM offline_sales WHERE status = 'blocked'")
    fun blockedCount(): Flow<Int>

    @Query("SELECT * FROM offline_sales WHERE saleKey = :saleKey")
    suspend fun find(saleKey: String): OfflineSaleRow?

    @Query("SELECT COALESCE(MAX(seq), 0) FROM offline_sales")
    suspend fun maxSeq(): Int

    @Query("UPDATE offline_sales SET status = 'synced', invoiceId = :invoiceId, invoiceNumber = :number, syncedAt = :at, lastError = NULL WHERE saleKey = :saleKey")
    suspend fun markSynced(saleKey: String, invoiceId: String, number: String?, at: Long)

    @Query("UPDATE offline_sales SET status = :status, attempts = :attempts, lastError = :err WHERE saleKey = :saleKey")
    suspend fun markAttempt(saleKey: String, status: String, attempts: Int, err: String?)

    /**
     * An owner re-aiming a blocked sale at a live till. The session changes, nothing about
     * the money does — and the sale key does not change either, so if the original attempt
     * had in fact landed, the replay still returns that same invoice instead of a second one.
     */
    @Query("UPDATE offline_sales SET cashSessionId = :sessionId, status = 'pending', attempts = 0, lastError = NULL, comment = :comment WHERE saleKey = :saleKey")
    suspend fun refileOnSession(saleKey: String, sessionId: String, comment: String?)

    /** Housekeeping only — a SYNCED row may be forgotten once it is old enough to be uninteresting. */
    @Query("DELETE FROM offline_sales WHERE status = 'synced' AND syncedAt IS NOT NULL AND syncedAt < :before")
    suspend fun pruneSyncedBefore(before: Long)
}
