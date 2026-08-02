package mu.carfection.pos.core.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleDraft
import mu.carfection.pos.core.data.SaleLineSpec
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.Tender
import mu.carfection.pos.core.data.WALK_IN_CUSTOMER
import mu.carfection.pos.core.data.isDeterministicRejection
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/** Whether writes can actually reach the server right now. */
interface OnlineSignal {
    val online: StateFlow<Boolean>
}

/**
 * Pushes one captured sale at the server. Behind an interface so the queue's rules — what
 * retries, what stops, what waits for a person — can be tested without a network or a
 * Supabase client, because those rules are what stand between an outage and lost money.
 */
interface CapturedSaleReplayer {
    suspend fun replay(row: OfflineSaleRow): SaleResult
}

/**
 * Sales rung while the tablet had no network: captured whole, replayed later, applied once.
 *
 * The rule this is built around is that a client may never invent a fiscal number. So an
 * offline sale is not a locally-issued invoice — it is a durable record of money taken,
 * which BECOMES an invoice the moment the server can be reached. The customer leaves with
 * a provisional slip; the VAT invoice exists from the instant the replay lands, dated then,
 * numbered by the same gapless counter as every other sale.
 *
 * Exactly-once comes from the keys, not from this queue being careful: every replay reuses
 * the sale's original `saleKey`, so `issue_document` and `record_payment` either apply it
 * or hand back what they already applied. Retrying is always safe; NOT retrying is what
 * loses money.
 */
@Singleton
class OfflineSaleRepository @Inject constructor(
    private val dao: OfflineSaleDao,
    private val replayer: CapturedSaleReplayer,
    private val connectivity: OnlineSignal,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val draining = AtomicBoolean(false)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Sales that have not reached the server. Drives the pill and blocks a till close. */
    val unsynced: Flow<Int> = dao.unsyncedCount()

    /** Sales that need a human decision — their till or day closed under them. */
    val blocked: Flow<Int> = dao.blockedCount()

    /** Everything captured on this device, newest first — the offline sales panel. */
    val all: Flow<List<OfflineSaleRow>> = dao.observeAll()

    private val started = AtomicBoolean(false)

    /**
     * Begin pushing captured sales on their own — on every reconnect, and on a timer while
     * anything is still held.
     *
     * Deliberately NOT done in `init`: when the queue drains itself the moment it is built,
     * its rules can only be tested against a race. Started once, by the application.
     */
    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch { connectivity.online.collect { online -> if (online) drain() } }
        // A socket that dies without the connectivity flag flipping leaves a sale stranded
        // with no reconnect edge to retrigger it. While money is still owed to the ledger,
        // keep trying — clearing the queue emits 0, which cancels this via collectLatest.
        scope.launch {
            unsynced.collectLatest { count ->
                while (count > 0) {
                    delay(RETRY_INTERVAL_MS)
                    drain()
                }
            }
        }
    }

    /**
     * Record a sale that has just been paid for offline. Returns the row, whose [OfflineSaleRow.localRef]
     * is what the customer's slip carries in place of an invoice number.
     *
     * Everything the replay will need is frozen here: the catalogue will have moved on by
     * the time the network returns, and the customer paid today's prices.
     */
    suspend fun capture(
        saleKey: String,
        tenantId: String,
        deviceId: String,
        cashSessionId: String?,
        customerId: String?,
        newCustomerId: String?,
        newCustomerName: String?,
        customerLabel: String,
        lines: List<SaleLineSpec>,
        orderDiscountKind: String?,
        orderDiscountValue: Double,
        tenders: List<Tender>,
        totalCents: Long,
        changeCents: Long,
        comment: String?,
        capturedAt: Long = System.currentTimeMillis(),
    ): OfflineSaleRow {
        // A re-tap of Record payment on a sale already captured must not create a second
        // one: the sale key is the identity here exactly as it is on the server.
        dao.find(saleKey)?.let { return it }

        val seq = dao.maxSeq() + 1
        val row = OfflineSaleRow(
            saleKey = saleKey,
            seq = seq,
            localRef = localRef(deviceId, seq),
            capturedAt = capturedAt,
            tenantId = tenantId,
            deviceId = deviceId,
            cashSessionId = cashSessionId,
            customerId = customerId,
            newCustomerId = newCustomerId,
            newCustomerName = newCustomerName,
            customerLabel = customerLabel,
            linesJson = json.encodeToString(lines.map { it.toOffline() }),
            orderDiscountKind = orderDiscountKind,
            orderDiscountValue = orderDiscountValue,
            tendersJson = json.encodeToString(tenders.map { it.toOffline() }),
            totalCents = totalCents,
            changeCents = changeCents,
            comment = comment,
        )
        dao.insert(row)
        drainAsync() // best-effort: the network may have returned between the tap and now
        return row
    }

    fun drainAsync() { scope.launch { drain() } }

    /**
     * Push everything captured at the server, oldest first so invoice numbers follow the
     * order the sales actually happened.
     *
     * A transient failure (the network is still down, a socket died) leaves the sale
     * PENDING and stops the pass — order is worth preserving and the next tick will
     * retry. A DETERMINISTIC refusal is different: no amount of retrying will change the
     * server's mind, so that sale is marked BLOCKED for a human and the pass CONTINUES,
     * because one unanswerable sale must never hold up the ones behind it.
     */
    suspend fun drain() {
        if (!connectivity.online.value) return
        if (!draining.compareAndSet(false, true)) return
        try {
            for (row in dao.unsynced()) {
                if (row.status == OfflineSaleRow.STATUS_BLOCKED) continue // waiting on a person
                val result = runCatching { replayer.replay(row) }
                result.onSuccess { sale ->
                    dao.markSynced(row.saleKey, sale.invoiceId, sale.number, System.currentTimeMillis())
                    Log.i(TAG, "offline sale ${row.localRef} landed as ${sale.number ?: sale.invoiceId}")
                }.onFailure { e ->
                    val attempts = row.attempts + 1
                    if (isDeterministicRejection(e)) {
                        Log.w(TAG, "offline sale ${row.localRef} blocked: ${e.message}")
                        dao.markAttempt(row.saleKey, OfflineSaleRow.STATUS_BLOCKED, attempts, e.message)
                    } else {
                        dao.markAttempt(row.saleKey, OfflineSaleRow.STATUS_PENDING, attempts, e.message)
                        return // likely still offline; keep the order and try again shortly
                    }
                }
            }
        } finally {
            draining.set(false)
        }
    }

    /**
     * Re-aim a blocked sale at a live till. The money is unchanged and the sale key is
     * unchanged — so if the blocked attempt had in fact landed, this returns that same
     * invoice rather than raising a second one. The true moment of sale goes into the
     * invoice's internal comment, because the fiscal date can only ever be the date the
     * document is issued, and that is no longer when the customer paid.
     */
    suspend fun refileOnTill(saleKey: String, sessionId: String) {
        val row = dao.find(saleKey) ?: return
        val note = listOfNotNull(
            row.comment?.takeIf { it.isNotBlank() },
            "${capturedTrace(row)} · filed later on a new till",
        ).joinToString(" — ")
        dao.refileOnSession(saleKey, sessionId, note)
        drainAsync()
    }

    /** Forget sales that landed more than [SYNCED_RETENTION_MS] ago — reprints stay available until then. */
    suspend fun pruneOldSynced() =
        dao.pruneSyncedBefore(System.currentTimeMillis() - SYNCED_RETENTION_MS)

    suspend fun find(saleKey: String): OfflineSaleRow? = dao.find(saleKey)

    companion object {
        private const val RETRY_INTERVAL_MS = 15_000L
        private const val SYNCED_RETENTION_MS = 30L * 24 * 60 * 60 * 1000 // 30 days
        private const val TAG = "OfflineSales"

        /** "OFF-66D2-014" — the device that rang it and the order it was rung in. */
        fun localRef(deviceId: String, seq: Int): String =
            "OFF-${deviceId.substringAfterLast('-').ifBlank { "TAB" }}-${seq.toString().padStart(3, '0')}"

        /** "Rung offline 02-08-2026 14:23 on TAB-66D2 · OFF-66D2-014". */
        fun capturedTrace(row: OfflineSaleRow): String {
            val at = DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm")
                .withZone(ZoneId.systemDefault())
                .format(Instant.ofEpochMilli(row.capturedAt))
            return "Rung offline $at on ${row.deviceId} · ${row.localRef}"
        }
    }
}

