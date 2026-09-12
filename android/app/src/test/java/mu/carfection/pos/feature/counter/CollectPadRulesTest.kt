package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.network.JobStatusRefDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Which latched bills the collect pad may open.
 *
 * The latch used to open any bill raw — including the two kinds the TO COLLECT list
 * itself refuses to show — so the pad offered to take money where the money RPCs could
 * only refuse. This mirrors loadLists' filters: hide drafts unless the job is
 * ready/delivered or the bill is a jobless quote raising, and hide zero-balance bills.
 */
class CollectPadRulesTest {

    private fun bill(
        status: String = "issued",
        totalIncl: Double = 1000.0,
        amountPaid: Double = 0.0,
        jobId: String? = "j1",
        jobStatus: String? = null,
        sourceDocumentId: String? = null,
    ) = OutstandingInvoiceDto(
        id = "b1", status = status, totalIncl = totalIncl, amountPaid = amountPaid,
        jobId = jobId, jobs = jobStatus?.let { JobStatusRefDto(it) },
        sourceDocumentId = sourceDocumentId,
    )

    @Test
    fun `an issued bill with a balance opens the pad`() {
        assertNull(collectPadBlockReason(bill()))
    }

    @Test
    fun `a partly paid bill still opens the pad`() {
        assertNull(collectPadBlockReason(bill(amountPaid = 400.0)))
    }

    @Test
    fun `a fully settled bill opens nothing`() {
        assertNotNull(collectPadBlockReason(bill(amountPaid = 1000.0)))
    }

    @Test
    fun `a zero-total bill opens nothing`() {
        assertNotNull(collectPadBlockReason(bill(totalIncl = 0.0)))
    }

    @Test
    fun `a draft on a ready job opens the pad`() {
        assertNull(collectPadBlockReason(bill(status = "draft", jobStatus = "ready")))
    }

    @Test
    fun `a draft on a delivered job opens the pad`() {
        assertNull(collectPadBlockReason(bill(status = "draft", jobStatus = "delivered")))
    }

    @Test
    fun `a jobless draft raised from a quote opens the pad - goods have no job to wait for`() {
        assertNull(collectPadBlockReason(bill(status = "draft", jobId = null, sourceDocumentId = "q1")))
    }

    @Test
    fun `a mid-service draft stays shut - the car is still in the bay`() {
        assertNotNull(collectPadBlockReason(bill(status = "draft", jobStatus = "in_progress")))
    }

    @Test
    fun `an abandoned back-office draft stays shut`() {
        assertNotNull(collectPadBlockReason(bill(status = "draft", jobId = null, sourceDocumentId = null)))
    }
}
