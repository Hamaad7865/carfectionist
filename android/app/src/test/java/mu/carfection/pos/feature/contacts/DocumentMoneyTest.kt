package mu.carfection.pos.feature.contacts

import mu.carfection.pos.core.network.SaleHistoryPaymentDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    // Rs 500.00 cash, reversed, then Rs 500.00 by card (reverse_payment, or
    // change_payment_method which reverses and re-books at the same instant). The dialog read
    // "Paid Rs 500.00 / Cash Rs 500.00 / Card Rs 500.00" with nothing marking the cash undone.
    private val cash = SaleHistoryPaymentDto(id = "p-1", method = "cash", amount = 500.0, receivedAt = "2026-08-31T19:06:24.904009+00:00")
    private val cashMirror = SaleHistoryPaymentDto(id = "p-2", method = "cash", amount = -500.0, reversesPaymentId = "p-1", receivedAt = "2026-08-31T19:06:41.952385+00:00")
    private val card = SaleHistoryPaymentDto(id = "p-3", method = "card", amount = 500.0, receivedAt = "2026-08-31T19:06:41.952385+00:00")

    @Test
    fun `a payment a mirror on the same bill undid was reversed`() {
        assertTrue(wasReversed(cash, listOf(cash, cashMirror, card)))
    }

    @Test
    fun `the mirror itself is a reversal, not a reversed payment`() {
        assertFalse(wasReversed(cashMirror, listOf(cash, cashMirror, card)))
    }

    @Test
    fun `the payment that replaced a reversed one still stands`() {
        assertFalse(wasReversed(card, listOf(cash, cashMirror, card)))
    }

    @Test
    fun `a payment nothing reversed still stands`() {
        assertFalse(wasReversed(juice, listOf(juice)))
    }

    // TESTINV-0107: cash → juice → cash. The juice row replaced the first cash and was then
    // undone itself.
    @Test
    fun `a replacement that was later reversed too is marked as well`() {
        val juiceInstead = SaleHistoryPaymentDto(id = "p-3", method = "juice", amount = 500.0)
        val juiceMirror = SaleHistoryPaymentDto(id = "p-4", method = "juice", amount = -500.0, reversesPaymentId = "p-3")
        val cashAgain = SaleHistoryPaymentDto(id = "p-5", method = "cash", amount = 500.0)
        val rows = listOf(cash, cashMirror, juiceInstead, juiceMirror, cashAgain)
        assertEquals(listOf(true, false, true, false, false), rows.map { wasReversed(it, rows) })
    }

    // Matched on the id, never on method and amount: two identical cash payments, one undone.
    @Test
    fun `only the payment the mirror points at is reversed`() {
        val twin = cash.copy(id = "p-9")
        assertFalse(wasReversed(twin, listOf(cash, twin, cashMirror)))
    }

    // A row decoded without its id must not match every row that reverses nothing
    // (null == null) — including itself.
    @Test
    fun `a payment with no id is never called reversed`() {
        val noId = SaleHistoryPaymentDto(method = "cash", amount = 500.0)
        assertFalse(wasReversed(noId, listOf(noId, card)))
    }

    // A credit note's mirrors point at payments on the INVOICE. None of its own rows was undone.
    @Test
    fun `a credit note's refund rows are not reversed payments`() {
        val refund = SaleHistoryPaymentDto(id = "p-7", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        assertFalse(wasReversed(refund, listOf(refund)))
    }

    // Which rows the dialog lists. An invoice shows its whole ledger, as the web's payments
    // panel does — the reversed original AND the mirror that undid it.
    @Test
    fun `an invoice lists the reversal beside the payment it undid`() {
        assertEquals(listOf(cash, cashMirror, card), dialogPaymentRows("invoice", false, listOf(cash, cashMirror, card)))
    }

    // The embed comes back in no promised order, and change_payment_method books the mirror
    // and its replacement at the same instant.
    @Test
    fun `an invoice's rows read oldest first, a reversal ahead of what replaced it`() {
        assertEquals(listOf(cash, cashMirror, card), dialogPaymentRows("invoice", false, listOf(card, cashMirror, cash)))
    }

    @Test
    fun `a credit note lists only its refund rows`() {
        val refund = SaleHistoryPaymentDto(id = "p-7", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        assertEquals(listOf(refund), dialogPaymentRows("credit_note", false, listOf(refund)))
    }

    @Test
    fun `a voided credit note lists no refund`() {
        val refund = SaleHistoryPaymentDto(id = "p-7", method = "juice", amount = -1215.0, reversesPaymentId = "p-1")
        assertEquals(emptyList<SaleHistoryPaymentDto>(), dialogPaymentRows("credit_note", true, listOf(refund)))
    }
}
