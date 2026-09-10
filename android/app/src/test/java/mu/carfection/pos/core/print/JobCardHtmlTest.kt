package mu.carfection.pos.core.print

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonElement
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.ChecklistItemDto
import mu.carfection.pos.core.network.FlowInvoiceRefDto
import mu.carfection.pos.core.network.FlowQuoteRefDto
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.JobCommentDto
import mu.carfection.pos.core.network.JobCustomerDto
import mu.carfection.pos.core.network.JobPhotoDto
import mu.carfection.pos.core.network.JobTechDto
import mu.carfection.pos.core.network.JobVehicleDto
import mu.carfection.pos.core.network.QuoteLineDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printed job card must say exactly what the work-order sheet says — same words, same
 * lead rule, same "live invoice only" discipline — because the owner pins this paper in the
 * bay and works from it while the tablet may be across the shop.
 */
class JobCardHtmlTest {

    private fun biz() = ReceiptBiz(name = "Carfectionist", address = "Rose Hill", brn = "BRN123", vatNo = "VAT009")

    private fun job(
        status: String = "in_progress",
        customers: JobCustomerDto? = null,
        vehicles: JobVehicleDto? = null,
        notes: String? = null,
        checklist: List<ChecklistItemDto> = emptyList(),
        damageMarkers: List<JsonElement> = emptyList(),
        invoices: List<FlowInvoiceRefDto> = emptyList(),
        estimatedMinutes: Int? = null,
    ): JobBoardDto = JobBoardDto(
        id = "abcd1234",
        status = status,
        customers = customers,
        vehicles = vehicles,
        notes = notes,
        checklist = checklist,
        damageMarkers = damageMarkers,
        invoices = invoices,
        estimatedMinutes = estimatedMinutes,
    )

    private fun render(
        j: JobBoardDto = job(),
        lines: List<QuoteLineDto> = emptyList(),
        crew: List<String> = emptyList(),
        comments: List<JobCommentDto> = emptyList(),
        photos: List<JobPhotoDto> = emptyList(),
        urls: Map<String, String> = emptyMap(),
    ): String = jobCardHtml(biz(), j, lines, crew, comments, photos, urls)

    @Test
    fun `the studio stands behind the sheet`() {
        val html = render()
        assertTrue(html.contains("CARFECTIONIST"))
        assertTrue(html.contains("BRN BRN123"))
        assertTrue(html.contains("VAT VAT009"))
    }

