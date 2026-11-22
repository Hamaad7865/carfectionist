package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.expandSaleLines
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.network.CompanyDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The tyre centre's till: one bill per company, each with its own discount (owner rule
 * 2026-11-22) — the tablet twin of the web's bills.test.ts. A one-company shop never builds
 * bills and keeps its whole-sale discount exactly as before.
 */
class TillBillsTest {

    private val tyres = CompanyDto("co-tyre", "Tyre Centre Ltd", "Tyre Centre", isDefault = true, vatRegistered = true, sortOrder = 0)
    private val services = CompanyDto("co-svc", "Wheel Services Ltd", "Wheel Services", isDefault = false, vatRegistered = false, sortOrder = 1)
    private val companies = listOf(tyres, services)

    private fun product(id: String, cents: Long, company: String?, vat: Double = 15.0, kind: String = "product") = ProductEntity(
        id = id, name = "Item $id", kind = kind, sellingPriceCents = cents, vatRatePct = vat, barcode = null,
        isStocked = false, category = null, lowStockThreshold = null, legalEntityId = company,
    )

    private val tyre = CartLine(product("tyre", 2_950_00, "co-tyre"), 4.0)
    private val valve = CartLine(product("valve", 50_00, null), 4.0) // no company named: the main one
    private val align = CartLine(product("align", 1_300_00, "co-svc", vat = 0.0), 1.0)
    private val cart = listOf(align, tyre, valve)

    @Test
    fun `each line goes to its product's company, else the main one`() {
        assertEquals("co-tyre", companyIdOf(tyre, companies))
        assertEquals("co-tyre", companyIdOf(valve, companies))
        assertEquals("co-svc", companyIdOf(align, companies))
        // A company the till doesn't know (switched off since) bills under the main company.
        assertEquals("co-tyre", companyIdOf(CartLine(product("x", 100, "co-gone"), 1.0), companies))
    }

    @Test
    fun `the sale is one bill per company, in company order, each priced on its own lines`() {
        val bills = tillBills(cart, companies, emptyMap(), 5.0)
        assertEquals(listOf("co-tyre", "co-svc"), bills.map { it.company.id })
        assertEquals(listOf(1, 2), bills[0].lineIndexes)
        assertEquals(listOf(0), bills[1].lineIndexes)
        assertEquals(13_800_00L, bills[0].totals.totalCents) // 4×2,950 + 4×50, +15%
        assertEquals(1_300_00L, bills[1].totals.totalCents) // no VAT
        val all = combinedTotals(cart, bills)
        assertEquals(15_100_00L, all.totalCents)
        assertEquals(1_800_00L, all.vatCents)
        // Line figures stay in cart order, untouched by any bill discount.
        assertEquals(computeDocTotals(cart.map { it.docLine }, null, 0.0, 0).lineExclCents, all.lineExclCents)
    }

    @Test
    fun `a company's discount comes off its own bill only`() {
        val bills = tillBills(cart, companies, mapOf("co-tyre" to CompanyDisc(DiscountMode.PCT, "10")), 5.0)
        assertEquals(12_420_00L, bills[0].totals.totalCents) // 13,800 − 10%
        assertEquals(1_300_00L, bills[1].totals.totalCents)
        assertEquals(13_720_00L, combinedTotals(cart, bills).totalCents)
        assertNull(billsBlockReason(bills))
    }

    @Test
    fun `a bill over its allowance blocks the sale and names the company`() {
        // A service is not discounted by default (policy none): any discount is over the ceiling.
        val svc = CartLine(product("fit", 400_00, "co-svc", vat = 0.0, kind = "service"), 1.0)
        val bills = tillBills(listOf(tyre, svc), companies, mapOf("co-svc" to CompanyDisc(DiscountMode.AMT, "50")), 5.0)
        assertNotNull(bills[1].blockReason)
        assertNull(bills[0].blockReason)
        val why = billsBlockReason(bills)!!
        assertTrue(why, why.startsWith("Wheel Services: "))
        // An owner's approval for that bill lifts it.
        val approved = tillBills(listOf(tyre, svc), companies, mapOf("co-svc" to CompanyDisc(DiscountMode.AMT, "50", approvedMaxCents = 50_00)), 5.0)
        assertNull(billsBlockReason(approved))
    }

    @Test
    fun `issue_checkout gets each discounted company's discount, amounts in rupees`() {
        val bills = tillBills(
            cart, companies,
            mapOf("co-tyre" to CompanyDisc(DiscountMode.PCT, "10", reason = " regular "), "co-svc" to CompanyDisc(DiscountMode.AMT, "")),
            5.0,
        )
        val specs = companyDiscountSpecs(bills)
        assertEquals(1, specs.size)
        assertEquals("co-tyre", specs[0].legalEntityId)
        assertEquals("percent", specs[0].kind)
        assertEquals(10.0, specs[0].value, 0.0)
        assertEquals("regular", specs[0].reason)
        val amt = companyDiscountSpecs(tillBills(cart, companies, mapOf("co-svc" to CompanyDisc(DiscountMode.AMT, "125.50")), 5.0))
        assertEquals(125.5, amt.single().value, 0.0)
    }

