package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPayment
import mu.carfection.pos.core.hardware.ReceiptVatGroup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * consolidatedReceiptDoc combines several already-built single-invoice ReceiptDocs (exactly
 * what saleReceiptDoc returns for each settled invoice) into one account-settlement receipt.
 * These pin the aggregation math independently of the rendering (ReceiptTextTest covers that).
 */
class SaleReceiptTest {

    private val biz = ReceiptBiz(name = "Carfectionist", address = "Helvetia", brn = "BRN1", vatNo = "VAT1")

    /** A minimal single-invoice doc, as saleReceiptDoc would build it for one settled invoice. */
    private fun invoiceDoc(
        invoiceNo: String,
        totalCents: Long,
        subtotalCents: Long = totalCents,
        discountCents: Long = 0,
        vatCents: Long = 0,
        vatGroups: List<ReceiptVatGroup> = emptyList(),
        payments: List<ReceiptPayment> = listOf(ReceiptPayment("23/08 10:00", "Cash", totalCents)),
        paidCents: Long = totalCents,
        changeCents: Long = 0,
        pointsEarned: Int? = null,
        pointsBalanceAfter: Int? = null,
    ) = ReceiptDoc(
        biz = biz, invoiceNo = invoiceNo, dateTime = "23 Aug 2026 10:00", cashier = "Anesh", customer = "Nick Summer",
        lines = listOf(ReceiptLine(title = "Wash", qty = 1.0, inclCents = totalCents, unitInclCents = totalCents, grossInclCents = totalCents + discountCents)),
        subtotalCents = subtotalCents, vatRatePct = 15, vatCents = vatCents, discountCents = discountCents, totalCents = totalCents,
        payLabel = "Cash", paidCents = paidCents, changeCents = changeCents, onAccount = false,
        isPayment = true, payments = payments, vatGroups = vatGroups,
        pointsEarned = pointsEarned, pointsBalanceAfter = pointsBalanceAfter,
    )

    @Test
    fun `sums subtotal, discount, VAT and total across every invoice`() {
        val a = invoiceDoc("INV-01", totalCents = 3_000, subtotalCents = 3_500, discountCents = 500, vatCents = 391)
        val b = invoiceDoc("INV-02", totalCents = 5_000, subtotalCents = 5_000, discountCents = 0, vatCents = 652)

        val doc = consolidatedReceiptDoc(listOf(a, b))

        assertEquals(8_500L, doc.subtotalCents)
        assertEquals(500L, doc.discountCents)
        assertEquals(1_043L, doc.vatCents)
        assertEquals(8_000L, doc.totalCents)
    }

    @Test
    fun `one section per invoice, in the order they were settled`() {
        val a = invoiceDoc("INV-01", totalCents = 3_000)
        val b = invoiceDoc("INV-02", totalCents = 5_000)

        val doc = consolidatedReceiptDoc(listOf(a, b))

        assertEquals(listOf("INV-01", "INV-02"), doc.consolidatedSections.map { it.invoiceNo })
        assertEquals(3_000L, doc.consolidatedSections[0].totalCents)
        assertEquals(5_000L, doc.consolidatedSections[1].totalCents)
        assertTrue(doc.lines.isEmpty()) // items live in the sections, not the flat line list
    }

    @Test
    fun `no single invoice number, ticket or bill reference names the whole settlement`() {
        val doc = consolidatedReceiptDoc(listOf(invoiceDoc("INV-01", 1_000), invoiceDoc("INV-02", 2_000)))

        assertNull(doc.invoiceNo)
        assertNull(doc.ticketNo)
        assertNull(doc.billNo)
    }

    @Test
    fun `merges VAT groups by rate across invoices`() {
        val a = invoiceDoc("INV-01", 1_150, vatGroups = listOf(ReceiptVatGroup(15.0, 1_000, 150)))
        val b = invoiceDoc("INV-02", 2_300, vatGroups = listOf(ReceiptVatGroup(15.0, 2_000, 300)))

        val doc = consolidatedReceiptDoc(listOf(a, b))

        assertEquals(1, doc.vatGroups.size)
        assertEquals(3_000L, doc.vatGroups[0].baseCents)
        assertEquals(450L, doc.vatGroups[0].vatCents)
    }

    @Test
    fun `every invoice's own payment rows are concatenated, not collapsed`() {
        val a = invoiceDoc("INV-01", 1_000, payments = listOf(ReceiptPayment("23/08 10:00", "Points", 300), ReceiptPayment("23/08 10:00", "Cash", 700)))
        val b = invoiceDoc("INV-02", 2_000, payments = listOf(ReceiptPayment("23/08 10:00", "Cash", 2_000)))

        val doc = consolidatedReceiptDoc(listOf(a, b))

        assertEquals(3, doc.payments.size)
        assertEquals(listOf("Points", "Cash", "Cash"), doc.payments.map { it.method })
        assertEquals(3_000L, doc.paidCents)
    }

    @Test
    fun `points earned add up, and the balance shown is the last invoice's`() {
        val a = invoiceDoc("INV-01", 1_150, pointsEarned = 11, pointsBalanceAfter = 50)
        val b = invoiceDoc("INV-02", 2_300, pointsEarned = 23, pointsBalanceAfter = 73)

        val doc = consolidatedReceiptDoc(listOf(a, b))

        assertEquals(34, doc.pointsEarned)
        assertEquals(73, doc.pointsBalanceAfter)
    }

    @Test
    fun `a settlement never reads as on account or voided`() {
        val doc = consolidatedReceiptDoc(listOf(invoiceDoc("INV-01", 1_000)))

        assertEquals(false, doc.onAccount)
        assertEquals(false, doc.voided)
    }
}
