package mu.carfection.pos.core.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printed slip, pinned against the studio's OWN receipt (25-07-2026, ticket No. 11) —
 * the layout the owner asked us to match exactly.
 *
 * Every figure below is transcribed from that paper and reconciles:
 *   line disc  = up x pct/100      608.30 = 1738.00 x 0.35
 *   line total = up - disc        1129.70 = 1738.00 - 608.30
 *   Subtotal   = SUM(full price)  2233.00 = 1738.00 + 495.00
 *   Discount   = SUM(saved)        682.55 = 608.30 + 74.25
 *   Total      = Subtotal - Disc  1550.45
 *   excl. VAT  = Total / 1.15     1348.22   (prices are VAT-INCLUSIVE)
 *   VAT        = Total - excl      202.23
 */
class ReceiptTextTest {

    private val biz = ReceiptBiz(
        name = "Carfectionist",
        address = "Helvetia, 80840 Moka, MU",
        brn = "C22190760",
        vatNo = "VAT28070619",
        phone = "+230 5258 8854",
        logoFile = null,
        footer = "Thank you for visiting.",
    )

    /** The reference sale: two discounted lines, paid by card. */
    private fun referenceDoc() = ReceiptDoc(
        biz = biz,
        invoiceNo = "INV-0031",
        dateTime = "25-07-2026 12:08:44",
        cashier = "ANSHIKA",
        customer = "Walk-in",
        lines = listOf(
            ReceiptLine("HANGING CAR DIFFU", 1.0, inclCents = 112970, unitInclCents = 173800, grossInclCents = 173800, discountPct = 35.0),
            ReceiptLine("SAVORE CARD AIR FR", 1.0, inclCents = 42075, unitInclCents = 49500, grossInclCents = 49500, discountPct = 15.0),
        ),
        subtotalCents = 223300,
        vatRatePct = 15,
        vatCents = 20223,
        discountCents = 68255,
        totalCents = 155045,
        payLabel = "Bank card",
        paidCents = 155045,
        changeCents = 0,
        onAccount = false,
        ticketNo = 11,
        billNo = "1-N00000028",
        terminalNo = 1,
        vatGroups = listOf(ReceiptVatGroup(15.0, 134822, 20223)),
    )

    private fun render(d: ReceiptDoc = referenceDoc()) = ReceiptText.render(d, 48)

    // ── the arithmetic the paper has to state ────────────────────────────────────

    @Test
    fun `subtotal minus discount equals the total`() {
        val d = referenceDoc()
        assertEquals(d.totalCents, d.subtotalCents - d.discountCents)
    }

    @Test
    fun `the lines at full price sum to the subtotal`() {
        val d = referenceDoc()
        assertEquals(d.subtotalCents, d.lines.sumOf { it.grossInclCents })
    }

    @Test
    fun `each line states what it saved`() {
        val d = referenceDoc()
        assertEquals(60830L, d.lines[0].discountInclCents)
        assertEquals(7425L, d.lines[1].discountInclCents)
        assertEquals(d.discountCents, d.lines.sumOf { it.discountInclCents })
    }

    // ── the layout, section by section ──────────────────────────────────────────

    @Test
    fun `header prints the address as two centred lines, not one`() {
        val out = render().lines()
        assertTrue("address line 1", out.any { it.trim() == "Helvetia" })
        assertTrue("address line 2", out.any { it.trim() == "80840 Moka, MU" })
    }

    @Test
    fun `the numbered sale block reads like the reference`() {
        val out = render().lines()
        assertTrue("ticket no", out.any { it.contains("No. 11") })
        assertTrue("vat invoice", out.any { it.contains("NUM VAT INVOICE INV-0031") })
        assertTrue("bill ref", out.any { it.contains("Bill 1-N00000028") })
        assertTrue("sale mode", out.any { it.contains("Sale - SALES [CARFECTIONIST]") })
        assertTrue("timestamp", out.any { it.contains("25-07-2026 12:08:44") })
        assertTrue("customer", out.any { it.contains("Customer : Walk-in") })
    }

