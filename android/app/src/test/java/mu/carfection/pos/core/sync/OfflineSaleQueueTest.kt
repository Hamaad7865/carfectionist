package mu.carfection.pos.core.sync

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleLineSpec
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.Tender
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The rules that stand between a network outage and lost money.
 *
 * A sale rung offline has already been paid for — the cash is in the drawer and the
 * customer has gone. From that moment the only failure that matters is the sale never
 * reaching the books, or reaching them twice.
 */
class OfflineSaleQueueTest {

    // ── an in-memory stand-in for the Room DAO ────────────────────────────────
    private class FakeDao : OfflineSaleDao {
        val rows = LinkedHashMap<String, OfflineSaleRow>()
        private val changes = MutableStateFlow(0)
        private fun touch() { changes.value += 1 }

        override suspend fun insert(row: OfflineSaleRow) { rows[row.saleKey] = row; touch() }
        override suspend fun all() = rows.values.sortedWith(compareBy({ it.capturedAt }, { it.seq }))
        override fun observeAll(): Flow<List<OfflineSaleRow>> = changes.map { all().reversed() }
        override suspend fun unsynced() = all().filter { it.status != OfflineSaleRow.STATUS_SYNCED }
        override fun unsyncedCount(): Flow<Int> = changes.map { unsynced().size }
        override fun blockedCount(): Flow<Int> =
            changes.map { rows.values.count { r -> r.status == OfflineSaleRow.STATUS_BLOCKED } }
        override suspend fun find(saleKey: String) = rows[saleKey]
        override suspend fun maxSeq() = rows.values.maxOfOrNull { it.seq } ?: 0
        override suspend fun markSynced(saleKey: String, invoiceId: String, number: String?, at: Long) {
            rows[saleKey] = rows.getValue(saleKey).copy(
                status = OfflineSaleRow.STATUS_SYNCED, invoiceId = invoiceId,
                invoiceNumber = number, syncedAt = at, lastError = null,
            )
            touch()
        }
        override suspend fun markAttempt(saleKey: String, status: String, attempts: Int, err: String?) {
            rows[saleKey] = rows.getValue(saleKey).copy(status = status, attempts = attempts, lastError = err)
            touch()
        }
        override suspend fun refileOnSession(saleKey: String, sessionId: String, comment: String?) {
            rows[saleKey] = rows.getValue(saleKey).copy(
                cashSessionId = sessionId, status = OfflineSaleRow.STATUS_PENDING,
                attempts = 0, lastError = null, comment = comment,
            )
            touch()
        }
        override suspend fun pruneSyncedBefore(before: Long) {
            rows.values.filter { it.status == OfflineSaleRow.STATUS_SYNCED && (it.syncedAt ?: 0) < before }
                .forEach { rows.remove(it.saleKey) }
            touch()
        }
    }

    private class FakeOnline(online: Boolean = true) : OnlineSignal {
        private val _online = MutableStateFlow(online)
        override val online: StateFlow<Boolean> = _online
        fun set(v: Boolean) { _online.value = v }
    }

    /** Records what it was asked to replay, and answers however the test tells it to. */
    private class FakeReplayer(
        var answer: (OfflineSaleRow) -> SaleResult = { throw IOException("Unable to resolve host") },
    ) : CapturedSaleReplayer {
        val seen = mutableListOf<String>()
        override suspend fun replay(row: OfflineSaleRow): SaleResult {
            seen += row.saleKey
            return answer(row)
        }
    }

    private val dao = FakeDao()
    private val online = FakeOnline()
    private val replayer = FakeReplayer()
    private fun repo() = OfflineSaleRepository(dao, replayer, online)

    private val brakePad = SaleLineSpec(
        productId = "p1", title = "Brake pad", qty = 1.0, unitCents = 1_000_00,
        discountPct = 0.0, vatRatePct = 15.0,
    )

    private suspend fun OfflineSaleRepository.captureOne(
        key: String,
        cents: Long = 1_150_00,
        at: Long = 1_000L,
        session: String? = "till-1",
    ) = capture(
        saleKey = key, tenantId = "t1", deviceId = "TAB-66D2", cashSessionId = session,
        customerId = "cust-1", newCustomerId = null, newCustomerName = null,
        customerLabel = "Walk-in", lines = listOf(brakePad),
        orderDiscountKind = null, orderDiscountValue = 0.0,
        tenders = listOf(Tender(PayMethod.CASH, cents, tenderedCents = cents)),
        totalCents = cents, changeCents = 0, comment = null, capturedAt = at,
    )

    private fun issued(id: String, number: String) =
        SaleResult(invoiceId = id, number = number, totalCents = 1_150_00, changeCents = 0, onAccount = false)

    // ── capture ───────────────────────────────────────────────────────────────

    @Test
    fun `a captured sale carries a readable reference, not a fiscal number`() = runTest {
        online.set(false)
        val row = repo().captureOne("sale-a")

        assertEquals("OFF-66D2-001", row.localRef)
        assertNull("no invoice number may be invented offline", row.invoiceNumber)
        assertEquals(OfflineSaleRow.STATUS_PENDING, row.status)
    }

