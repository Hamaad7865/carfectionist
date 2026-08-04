package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.network.FlowInvoiceRefDto
import mu.carfection.pos.core.network.JobStatusRefDto
import mu.carfection.pos.core.network.QuoteRowDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which quotes are still live work.
 *
 * A00023 sat in the working list looking active while both invoices raised from it had been
 * voided — nothing was owed, nothing was booked, and it still read as something to chase.
 */
class QuoteRetireTest {

    private fun quote(
        status: String = "accepted",
        job: String? = null,
        invoices: List<Pair<String, String>> = emptyList(),
    ) = QuoteRowDto(
        id = "q1", number = "A00023", status = status,
        job = job?.let { JobStatusRefDto(it) },
        invoices = invoices.mapIndexed { i, (num, st) -> FlowInvoiceRefDto("i$i", num, "invoice", st) },
    )

    /** Mirrors QuoteViewModel.isRetired — kept in step by these cases. */
    private fun retired(q: QuoteRowDto): Boolean {
        if (q.status == "void" || q.status == "declined" || q.status == "expired") return true
        if (q.job?.status == "delivered" || q.job?.status == "cancelled") return true
        val bills = q.invoices.filter { it.docType == "invoice" }
        if (bills.isEmpty()) return false
        return bills.all { it.status == "void" } || bills.any { it.status == "paid" }
    }

    @Test
    fun `a quote whose invoices were all voided is finished business`() {
        assertTrue(retired(quote(invoices = listOf("INV-0040" to "void", "INV-0038" to "void"))))
    }

    @Test
    fun `one live invoice keeps the quote on the list`() {
        assertTrue(
            "money is still outstanding here",
            !retired(quote(invoices = listOf("INV-0040" to "void", "INV-0041" to "issued"))),
        )
    }

    /**
     * The owner's case: A00053, signed, with INV-0063 paid in full — and still sitting in
     * the working list offering to create a job. Agreed, billed and settled is finished
     * business; the receipt is found in Sales, not here.
     */
    @Test
    fun `a paid bill retires the quote`() {
        assertTrue(retired(quote(invoices = listOf("INV-0063" to "paid"))))
        assertTrue(
            "a re-bill that got paid counts, whatever was voided before it",
            retired(quote(invoices = listOf("INV-0062" to "void", "INV-0063" to "paid"))),
        )
    }

    /** Part-paid is not paid: there is still a balance to chase. */
    @Test
    fun `a partly paid bill keeps the quote live`() {
        assertFalse(retired(quote(invoices = listOf("INV-0063" to "partly_paid"))))
    }

    /**
     * The case that must NOT be swept up: a quote nobody has billed yet is the most live thing
     * on the list, and "all of zero invoices are void" is vacuously true without the guard.
     */
    @Test
    fun `a quote with no invoices at all stays live`() {
        assertFalse(retired(quote(invoices = emptyList())))
    }

    @Test
    fun `a voided quote is retired whatever else is true`() {
        assertTrue(retired(quote(status = "void")))
    }

    /**
     * The customer said no. It is finished business exactly like a void — but it is a
     * DIFFERENT fact, and the whole point of separating them is that one is a lost sale
     * worth counting and the other is paperwork raised in error.
     */
    @Test
    fun `a declined quote leaves the working list`() {
        assertTrue(retired(quote(status = "declined")))
        assertTrue(retired(quote(status = "expired")))
    }

    @Test
    fun `a sent quote still waiting on the customer stays`() {
        assertFalse(retired(quote(status = "issued")))
    }

    @Test
    fun `cancelled and delivered work stays retired`() {
        assertTrue(retired(quote(job = "cancelled")))
        assertTrue(retired(quote(job = "delivered")))
    }

    @Test
    fun `work in progress is live`() {
        assertFalse(retired(quote(job = "in_progress")))
        assertFalse(retired(quote(status = "draft")))
    }
}