    /** Customer names come from free typing — they can never be allowed to write markup. */
    @Test
    fun `a hostile customer name cannot inject markup`() {
        val html = render(j = job(customers = JobCustomerDto(name = "<script>alert('x')</script>")))
        assertFalse(html.contains("<script>alert"))
        assertTrue(html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"))
    }

    @Test
    fun `the car and its customer are identified together`() {
        val html = render(
            j = job(
                customers = JobCustomerDto(name = "Ali Khan", phone = "+230 5123 4567"),
                vehicles = JobVehicleDto(plate = "B 1234", make = "BMW", model = "X5", colour = "Black"),
            ),
        )
        assertTrue(html.contains("Ali Khan"))
        assertTrue(html.contains("+230 5123 4567"))
        assertTrue(html.contains("B 1234"))
        assertTrue(html.contains("BMW · X5 · Black"))
    }

    @Test
    fun `the work ordered block lists every service with its quantity`() {
        val html = render(
            lines = listOf(
                QuoteLineDto(title = "Ceramic coating", qty = 2.0),
                QuoteLineDto(title = "Hand wash", qty = 0.5, description = "Two-bucket method"),
            ),
        )
        assertTrue(html.contains(">2×<"))
        assertTrue(html.contains("Ceramic coating"))
        assertTrue(html.contains(">0.5×<"))
        assertTrue(html.contains("Two-bucket method"))
    }

    @Test
    fun `a job with nothing quoted carries no work-ordered block`() {
        val html = render(lines = emptyList())
        assertFalse(html.contains("WORK ORDERED"))
    }

    /** Same rule as the chips on screen: someone leads only once there is a crew to lead. */
    @Test
    fun `the lead is tagged only once there is a crew`() {
        val solo = render(crew = listOf("Sam"))
        assertTrue(solo.contains("Sam"))
        assertFalse(solo.contains("LEAD"))

        val duo = render(crew = listOf("Sam", "Ali"))
        assertTrue(duo.indexOf("Sam") < duo.indexOf("LEAD"))
        assertTrue(duo.contains("Ali"))
    }

    @Test
    fun `an unassigned job does not invent a technician`() {
        val html = render(crew = emptyList())
        assertFalse(html.contains("TECHNICIANS"))
    }

    @Test
    fun `the checklist shows what is done and what remains`() {
        val html = render(j = job(checklist = listOf(ChecklistItemDto("Clay bar", true), ChecklistItemDto("Polish", false))))
        assertTrue(html.contains("☑"))
        assertTrue(html.contains("☐"))
        assertTrue(html.contains("Clay bar"))
        assertTrue(html.contains("Polish"))
        assertTrue(html.contains("1/2"))
    }

    @Test
    fun `a job without a checklist stays clean`() {
        val html = render(j = job(checklist = emptyList()))
        assertFalse(html.contains("CHECKLIST"))
    }

    /** Standing description travels with the card; blank notes stay off the paper. */
    @Test
    fun `notes travel with the card only when there are any`() {
        assertTrue(render(j = job(notes = "Hand wash only — no polish")).contains("Hand wash only — no polish"))
        assertFalse(render().contains("NOTES"))
    }

    @Test
    fun `damage recorded at intake warns on paper`() {
        val html = render(j = job(damageMarkers = listOf(JsonNull, JsonNull)))
        assertTrue(html.contains("2 pre-existing damage marks"))
    }

    @Test
    fun `an undamaged car raises no warning`() {
        val html = render(j = job(damageMarkers = emptyList()))
        assertFalse(html.contains("damage mark"))
    }

    @Test
    fun `statuses read the same on paper as on the board`() {
        assertEquals("SCHEDULED", statusLabel("scheduled"))
        assertEquals("IN PROGRESS", statusLabel("in_progress"))
        assertEquals("READY", statusLabel("ready"))
        assertEquals("DELIVERED", statusLabel("delivered"))
    }

    @Test
    fun `the estimate prints when someone made one`() {
        assertTrue(render(j = job(estimatedMinutes = 90)).contains("~90 min"))
        assertFalse(render().contains("Estimate"))
    }

    /**
     * The bill on the card is the LIVE one — a voided copy must never look like the job was
     * charged (same rule as liveInvoiceOf on the board and saleReceiptDoc's caller).
     */
    @Test
    fun `only the live invoice reaches the paper trail`() {
        val html = render(
            j = job(
                invoices = listOf(
                    FlowInvoiceRefDto(id = "1", number = "INV-0006", docType = "invoice", status = "void"),
                    FlowInvoiceRefDto(id = "2", number = "INV-0007", docType = "invoice", status = "paid", totalIncl = 32000.0),
                ),
            ),
        )
        assertTrue(html.contains("INV-0007"))
        assertTrue(html.contains("(paid)"))
        assertTrue(html.contains(formatMURof()))
        assertFalse(html.contains("INV-0006"))
    }

    @Test
    fun `a draft bill is not presented as a charge`() {
        val html = render(
            j = job(invoices = listOf(FlowInvoiceRefDto(id = "1", number = "INV-0009", docType = "invoice", status = "draft"))),
        )
        assertFalse(html.contains("INV-0009"))
    }

    @Test
    fun `a job with nothing billed carries no invoice line`() {
        val html = render(j = job(invoices = emptyList()))
        assertFalse(html.contains("Invoice "))
    }

    /** liveInvoiceOf keeps the last standing bill — the one the customer will actually pay. */
    @Test
    fun `the live invoice is the last one that still stands`() {
        val j = job(
            invoices = listOf(
                FlowInvoiceRefDto(id = "1", number = "INV-0010", docType = "invoice", status = "issued"),
                FlowInvoiceRefDto(id = "2", number = "INV-0011", docType = "invoice", status = "draft"),
            ),
        )
        assertEquals("INV-0010", liveInvoiceOf(j)?.number)
        assertNull(liveInvoiceOf(job()))
    }

    /** Photos are signed URLs fetched by the WebView; only resolvable ones can print. */
    @Test
    fun `photos print grouped under their phase`() {
        val html = render(
            photos = listOf(
                JobPhotoDto(id = "p1", storagePath = "t/j/b1.jpg", phase = "before"),
                JobPhotoDto(id = "p2", storagePath = "t/j/a1.jpg", phase = "after"),
            ),
            urls = mapOf("p1" to "https://x/b1.jpg", "p2" to "https://x/a1.jpg"),
        )
        assertTrue(html.contains("BEFORE"))
        assertTrue(html.contains("AFTER"))
        assertTrue(html.contains("https://x/b1.jpg"))
        assertTrue(html.contains("https://x/a1.jpg"))
    }

    @Test
    fun `a photo whose url never arrived is skipped rather than printed broken`() {
        val html = render(
            photos = listOf(JobPhotoDto(id = "p1", storagePath = "t/j/b1.jpg", phase = "before")),
            urls = emptyMap(),
        )
        assertFalse(html.contains("BEFORE"))
        assertFalse(html.contains("<img"))
    }

    @Test
    fun `comments carry who said them and when`() {        val html = render(
            comments = listOf(JobCommentDto(id = "c1", body = "Customer called — wants it by 4", createdAt = "2026-08-22T09:30:00Z", creator = JobTechDto("Sam Ong"))),
        )
        assertTrue(html.contains("Customer called — wants it by 4"))
        assertTrue(html.contains("Sam"))
        // Fixed Mauritius offset (+04), so the stamp is deterministic: 09:30Z is 13:30 local.
        assertTrue(html.contains("22 Aug 13:30"))
    }

    /**
     * The paper travels with the car: a tech or cashier reading it must see the
     * deposit without opening anything — agreed, paid, and still owed.
     */
    @Test
    fun `an agreed deposit prints with what is paid and owed`() {
        val html = render(
            j = job().copy(
                sourceQuote = FlowQuoteRefDto(depositDue = 412.0),
                invoices = listOf(
                    FlowInvoiceRefDto(id = "1", number = "INV-0100", docType = "invoice", status = "partly_paid", totalIncl = 1650.0, amountPaid = 412.0),
                ),
            ),
        )
        assertTrue(html.contains("Deposit agreed"))
        assertTrue(html.contains(mu.carfection.pos.core.money.formatMUR(41200)))
        assertTrue(html.contains("Balance due"))
        assertTrue(html.contains(mu.carfection.pos.core.money.formatMUR(123800)))
    }

    @Test
    fun `a job with no deposit and nothing paid carries no money block`() {
        val html = render()
        assertFalse(html.contains("Deposit agreed"))
        assertFalse(html.contains("Balance due"))
    }

    @Test
    fun `a settled bill reads paid in full, not owed`() {
        val html = render(
            j = job().copy(
                sourceQuote = FlowQuoteRefDto(depositDue = 412.0),
                invoices = listOf(
                    FlowInvoiceRefDto(id = "1", number = "INV-0101", docType = "invoice", status = "paid", totalIncl = 1650.0, amountPaid = 1650.0),
                ),
            ),
        )
        assertTrue(html.contains("Paid in full"))
        assertFalse(html.contains("rowline warn"))
    }
}

/** The MUR formatting the refs row uses — spelled through so a money regression fails here too. */
private fun formatMURof(): String =
    mu.carfection.pos.core.money.formatMUR(mu.carfection.pos.core.money.rupeesToCents(32000.0))