/**
 * The real replayer: unpacks a captured sale and settles it through the ordinary money
 * path — the same RPCs, the same idempotency keys an online sale uses.
 */
@Singleton
class SaleRepositoryReplayer @Inject constructor(
    private val sales: SaleRepository,
) : CapturedSaleReplayer {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override suspend fun replay(row: OfflineSaleRow): SaleResult = sales.settleCapturedSale(
        draft = SaleDraft(
            specs = json.decodeFromString<List<OfflineSaleLine>>(row.linesJson).map { it.toSpec() },
            orderDiscountKind = row.orderDiscountKind,
            orderDiscountValue = row.orderDiscountValue,
        ),
        tenders = json.decodeFromString<List<OfflineTender>>(row.tendersJson).map { it.toTender() },
        customerId = row.customerId,
        newCustomer = row.newCustomerId?.let { id ->
            SaleRepository.NewOfflineCustomer(id, row.newCustomerName ?: WALK_IN_CUSTOMER)
        },
        walkInName = row.customerLabel,
        cashSessionId = row.cashSessionId,
        saleKey = row.saleKey,
        // The fiscal date is when the document is issued — which for these is the reconnect,
        // not the sale — so the true moment has to be written where the owner can read it.
        // An internal note; never printed on a receipt.
        comment = row.comment?.takeIf { it.isNotBlank() }
            ?.let { "$it — ${OfflineSaleRepository.capturedTrace(row)}" }
            ?: OfflineSaleRepository.capturedTrace(row),
    )
}

internal fun SaleLineSpec.toOffline() = OfflineSaleLine(
    productId = productId,
    title = title,
    qty = qty,
    unitCents = unitCents,
    discountPct = discountPct,
    discountKind = discountKind,
    discountAmountInclCents = discountAmountInclCents,
    vatRatePct = vatRatePct,
)

internal fun OfflineSaleLine.toSpec() = SaleLineSpec(
    productId = productId,
    title = title,
    qty = qty,
    unitCents = unitCents,
    discountPct = discountPct,
    vatRatePct = vatRatePct,
    discountKind = discountKind,
    discountAmountInclCents = discountAmountInclCents,
)

internal fun Tender.toOffline() = OfflineTender(
    method = method.name,
    amountCents = amountCents,
    tenderedCents = tenderedCents,
    ref = ref,
)

internal fun OfflineTender.toTender() = Tender(
    method = PayMethod.valueOf(method),
    amountCents = amountCents,
    tenderedCents = tenderedCents,
    ref = ref,
)
