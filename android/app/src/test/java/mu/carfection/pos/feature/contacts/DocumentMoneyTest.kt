package mu.carfection.pos.feature.contacts

import mu.carfection.pos.core.network.SaleHistoryPaymentDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What the document dialog says under TOTAL — a balance on a bill, a refund on a credit note.
 *
 * A credit note carries the invoice's total with amount_paid left at 0, and its only payment
 * rows are the refund's negative mirrors. Read as a bill it claims the whole amount is still
 * owed (CN-0004: Rs 1,215.00 refunded by Juice, shown as a Rs 1,215.00 balance).
 *
 * The invoice it credits has the opposite gap: its payment still stands, and only the credit
 * note says the money went back.
 */
class DocumentMoneyTest {

    private fun pay(amount: Double, mirror: Boolean = false) =
        SaleHistoryPaymentDto(method = "juice", amount = amount, reversesPaymentId = if (mirror) "p-1" else null)

    @Test
    fun `a part-paid invoice shows what is still owed`() {
        assertEquals(2657.0, balanceOwed("invoice", 3657.0, 1000.0)!!, 0.001)
    }

    @Test
    fun `a settled invoice shows no balance`() {
        assertNull(balanceOwed("invoice", 1215.0, 1215.0))
    }

    @Test
    fun `a voided invoice shows no balance`() {
        assertNull(balanceOwed("invoice", 1215.0, 0.0, voided = true))
    }

    @Test
    fun `a credit note never shows a balance`() {
        assertNull(balanceOwed("credit_note", 1215.0, 0.0))
    }

    @Test
    fun `a quote never shows a balance`() {
        assertNull(balanceOwed("quote", 1215.0, 0.0))
    }

    @Test
    fun `a credit note's refund is its mirrors, read as money out`() {
        assertEquals(1215.0, refundedOn(listOf(pay(-1215.0, mirror = true))), 0.001)
    }

    @Test
    fun `a split refund adds up`() {
        assertEquals(1215.0, refundedOn(listOf(pay(-500.0, mirror = true), pay(-715.0, mirror = true))), 0.001)
    }

    @Test
    fun `a voided credit note has refunded nothing, whatever its ledger row says`() {
        assertEquals(0.0, refundedOn(listOf(pay(-1215.0, mirror = true)), voided = true), 0.001)
    }

    @Test
    fun `a credit note from before refunds were booked has refunded nothing`() {
        assertEquals(0.0, refundedOn(emptyList()), 0.001)
    }

    // INV-0312: Rs 1,215.00 by Juice, credited by CN-0004. The refund's negative mirror sits
    // on the credit note, so nothing among the invoice's own rows says the money went back —
    // the dialog read "Paid Rs 1,215.00 / Juice Rs 1,215.00" and stopped there.
    private val juice = SaleHistoryPaymentDto(id = "p-1", method = "juice", amount = 1215.0)

    @Test
    fun `a standing payment on a credited invoice names the credit note that refunded it`() {
        assertEquals("CN-0004", refundedBy(juice, listOf(juice), "CN-0004"))
    }

    @Test
    fun `nothing is refunded on an invoice no credit note stands against`() {
        assertNull(refundedBy(juice, listOf(juice), null))
    }

    // A pair cancelled on the invoice BEFORE it was credited was never standing money, so the
    // credit note mirrored neither row (create_and_issue_credit_note skips them).
    @Test
    fun `a payment already reversed on the invoice is not called refunded`() {
        val mirror = SaleHistoryPaymentDto(id = "p-2", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        assertNull(refundedBy(juice, listOf(juice, mirror), "CN-0004"))
    }

    @Test
    fun `a reversal mirror is not called refunded`() {
        val mirror = SaleHistoryPaymentDto(id = "p-2", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        assertNull(refundedBy(mirror, listOf(juice, mirror), "CN-0004"))
    }

    @Test
    fun `the payment that replaced a reversed one is the one refunded`() {
        val mirror = SaleHistoryPaymentDto(id = "p-2", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        val card = SaleHistoryPaymentDto(id = "p-3", method = "card", amount = 1215.0)
        assertEquals("CN-0004", refundedBy(card, listOf(juice, mirror, card), "CN-0004"))
    }
}
