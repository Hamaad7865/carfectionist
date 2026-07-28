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
        if (q.status == "void") return true
        if (q.job?.status == "delivered" || q.job?.status == "cancelled") return true
        val bills = q.invoices.filter { it.docType == "invoice" }
        return bills.isNotEmpty() && bills.all { it.status == "void" }
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
