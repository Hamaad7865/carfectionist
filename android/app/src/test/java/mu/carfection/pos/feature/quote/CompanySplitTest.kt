package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.money.DocLineIn
import mu.carfection.pos.core.network.CompanyDto
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The tablet's mirror of the quote split. Same fixture as apps/web's company-split.test.ts and
 * scripts/_verify-quote-split.mjs (which proves the database stores these exact figures):
 * 2 × Rs 2,000 + 15% VAT − 5% on the main company's quote = Rs 4,370.00; Rs 1,300 at the non-VAT
 * company = Rs 1,300.00, no VAT even though the line says 15%.
 */
class CompanySplitTest {
    private val garage = CompanyDto("b-garage", "Garage De L'Est LTEE", "Garage De L'Est", isDefault = true, vatRegistered = true, sortOrder = 0)
    private val service = CompanyDto("a-service", "Service", null, isDefault = false, vatRegistered = false, sortOrder = 1)
    private val companies = listOf(service, garage) // deliberately out of order

    private fun line(unitCents: Long, qty: Double = 1.0, vat: Double = 15.0) =
        DocLineIn(qty = qty, unitCents = unitCents, discountKind = "percent", discountPct = 0.0, discountAmtInclCents = 0, vatRatePct = vat)

    private val productCompany = mapOf("p-brush" to null, "p-align" to service.id, "p-tyre" to garage.id)

    @Test fun `a product's company sells its line - none set, unknown or hand-typed goes to the default`() {
        assertEquals(service.id, lineCompanyId("p-align", productCompany, companies))
        assertEquals(garage.id, lineCompanyId("p-brush", productCompany, companies))
        assertEquals(garage.id, lineCompanyId("p-gone", productCompany, companies))
        assertEquals(garage.id, lineCompanyId(null, productCompany, companies))
    }

    @Test fun `a hand-typed line goes to the draft's stored company`() {
        assertEquals(service.id, lineCompanyId(null, productCompany, companies, draftCompanyId = service.id))
        assertEquals(garage.id, lineCompanyId(null, productCompany, companies, draftCompanyId = "gone"))
        assertEquals(garage.id, lineCompanyId("p-tyre", productCompany, companies, draftCompanyId = service.id))
    }

    @Test fun `the shared fixture lands on the database's figures`() {
        val lines = listOf(line(200_000, qty = 2.0), line(130_000))
        val ids = listOf("p-brush", "p-align")
        val parts = splitByCompany(
            lines, { i -> lineCompanyId(ids[i], productCompany, companies) }, companies,
            mapOf(garage.id to CompanyDiscount("percent", 5.0)),
        )
        assertEquals(listOf(garage.id, service.id), parts.map { it.company.id })
        assertEquals(listOf(0, 1), parts.map { it.index })
        assertEquals(listOf(437_000L, 130_000L), parts.map { it.totals.totalCents })
        assertEquals(0L, parts[1].totals.vatCents)
        assertEquals(567_000L, combinedTotalCents(parts))
    }

    @Test fun `a one-company quote is one part - nothing to split`() {
        val parts = splitByCompany(listOf(line(100_000), line(5_000)), { "b-garage" }, companies)
        assertEquals(1, parts.size)
        assertEquals(listOf(0, 1), parts[0].lineIndexes)
    }

    @Test fun `no companies known - no parts, the screen stays as it was`() {
        assertEquals(0, splitByCompany(listOf(line(100_000)), { null }, emptyList()).size)
    }
}
