package mu.carfection.pos.core.hardware

import mu.carfection.pos.core.data.overlayIssuer
import mu.carfection.pos.core.network.IssuerCompanyDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The tyre centre's two companies on the tablet's slip — the twin of the web's
 * two-company-paper.test.tsx. The VAT tyre company prints exactly the slip every shop prints
 * today; the non-VAT service company prints an INVOICE with no VAT number and no VAT rows.
 * A one-company shop's slip is byte-for-byte unchanged.
 */
class TwoCompanySlipTest {

    private val shop = ReceiptBiz(
        name = "Tyre Centre", address = "Port Louis, MU", brn = "C11111111", vatNo = "VAT20000001",
        phone = "+230 5000 0000", logoFile = null, footer = "Thank you",
    )

    private fun tyreSlip(biz: ReceiptBiz = shop) = ReceiptDoc(
        biz = biz, invoiceNo = "TINV-0001", dateTime = "23 Nov 2026 10:00", cashier = "STAFF", customer = "Walk-in",
        lines = listOf(ReceiptLine("TYRE 205/55R16", 2.0, inclCents = 460000, unitInclCents = 230000)),
        subtotalCents = 460000, vatRatePct = 15, vatCents = 60000, discountCents = 0, totalCents = 460000,
        payLabel = "Card", paidCents = 460000, changeCents = 0, onAccount = false,
        vatGroups = listOf(ReceiptVatGroup(15.0, 400000, 60000)),
    )

    private val serviceBiz = shop.copy(name = "Wheel Services", brn = "C22222222", vatNo = null, vatRegistered = false)

    private fun serviceSlip() = ReceiptDoc(
        biz = serviceBiz, invoiceNo = "TWS-0001", dateTime = "23 Nov 2026 10:00", cashier = "STAFF", customer = "Walk-in",
        lines = listOf(ReceiptLine("WHEEL ALIGNMENT", 1.0, inclCents = 130000, unitInclCents = 130000)),
        subtotalCents = 130000, vatRatePct = 0, vatCents = 0, discountCents = 0, totalCents = 130000,
        payLabel = "Card", paidCents = 130000, changeCents = 0, onAccount = false,
        vatGroups = listOf(ReceiptVatGroup(0.0, 130000, 0)),
    )

    @Test
    fun `a VAT-registered company prints the slip exactly as before`() {
        listOf(32, 48).forEach { w ->
            assertEquals(ReceiptText.render(tyreSlip(), w), ReceiptText.render(tyreSlip(shop.copy(vatRegistered = true)), w))
        }
        val out = ReceiptText.render(tyreSlip(), 48)
        assertTrue(out.contains("NUM VAT INVOICE TINV-0001"))
        assertTrue(out.contains("TAUX NORMAL 15.0%"))
        assertTrue(out.contains("excl. VAT"))
        assertTrue(out.contains("VAT number : 20000001"))
        assertFalse(out.contains("Not registered for VAT"))
    }

    @Test
    fun `the non-VAT company's slip is an invoice with no VAT anywhere`() {
        listOf(32, 48).forEach { w ->
            val out = ReceiptText.render(serviceSlip(), w)
            assertTrue(out.contains("NUM INVOICE TWS-0001"))
            assertFalse(out.contains("NUM VAT INVOICE"))
            assertFalse(out.contains("TAUX NORMAL"))
            assertFalse(out.contains("excl. VAT"))
            assertFalse(out.contains("VAT number"))
            assertTrue(out.contains("BRN : C22222222"))
            assertTrue(out.contains("Sale - SALES [WHEEL SERVICES]"))
            // On 32 columns the sentence wraps; every word of it is still printed.
            val flat = out.lines().joinToString(" ") { it.trim() }
            assertTrue(flat, flat.contains("Not registered for VAT — no VAT charged"))
            out.lines().forEach { assertTrue("line overflows $w columns: '$it'", it.replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "").length <= w) }
        }
    }

    @Test
    fun `the printer gets a plain dash for the sentence's em dash`() {
        val bytes = cp437Bytes("for VAT — no VAT")
        assertFalse(bytes.contains('?'.code.toByte()))
    }

    // ── overlayIssuer: whose identity the slip prints ─────────────────────────────────────

    private val settings = ReceiptBiz(
        name = "Carfectionist", address = "Moka", brn = "C1", vatNo = "VAT1", phone = "5",
        logoFile = "/data/logo.img", footer = "Thanks",
    )

    private fun company(
        isDefault: Boolean = false, vat: Boolean = true, legal: String? = "Wheel Services Ltd", trading: String? = "Wheel Services",
        brn: String? = "C2", vatNo: String? = null, phone: String? = "", address: String? = null,
        logo: String? = null, footer: String? = null,
    ) = IssuerCompanyDto(
        id = "co", legalName = legal, tradingName = trading, isDefault = isDefault, vatRegistered = vat,
        brn = brn, vatNumber = vatNo, address = address, phone = phone, receiptLogoPath = logo, receiptFooterText = footer,
    )

    @Test
    fun `the default company, or none, is the shop's own settings untouched`() {
        assertEquals(settings, overlayIssuer(settings, null, "logo.png"))
        assertEquals(settings, overlayIssuer(settings, company(isDefault = true, trading = "Other"), "logo.png"))
    }

    @Test
    fun `another company lays its identity over the shop's, sharing only where it trades from and its look`() {
        val got = overlayIssuer(settings, company(vat = false, vatNo = "VAT9"), "logo.png")
        assertEquals("Wheel Services", got.name)
        assertEquals("C2", got.brn)
        assertNull("a non-VAT company prints no VAT number", got.vatNo)
        assertFalse(got.vatRegistered)
        assertEquals("5", got.phone)
        assertEquals("Moka", got.address)
        assertEquals("Thanks", got.footer)
        assertEquals("/data/logo.img", got.logoFile)
    }

    @Test
    fun `never borrows the other company's BRN, VAT number or name`() {
        val got = overlayIssuer(settings, company(trading = "", brn = "", vatNo = ""), "logo.png")
        assertEquals("trades under its legal name", "Wheel Services Ltd", got.name)
        assertNull(got.brn)
        assertNull(got.vatNo)
    }

    @Test
    fun `a company with its own logo cannot print the shop's`() {
        assertNull(overlayIssuer(settings, company(logo = "wheel.png"), "logo.png").logoFile)
        assertEquals("/data/logo.img", overlayIssuer(settings, company(logo = "logo.png"), "logo.png").logoFile)
    }
}
