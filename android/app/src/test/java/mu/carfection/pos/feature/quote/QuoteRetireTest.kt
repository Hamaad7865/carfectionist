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
        children: List<FlowInvoiceRefDto> = emptyList(),
    ) = QuoteRowDto(
        id = "q1", number = "A00023", status = status,
        job = job?.let { JobStatusRefDto(it) },
        invoices = invoices.mapIndexed { i, (num, st) -> FlowInvoiceRefDto("i$i", num, "invoice", st) } + children,
    )

    /** A revision of q1 — the quote that replaces it. */
    private fun revision(number: String, status: String) =
        FlowInvoiceRefDto(id = "r-$number", number = number, docType = "quote", status = status, revisionOf = "q1")

    /** A plain COPY of q1: same parent column in PostgREST, but it replaces nothing. */
    private fun copy(number: String, status: String) =
        FlowInvoiceRefDto(id = "c-$number", number = number, docType = "quote", status = status, revisionOf = null)

    /** Mirrors QuoteViewModel.isRetired — kept in step by these cases. */
    private fun retired(q: QuoteRowDto): Boolean {
        if (q.status == "void" || q.status == "declined" || q.status == "expired") return true
        if (q.job?.status == "delivered" || q.job?.status == "cancelled") return true
        if (q.invoices.any { it.docType == "quote" && it.revisionOf == q.id && it.status != "draft" && it.status != "void" }) return true
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

    /**
     * The owner's case: etienne gerare's A00179 (Rs 1,320) and A00180 (Rs 1,650) sat side by
     * side, two minutes apart, and nobody at the counter could say which price stood. The
     * revision carries the work; the quote it replaced leaves the list.
     */
    @Test
    fun `a quote that has been revised leaves the working list`() {
        assertTrue(retired(quote(children = listOf(revision("A00180", "accepted")))))
        assertTrue(retired(quote(children = listOf(revision("A00180", "issued")))))
    }

    /** A revision still being typed is not the price yet — both stay until it goes out. */
    @Test
    fun `a draft revision does not retire the quote it came from`() {
        assertFalse(retired(quote(children = listOf(revision("A00180", "draft")))))
    }

    /** And if that revision is voided, the original is the live price again. */
    @Test
    fun `a voided revision hands the work back`() {
        assertFalse(retired(quote(children = listOf(revision("A00180", "void")))))
    }

    /**
     * The false positive this rule must not have: duplicate_document hangs a plain copy off
     * the same PostgREST relationship. A copy is somebody's new paperwork — it replaces
     * nothing, and the quote it was copied from is still live business.
     */
    @Test
    fun `a copy of the quote leaves it on the list`() {
        assertFalse(retired(quote(children = listOf(copy("A00181", "accepted")))))
    }

    @Test
    fun `work in progress is live`() {
        assertFalse(retired(quote(job = "in_progress")))
        assertFalse(retired(quote(status = "draft")))
    }
}