    @Test
    fun `a company's bill id is the server's own (checkout_document_ids)`() {
        val draft = "11111111-2222-4333-8444-555555555555"
        assertEquals(draft, checkoutBillId(draft, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", first = true))
        // md5('<draft>:<company>')::uuid, as Postgres computes it.
        assertEquals("6e3d29db-f7e4-7d88-3f3b-610baf3710a0", checkoutBillId(draft, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", first = false))
    }

    @Test
    fun `a whole-sale discount and per-company discounts never travel together`() {
        val spec = companyDiscountSpecs(tillBills(cart, companies, mapOf("co-tyre" to CompanyDisc(DiscountMode.PCT, "10")), 5.0))
        try {
            expandSaleLines(cart, DiscountMode.PCT, basketPct = 5, companyDiscounts = spec)
            fail("both were accepted")
        } catch (_: IllegalArgumentException) { }
        assertEquals(spec, expandSaleLines(cart, companyDiscounts = spec).companyDiscounts)
    }

    // ── the counter state on a several-company till ─────────────────────────────────────

    @Test
    fun `the till prices each bill and its footer reads their sum`() {
        val s = CounterUiState(companies = companies).withCart(cart)
            .withCompanyDisc("co-tyre") { it.copy(text = "10") }
        assertEquals(2, s.tillBills.size)
        assertEquals(13_720_00L, s.totals.totalCents)
        assertNull("no whole-sale discount on this till", s.orderDiscountKind)
        assertEquals("10", s.discText) // the first bill is in focus
        val svc = s.copy(discFocus = "co-svc")
        assertEquals("", svc.discText)
    }

    @Test
    fun `the pad offers the fix for the bill that is blocking, not the lit chip`() {
        val svc = CartLine(product("fit", 400_00, "co-svc", vat = 0.0, kind = "service"), 1.0)
        val s = CounterUiState(companies = companies).withCart(listOf(tyre, svc))
            .withCompanyDisc("co-svc") { it.copy(mode = DiscountMode.AMT, text = "50") }
            .copy(discFocus = "co-tyre") // the cashier moved on to the tyre bill
        assertNotNull(s.discountBlockReason)
        assertTrue("the service bill needs the owner", s.blockAllowance.overCeiling)
    }

    @Test
    fun `emptying the cart ends every company's discount with the ticket`() {
        val s = CounterUiState(companies = companies).withCart(cart)
            .withCompanyDisc("co-tyre") { it.copy(text = "10", reason = "regular", approvedMaxCents = 1) }
            .copy(allocation = "co-svc")
        val cleared = s.withCart(emptyList())
        assertTrue(cleared.companyDiscs.isEmpty())
        assertEquals("proportional", cleared.allocation)
        assertTrue(cleared.withCart(cart).tillBills.all { it.disc == CompanyDisc() })
    }

    @Test
    fun `collecting a bill with a sister bill collects the visit, and offers the pay order`() {
        val tyreBill = mu.carfection.pos.core.network.OutstandingInvoiceDto(
            id = "b1", number = "INV-1", totalIncl = 4600.0, amountPaid = 0.0, status = "issued", legalEntityId = "co-tyre", checkoutGroupId = "b1",
        )
        val svcBill = tyreBill.copy(id = "b2", number = "WS-1", totalIncl = 1300.0, amountPaid = 260.0, legalEntityId = "co-svc")
        val alone = CounterUiState(companies = companies, collect = tyreBill)
        assertEquals(4_600_00L, alone.dueCents)
        assertTrue("one bill: no pay order to choose", alone.allocationChoices.isEmpty())
        val visit = alone.copy(collectGroup = listOf(tyreBill, svcBill))
        assertEquals(5_640_00L, visit.dueCents) // 4,600 + (1,300 − 260 already paid)
        assertEquals(listOf("co-tyre", "co-svc", "proportional"), visit.allocationChoices.map { it.first })
        assertEquals("Tyre Centre first", visit.allocationChoices.first().second)
        // Nothing records while the sister bill is still being looked up.
        assertTrue(!alone.copy(collectGroupPending = true, payText = "100").canRecord)
    }

    @Test
    fun `a quote with tyres and services spans both companies, in company order`() {
        assertEquals(listOf("co-tyre", "co-svc"), quoteCompanies(listOf("co-svc", null, "co-tyre"), companies).map { it.id })
        // An ad-hoc line, or a product of a company switched off since, bills under the main one.
        assertEquals(listOf("co-tyre"), quoteCompanies(listOf(null, "co-gone"), companies).map { it.id })
        assertEquals(listOf("co-svc"), quoteCompanies(listOf("co-svc"), companies).map { it.id })
        // A one-company shop never asks One or Two.
        assertTrue(quoteCompanies(listOf("co-svc", null), listOf(tyres)).isEmpty())
    }

    @Test
    fun `a one-company shop keeps the whole-sale discount and builds no bills`() {
        val s = CounterUiState(companies = listOf(tyres), basketMode = DiscountMode.PCT, basketText = "10").withCart(cart)
        assertTrue(s.tillBills.isEmpty())
        assertEquals("percent", s.orderDiscountKind)
        assertEquals("10", s.discText)
    }
}
