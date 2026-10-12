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
}
