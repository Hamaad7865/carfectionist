package mu.carfection.pos.feature.jobs

import mu.carfection.pos.core.network.FlowInvoiceRefDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A job settled at the counter before anyone marked it ready.
 *
 * JOB-49B3 (27 Oct 2026): the customer added a perfume through "Add to bill" and paid
 * INV-0457 in full while the job still read "in progress". Paying does not hand back an
 * unfinished job, so it sat at "Mark ready (0/4 checklist)" with the car gone. The card
 * now names the paid bill and offers the handover — only when every issued bill is paid.
 */
class PaidAheadTest {

    private fun bill(status: String, number: String = "INV-0457", docType: String = "invoice") =
        FlowInvoiceRefDto(id = number, number = number, docType = docType, status = status, totalIncl = 1595.0)

    @Test
    fun `an in-progress job with its bill paid is paid ahead`() {
        val paid = paidAheadBills("in_progress", listOf(bill("paid")))
        assertEquals(listOf("INV-0457"), paid.map { it.number })
    }

    @Test
    fun `a bill still owing is not paid ahead`() {
        assertTrue(paidAheadBills("in_progress", listOf(bill("issued"))).isEmpty())
        assertTrue(paidAheadBills("in_progress", listOf(bill("partly_paid"))).isEmpty())
    }

    @Test
    fun `one paid bill beside an unpaid one is not paid ahead`() {
        val bills = listOf(bill("paid"), bill("issued", number = "INV-0460"))
        assertTrue(paidAheadBills("in_progress", bills).isEmpty())
    }

    @Test
    fun `drafts and voids neither count nor block`() {
        val bills = listOf(bill("void", number = "INV-0401"), bill("draft", number = "draft"), bill("paid"))
        assertEquals(listOf("INV-0457"), paidAheadBills("in_progress", bills).map { it.number })
        assertTrue(paidAheadBills("in_progress", listOf(bill("draft"), bill("void"))).isEmpty())
    }

    @Test
    fun `a quote is not a bill`() {
        assertTrue(paidAheadBills("in_progress", listOf(bill("accepted", number = "A00383", docType = "quote"))).isEmpty())
    }

    @Test
    fun `only an in-progress job is offered the shortcut`() {
        // ready already has "Car collected"; scheduled has not started; delivered is done.
        listOf("scheduled", "ready", "delivered", "cancelled").forEach { st ->
            assertTrue(st, paidAheadBills(st, listOf(bill("paid"))).isEmpty())
        }
    }
}