    /** A named customer is printed; an unnamed counter sale still says who it was for. */
    @Test
    fun `the slip always names the customer, walk-in included`() {
        assertTrue(render().contains("Customer : Walk-in"))
        assertTrue(ReceiptText.render(referenceDoc().copy(customer = "ANESH KUMAR"), 48).contains("Customer : ANESH KUMAR"))
        // A long name must not push the line off the paper at either width.
        for (w in listOf(32, 48)) {
            ReceiptText.render(referenceDoc().copy(customer = "Jean-Christophe Ramgoolam-Beeharry"), w).lines().forEach {
                val printed = it.replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "")
                assertTrue("w=$w overflowed (${printed.length}): $printed", printed.length <= w)
            }
        }
    }

    /** A business client's own BRN/VAT ride directly under their name, above the items —
     *  the buyer's fiscal identity, kept apart from the issuer's in the footer. */
    @Test
    fun `a business client's BRN and VAT print under the customer name`() {
        val out = ReceiptText.render(
            referenceDoc().copy(customer = "ACME Ltd", customerBrn = "C12345678", customerVatNo = "VAT20345678"), 48,
        )
        val custAt = out.indexOf("Customer : ACME Ltd")
        val brnAt = out.indexOf("BRN : C12345678")
        val vatAt = out.indexOf("VAT No : 20345678")
        val itemsAt = out.indexOf("Designation")
        assertTrue("customer then BRN", custAt in 0 until brnAt)
        assertTrue("BRN then VAT", brnAt < vatAt)
        assertTrue("client block sits above the items", vatAt in 0 until itemsAt)
    }

    @Test
    fun `the client VAT number is stated without its stored VAT prefix`() {
        val out = ReceiptText.render(referenceDoc().copy(customerVatNo = "VAT20345678"), 48)
        assertTrue(out.contains("VAT No : 20345678"))
        assertFalse(out.contains("VAT No : VAT20345678"))
    }

    @Test
    fun `a walk-in with no fiscal numbers prints neither client line`() {
        // The footer still carries the ISSUER's BRN/VAT — scope the check to the buyer's block.
        val out = ReceiptText.render(referenceDoc().copy(customer = "Walk-in", customerBrn = null, customerVatNo = null), 48)
        val block = out.substring(out.indexOf("Customer : Walk-in"), out.indexOf("Designation"))
        assertFalse("no client BRN", block.contains("BRN"))
        assertFalse("no client VAT", block.contains("VAT"))
    }

    /**
     * Emphasis, matching the studio's slip: the numbers that identify the sale, each item,
     * the money the customer pays, and the thank-you. The discount sub-lines, the column
     * header and the tax breakdown stay light so the bold actually means something.
     */
    @Test
    fun `the lines the reference prints heavy are the ones we embolden`() {
        fun isBold(needle: String) = render().lines()
            .first { it.contains(needle) }
            .let { it.contains(ESC_BOLD_ON) && it.contains(ESC_BOLD_OFF) }

        listOf("No. 11", "NUM VAT INVOICE", "Bill 1-N", "HANGING CAR DIFFU", "SAVORE CARD AIR FR",
               "Total: 1550.45Rs", "excl. VAT : 1348.22Rs", "BANK CARD", "Thank you for visiting.")
            .forEach { assertTrue("expected BOLD: $it", isBold(it)) }

        listOf("Initial price : 1738.00", "Discount 35.0% / 608.30", "Qty Designation",
               "Subtotal :", "TAUX NORMAL")
            .forEach { assertFalse("expected light: $it", isBold(it)) }
    }

    @Test
    fun `the bill reference is terminal and padded order number`() {
        assertEquals("1-N00000028", mu.carfection.pos.core.data.billRef(28L, 1))
        assertEquals("2-N00003210", mu.carfection.pos.core.data.billRef(3210L, 2))
        // Unknown terminal falls back to 1; an unknown bill number omits the line entirely.
        assertEquals("1-N00000005", mu.carfection.pos.core.data.billRef(5L, null))
        assertEquals(null, mu.carfection.pos.core.data.billRef(null, 1))
    }

    @Test
    fun `items print qty, designation, full unit price and the discounted total`() {
        val out = render().lines()
        assertTrue("column header", out.any { it.startsWith("Qty ") && it.contains("Designation") && it.contains("UP") && it.trimEnd().endsWith("Total") })
        // The row is emphasised, so strip the bold sentinels before reading its columns.
        val row = out.first { it.contains("HANGING CAR DIFFU") }
            .replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "")
        assertTrue("qty first", row.startsWith("1"))
        assertTrue("UP is the FULL price, not the discounted one", row.contains("1738.00"))
        assertTrue("line total is what it cost", row.contains("1129.70"))
    }

    @Test
    fun `a discounted line spells the saving out underneath`() {
        val out = render()
        assertTrue(out.contains("Initial price : 1738.00"))
        assertTrue(out.contains("Discount 35.0% / 608.30"))
        assertTrue(out.contains("Initial price : 495.00"))
        assertTrue(out.contains("Discount 15.0% / 74.25"))
    }

    @Test
    fun `totals block shows what the customer saved`() {
        val out = render()
        assertTrue("subtotal is PRE-discount", out.contains("2233.00"))
        assertTrue("discount", out.contains("682.55"))
        assertTrue("total", out.contains("Total: 1550.45Rs"))
        assertTrue("excl vat", out.contains("excl. VAT : 1348.22Rs"))
    }

    @Test
    fun `tender line names the method and the amount`() {
        assertTrue(render().contains("1   BANK CARD : 1550.45Rs"))
    }

    /** The leading digit counts tenders of that kind — a split used to print "1" on every row. */
    @Test
    fun `a split bill counts each method rather than printing 1 three times`() {
        val d = referenceDoc().copy(
            payLabel = "Split",
            payments = listOf(
                ReceiptPayment("25/07 12:08", "Cash", 50000),
                ReceiptPayment("25/07 12:09", "Cash", 30000),
                ReceiptPayment("25/07 12:10", "Card", 75045),
            ),
        )
        val out = ReceiptText.render(d, 48)
        assertTrue("two cash legs collapse into one counted row", out.contains("2   CASH : 800.00Rs"))
        assertTrue("the card leg stands alone", out.contains("1   CARD : 750.45Rs"))
        // And the tenders still add up to the bill.
        assertEquals(d.totalCents, 50000L + 30000L + 75045L)
    }

    @Test
    fun `tax breakdown states the rate, the tax, and both bases`() {
        val out = render()
        assertTrue(out.contains("TAUX NORMAL 15.0% : 202.23Rs"))
        assertTrue(out.contains("excl. VAT = 1348.22Rs / Incl. tax = 1550.45Rs"))
    }

    @Test
    fun `fiscal footer carries the studio's identity and the operator`() {
        val out = render().lines()
        assertTrue("thanks", out.any { it.contains("Thank you for visiting.") })
        assertTrue("terminal", out.any { it.trim() == "Appareil 1" })
        assertTrue("brn", out.any { it.contains("BRN : C22190760") })
        // Stored as "VAT28070619" — the slip states the number under its own label.
        assertTrue("vat number without the stored prefix", out.any { it.contains("VAT number : 28070619") })
        assertTrue("operator", out.any { it.trim() == "ANSHIKA" })
    }

    @Test
    fun `money prints without thousands separators, like the reference`() {
        // The studio's slip reads "2233.00", never "2,233.00". Checked on the money itself —
        // the address line legitimately carries a comma ("80840 Moka, MU").
        val moneyLines = render().lines().filter { it.contains("2233") || it.contains("1550.45") || it.contains("1738") }
        assertTrue("expected money lines to check", moneyLines.isNotEmpty())
        moneyLines.forEach { assertFalse("grouped separator in: $it", it.contains(",")) }
    }

    /**
     * A real live line (WIPER 16: unit 573.91 net, 5% off → stored 545.21 + 81.78 VAT).
     *
     * 5% of the Rs 660.00 shelf price is Rs 33.00, but the ledger's actual saving is Rs 33.01 —
     * VAT rounds once on the discounted net and once on the full net, and the two don't meet.
     * The slip prints the ACTUAL saving, because 660.00 − 33.01 = 626.99 foots against the line
     * total and 660.00 − 33.00 = 627.00 does not. The percentage beside it is a description of
     * the deal, not the arithmetic. Do not "fix" this to the percentage figure.
     */
    @Test
    fun `the printed saving is the one that makes the column add up`() {
        val l = ReceiptLine("WIPER 16", 1.0, inclCents = 62699, unitInclCents = 66000, grossInclCents = 66000, discountPct = 5.0)
        assertEquals(3301L, l.discountInclCents)
        assertEquals(l.inclCents, l.grossInclCents - l.discountInclCents)
        val out = ReceiptText.render(referenceDoc().copy(lines = listOf(l), subtotalCents = 66000, discountCents = 3301, totalCents = 62699), 48)
        assertTrue(out.contains("Discount 5.0% / 33.01"))
    }

    // ── what must NOT appear ────────────────────────────────────────────────────

    @Test
    fun `never claims another vendor's fiscal certification`() {
        val out = render().uppercase()
        // NF525 is a FRENCH fiscal-software certification and the rest is Cashmag's build
        // signature. Printing either would claim a certification we do not hold.
        assertFalse("NF525", out.contains("NF525"))
        assertFalse("Cashmag", out.contains("CASHMAG"))
    }

    @Test
    fun `an undiscounted sale prints no discount lines at all`() {
        val d = referenceDoc().copy(
            lines = listOf(ReceiptLine("WASH & VACUUM", 1.0, inclCents = 71500, unitInclCents = 71500, grossInclCents = 71500)),
            subtotalCents = 71500, discountCents = 0, totalCents = 71500, vatCents = 9326,
            vatGroups = listOf(ReceiptVatGroup(15.0, 62174, 9326)),
        )
        val out = ReceiptText.render(d, 48)
        assertFalse("no Initial price", out.contains("Initial price"))
        assertFalse("no Discount row", out.contains("Discount"))
    }

    @Test
    fun `a reprint declares itself, the original does not`() {
        assertFalse(render().contains("Duplicata"))
        val re = ReceiptText.render(referenceDoc().copy(duplicataNo = 2, duplicataAt = "2026-07-25 12:58:45"), 48)
        assertTrue(re.contains("Duplicata 2 - 2026-07-25 12:58:45"))
    }

    @Test
    fun `a void reprint is stamped`() {
        assertTrue(ReceiptText.render(referenceDoc().copy(voided = true), 48).contains("*** VOID ***"))
    }

    /** Matches the web card's showTenders = !r.voided && r.isInvoice — a voided invoice must
     *  never tell the customer money is owed or was collected, on account or otherwise. */
    @Test
    fun `a voided on-account invoice prints no tender or balance lines`() {
        val out = ReceiptText.render(referenceDoc().copy(voided = true, onAccount = true, balanceDueCents = 155045), 48)
        assertFalse("no ON ACCOUNT", out.contains("ON ACCOUNT"))
        assertFalse("no BALANCE DUE", out.contains("BALANCE DUE"))
        assertFalse("no tender line", out.contains("BANK CARD"))
    }

    @Test
    fun `a voided paid invoice prints no tender or change lines either`() {
        val out = ReceiptText.render(referenceDoc().copy(voided = true, changeCents = 500), 48)
        assertFalse("no tender line", out.contains("BANK CARD"))
        assertFalse("no change line", out.contains("Change"))
        assertFalse("no balance line", out.contains("BALANCE DUE"))
    }

    // ── the paper it has to physically fit on ───────────────────────────────────

    @Test
    fun `no line overflows the paper at either width`() {
        for (w in listOf(32, 48)) {
            ReceiptText.render(referenceDoc(), w).lines().forEach { raw ->
                // Bold sentinels are single chars that become 3-byte ESC codes — they cost
                // no columns on the paper, so measure the line without them.
                val printed = raw.replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "")
                assertTrue("w=$w overflowed (${printed.length}): $printed", printed.length <= w)
            }
        }
    }

    @Test
    fun `the studio name is not printed twice when a logo is raster-printed above it`() {
        // The transport prepends the logo image; printing the name too would duplicate it.
        val withLogo = ReceiptText.render(referenceDoc().copy(biz = biz.copy(logoFile = "/data/logo.png")), 48)
        assertFalse(withLogo.lines().any { it.trim() == "CARFECTIONIST" })
        assertTrue(render().lines().any { it.contains("CARFECTIONIST") && !it.contains("SALES") })
    }
}