    /** Two tills, two sales, two references — the slip has to identify which tablet rang it. */
    @Test
    fun `references number in the order sales were rung`() = runTest {
        online.set(false)
        val r = repo()
        assertEquals("OFF-66D2-001", r.captureOne("sale-a", at = 1).localRef)
        assertEquals("OFF-66D2-002", r.captureOne("sale-b", at = 2).localRef)
    }

    /**
     * The one way capture could take money twice: the cashier taps Record payment again on
     * the same basket. The sale key is the identity, so the second tap finds the first sale.
     */
    @Test
    fun `capturing the same sale twice records it once`() = runTest {
        online.set(false)
        val r = repo()
        val first = r.captureOne("sale-a")
        val second = r.captureOne("sale-a", cents = 9_999_00)

        assertEquals(1, dao.rows.size)
        assertEquals(first.localRef, second.localRef)
        assertEquals("the original amount stands", first.totalCents, dao.rows.getValue("sale-a").totalCents)
    }

    // ── replay ────────────────────────────────────────────────────────────────

    @Test
    fun `a landed sale keeps the invoice number the server assigned`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { issued("inv-1", "INV-0061") }

        online.set(true)
        r.drain()

        val row = dao.rows.getValue("sale-a")
        assertEquals(OfflineSaleRow.STATUS_SYNCED, row.status)
        assertEquals("INV-0061", row.invoiceNumber)
        assertEquals("inv-1", row.invoiceId)
        assertNotNull(row.syncedAt)
    }

    @Test
    fun `nothing is sent while the tablet is still offline`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")

        r.drain()

        assertTrue("no attempt should reach the network", replayer.seen.isEmpty())
        assertEquals(OfflineSaleRow.STATUS_PENDING, dao.rows.getValue("sale-a").status)
    }

    /** A dropped socket is not an answer — the sale stays queued and keeps its place. */
    @Test
    fun `a transient failure leaves the sale queued and stops the pass`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a", at = 1)
        r.captureOne("sale-b", at = 2)
        replayer.answer = { throw IOException("Unable to resolve host") }

        online.set(true)
        r.drain()

        assertEquals(OfflineSaleRow.STATUS_PENDING, dao.rows.getValue("sale-a").status)
        assertEquals(1, dao.rows.getValue("sale-a").attempts)
        assertEquals("the pass stops at the first drop, preserving order", listOf("sale-a"), replayer.seen)
    }

    /**
     * The till a sale was rung on has closed. No retry can change that answer, so the sale
     * waits for a person — and crucially does NOT hold up the sales queued behind it.
     */
    @Test
    fun `a sale whose till has closed is set aside without blocking the rest`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a", at = 1)
        r.captureOne("sale-b", at = 2)
        replayer.answer = { row ->
            if (row.saleKey == "sale-a") throw IllegalStateException("unknown or closed cash session")
            issued("inv-2", "INV-0062")
        }

        online.set(true)
        r.drain()

        assertEquals(OfflineSaleRow.STATUS_BLOCKED, dao.rows.getValue("sale-a").status)
        assertEquals("the sale behind it still lands", OfflineSaleRow.STATUS_SYNCED, dao.rows.getValue("sale-b").status)
        assertEquals("INV-0062", dao.rows.getValue("sale-b").invoiceNumber)
    }

    @Test
    fun `a sale whose day has closed is set aside, not dropped`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { throw IllegalStateException("the day is closed — no more entries or transactions are possible") }

        online.set(true)
        r.drain()

        val row = dao.rows.getValue("sale-a")
        assertEquals(OfflineSaleRow.STATUS_BLOCKED, row.status)
        assertTrue("the money is still on the books to be filed", dao.rows.containsKey("sale-a"))
        assertTrue(row.lastError!!.contains("day is closed"))
    }

    /** A set-aside sale must not be retried forever in the background — it waits for a decision. */
    @Test
    fun `a set-aside sale is not retried on later passes`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { throw IllegalStateException("this till is still on the day of 2026-08-01") }
        online.set(true)
        r.drain()
        replayer.seen.clear()

        r.drain()

        assertTrue("nothing should be re-sent", replayer.seen.isEmpty())
        assertEquals(OfflineSaleRow.STATUS_BLOCKED, dao.rows.getValue("sale-a").status)
    }

    /**
     * Re-aiming a blocked sale keeps its sale key. That is what makes the retry safe: if the
     * blocked attempt HAD in fact landed, the server replays that invoice instead of raising
     * a second one for the same money.
     */
    @Test
    fun `re-filing a blocked sale keeps its key and records when it was really rung`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a", session = "till-old")
        replayer.answer = { throw IllegalStateException("unknown or closed cash session") }
        online.set(true)
        r.drain()

        replayer.answer = { issued("inv-3", "INV-0063") }
        r.refileOnTill("sale-a", "till-new")
        r.drain()

        val row = dao.rows.getValue("sale-a")
        assertEquals("sale-a", row.saleKey)
        assertEquals(OfflineSaleRow.STATUS_SYNCED, row.status)
        assertEquals("INV-0063", row.invoiceNumber)
        assertTrue(
            "the owner must be able to see when the money was actually taken",
            row.comment!!.contains("Rung offline") && row.comment!!.contains("OFF-66D2-001"),
        )
    }

    /** Every replay must present the ORIGINAL key, or the server would issue a second invoice. */
    @Test
    fun `a retried sale is presented under its original key every time`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { throw IOException("boom") }
        online.set(true)
        r.drain(); r.drain(); r.drain()

        assertEquals(listOf("sale-a", "sale-a", "sale-a"), replayer.seen)
    }

    // ── what the replay is handed ─────────────────────────────────────────────

    /** The customer paid THESE prices; a re-synced catalogue must not reprice the sale. */
    @Test
    fun `the sale replays at the prices it was rung at`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        var replayed: OfflineSaleRow? = null
        replayer.answer = { row -> replayed = row; issued("inv-1", "INV-0064") }

        online.set(true)
        r.drain()

        val lines = kotlinx.serialization.json.Json.decodeFromString<List<OfflineSaleLine>>(replayed!!.linesJson)
        assertEquals(1, lines.size)
        assertEquals(1_000_00, lines[0].unitCents)
        assertEquals(15.0, lines[0].vatRatePct, 0.0)
        assertEquals("till-1", replayed!!.cashSessionId)
    }

    @Test
    fun `the tenders replay exactly as they were taken`() = runTest {
        online.set(false)
        val r = repo()
        r.capture(
            saleKey = "split-a", tenantId = "t1", deviceId = "TAB-66D2", cashSessionId = "till-1",
            customerId = "cust-1", newCustomerId = null, newCustomerName = null,
            customerLabel = "Walk-in", lines = listOf(brakePad),
            orderDiscountKind = null, orderDiscountValue = 0.0,
            tenders = listOf(
                Tender(PayMethod.JUICE, 500_00, ref = "JC-1"),
                Tender(PayMethod.CASH, 650_00, tenderedCents = 700_00),
            ),
            totalCents = 1_150_00, changeCents = 50_00, comment = null,
        )
        var replayed: OfflineSaleRow? = null
        replayer.answer = { row -> replayed = row; issued("inv-1", "INV-0065") }

        online.set(true)
        r.drain()

        val tenders = kotlinx.serialization.json.Json
            .decodeFromString<List<OfflineTender>>(replayed!!.tendersJson).map { it.toTender() }
        assertEquals(listOf(PayMethod.JUICE, PayMethod.CASH), tenders.map { it.method })
        assertEquals(500_00, tenders[0].amountCents)
        assertEquals("JC-1", tenders[0].ref)
        assertEquals(700_00L, tenders[1].tenderedCents)
    }

    /** A customer typed during an outage gets a tablet-minted id, so its insert can be replayed. */
    @Test
    fun `a customer invented offline carries an id the replay can insert idempotently`() = runTest {
        online.set(false)
        val r = repo()
        val row = r.capture(
            saleKey = "sale-new-cust", tenantId = "t1", deviceId = "TAB-66D2", cashSessionId = "till-1",
            customerId = null, newCustomerId = "11111111-2222-3333-4444-555555555555",
            newCustomerName = "Priya Ramdin", customerLabel = "Priya Ramdin",
            lines = listOf(brakePad), orderDiscountKind = null, orderDiscountValue = 0.0,
            tenders = listOf(Tender(PayMethod.CASH, 1_150_00, tenderedCents = 1_150_00)),
            totalCents = 1_150_00, changeCents = 0, comment = null,
        )

        assertEquals("11111111-2222-3333-4444-555555555555", row.newCustomerId)
        assertEquals("Priya Ramdin", row.newCustomerName)
        assertNull(row.customerId)
    }

    // ── the money must stay visible until it is filed ─────────────────────────

    @Test
    fun `unsynced sales are counted until they land`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a", at = 1)
        r.captureOne("sale-b", at = 2)
        assertEquals(2, dao.unsynced().size)

        replayer.answer = { issued("inv-1", "INV-0066") }
        online.set(true)
        r.drain()

        assertEquals(0, dao.unsynced().size)
    }

    /** A blocked sale still counts as unsent — it is exactly the one a close must not skip. */
    @Test
    fun `a set-aside sale still counts as money the books have not seen`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { throw IllegalStateException("the day is closed") }
        online.set(true)
        r.drain()

        assertEquals(1, dao.unsynced().size)
    }

    @Test
    fun `a landed sale stays on the device so its real invoice can be reprinted`() = runTest {
        online.set(false)
        val r = repo()
        r.captureOne("sale-a")
        replayer.answer = { issued("inv-1", "INV-0067") }
        online.set(true)
        r.drain()

        val kept = dao.find("sale-a")
        assertNotNull(kept)
        assertEquals("INV-0067", kept!!.invoiceNumber)
    }
}
