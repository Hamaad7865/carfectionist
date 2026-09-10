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

    /**
     * A deposit left one day and the balance taken another must NOT collapse: the
     * slip is the calculation — what was paid the first time and what the second.
     * (Same-day splits without a deposit still collapse; that shape is pinned above.)
     */
    @Test
    fun `a deposit and its balance print as dated rows, not one grouped row`() {
        val d = referenceDoc().copy(
            payLabel = "Split",
            totalCents = 165000,
            paidCents = 165000,
            balanceDueCents = 0,
            depositAgreedCents = 41200,
            payments = listOf(
                ReceiptPayment("09/09 17:02", "Cash", 41200),
                ReceiptPayment("10/09 21:15", "Cash", 123800),
            ),
        )
        val out = ReceiptText.render(d, 48)
        assertTrue("the agreed deposit still prints", out.contains("DEPOSIT AGREED"))
        assertTrue("deposit leg dated", out.contains("1   CASH 09/09 17:02 : 412.00Rs"))
        assertTrue("balance leg dated", out.contains("1   CASH 10/09 21:15 : 1238.00Rs"))
        assertFalse("no collapsed row", out.contains("2   CASH"))
    }

    /**
     * The shop's own shape: deposit and balance taken the SAME day. Without an
     * agreed deposit that would collapse — with one, every leg still stands with
     * its time, so the slip shows first payment, second payment, then the total.
     */
    @Test
    fun `a deposit itemises every leg with date and time, even on one day`() {
        val d = referenceDoc().copy(
            totalCents = 165000,
            paidCents = 165000,
            balanceDueCents = 0,
            depositAgreedCents = 41200,
            payments = listOf(
                ReceiptPayment("10/09 22:41", "Cash", 41200),
                ReceiptPayment("10/09 22:43", "Cash", 123800),
            ),
        )
        val out = ReceiptText.render(d, 48)
        assertTrue("deposit leg with time", out.contains("1   CASH 10/09 22:41 : 412.00Rs"))
        assertTrue("balance leg with time", out.contains("1   CASH 10/09 22:43 : 1238.00Rs"))
        assertFalse("no collapsed row", out.contains("2   CASH"))
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

    // ── points earned + the running balance (rule 4, 2026-08-10) ────────────────

    @Test
    fun `states what this sale earned and the balance after it, when a customer is named`() {
        val out = ReceiptText.render(referenceDoc().copy(pointsEarned = 11, pointsBalanceAfter = 42), 48)
        assertTrue("earned label", out.contains("Points earned :"))
        assertTrue("earned value", out.contains("11 pts"))
        assertTrue("balance label", out.contains("Points balance :"))
        assertTrue("balance value", out.contains("42 pts"))
    }

    @Test
    fun `prints neither points line for an anonymous walk-in`() {
        // referenceDoc() sets neither field (the default) — exactly what a sale with no
        // customer attached leaves them at.
        val out = render()
        assertFalse(out.contains("Points earned"))
        assertFalse(out.contains("Points balance"))
    }

    @Test
    fun `a voided reprint states neither points line either`() {
        val out = ReceiptText.render(referenceDoc().copy(pointsEarned = 11, pointsBalanceAfter = 42, voided = true), 48)
        assertFalse(out.contains("Points earned"))
        assertFalse(out.contains("Points balance"))
    }

    @Test
    fun `the studio name is not printed twice when a logo is raster-printed above it`() {
        // The transport prepends the logo image; printing the name too would duplicate it.
        val withLogo = ReceiptText.render(referenceDoc().copy(biz = biz.copy(logoFile = "/data/logo.png")), 48)
        assertFalse(withLogo.lines().any { it.trim() == "CARFECTIONIST" })
        assertTrue(render().lines().any { it.contains("CARFECTIONIST") && !it.contains("SALES") })
    }

    // ── account settlement's consolidated receipt (mu.carfection.pos.core.data.consolidatedReceiptDoc) ──

    private fun consolidatedDoc() = referenceDoc().copy(
        invoiceNo = null,
        ticketNo = null,
        billNo = null,
        lines = emptyList(),
        consolidatedSections = listOf(
            ConsolidatedSection(
                invoiceNo = "TESTINV-0082",
                lines = listOf(ReceiptLine("STEAM VALETTING", 1.0, inclCents = 770000, unitInclCents = 770000, grossInclCents = 770000)),
                subtotalCents = 770000, discountCents = 0, totalCents = 770000,
            ),
            ConsolidatedSection(
                invoiceNo = "TESTINV-0083",
                lines = listOf(ReceiptLine("MINI VALETTING", 1.0, inclCents = 495000, unitInclCents = 495000, grossInclCents = 495000)),
                subtotalCents = 495000, discountCents = 0, totalCents = 495000,
            ),
        ),
        subtotalCents = 1265000, discountCents = 0, vatCents = 165000, totalCents = 1265000,
        payments = listOf(ReceiptPayment("23/08 08:30", "Cash", 770000), ReceiptPayment("23/08 08:30", "Cash", 495000)),
        payLabel = null, paidCents = 1265000, changeCents = 0,
        vatGroups = listOf(ReceiptVatGroup(15.0, 1100000, 165000)),
    )

    @Test
    fun `each settled invoice prints under its own number, with its own items and subtotal`() {
        val out = render(consolidatedDoc()).lines()
        assertTrue("first invoice header", out.any { it.contains("Invoice TESTINV-0082") })
        assertTrue("first invoice's line", out.any { it.contains("STEAM VALETTING") })
        assertTrue("first invoice's own total", out.any { it.contains("Invoice total :") && it.contains("7700.00") })
        assertTrue("second invoice header", out.any { it.contains("Invoice TESTINV-0083") })
        assertTrue("second invoice's line", out.any { it.contains("MINI VALETTING") })
        // The first invoice's section must come before the second's — settled oldest first.
        assertTrue(out.indexOfFirst { it.contains("TESTINV-0082") } < out.indexOfFirst { it.contains("TESTINV-0083") })
    }

    @Test
    fun `the grand total covers every invoice, labelled as such`() {
        val out = render(consolidatedDoc())
        assertTrue(out.contains("Grand total: 12650.00Rs"))
        assertFalse("not the single-invoice wording", out.contains("Total: 12650.00Rs"))
    }

    @Test
    fun `no single invoice number or bill reference names the whole settlement`() {
        val out = render(consolidatedDoc())
        assertFalse(out.contains("NUM VAT INVOICE"))
        assertFalse(out.contains("Bill "))
        assertFalse(out.contains("No. "))
    }

    @Test
    fun `every tender across every invoice is itemised by method`() {
        val out = render(consolidatedDoc())
        assertTrue(out.contains("2   CASH : 12650.00Rs"))
    }

    @Test
    fun `the combined tax breakdown still prints for a doc with no flat line list`() {
        val out = render(consolidatedDoc())
        assertTrue(out.contains("TAUX NORMAL 15.0% : 1650.00Rs"))
        assertTrue(out.contains("excl. VAT : 11000.00Rs"))
    }

    /**
     * The reported bug: a customer handing over Rs 7000 cash for a Rs 6159.99 settlement
     * across two invoices got no change line at all — it only ever printed inside the
     * single-payment branch, which a multi-invoice settlement (2+ payment rows) never
     * reaches. Change must show regardless of how many tender rows made up the payment.
     */
    @Test
    fun `change shows even though the payment took more than one tender row`() {
        val withChange = consolidatedDoc().copy(changeCents = 84001) // Rs 840.01, as in the reported case
        val out = render(withChange)
        assertTrue("multi-tender branch still reached", out.contains("2   CASH : 12650.00Rs"))
        assertTrue("change prints anyway", out.contains("Change :"))
        assertTrue(out.contains("840.01"))
    }

    @Test
    fun `no change line at all when nothing was overpaid`() {
        assertFalse(render(consolidatedDoc().copy(changeCents = 0)).contains("Change"))
    }
}

/**
 * The customer paid one bill for three cars, so the paper has to say which car each charge
 * was for — the same grouping the checkout panel and the A4 print, in the slip's own gross
 * money. Pinned here because it is the surface nobody can re-open and check: whatever the
 * printer put on that paper is what the customer walked out with.
 */
class ReceiptTextMultiCarTest {

    private val biz = ReceiptBiz(
        name = "Carfectionist", address = "Helvetia, 80840 Moka, MU", brn = "C22190760",
        vatNo = "VAT28070619", phone = "+230 5258 8854", logoFile = null, footer = "Thank you for visiting.",
    )

    /** The real bill from the emulator run: two charges on the GT86, one each on two others. */
    private fun threeCars() = ReceiptDoc(
        biz = biz,
        invoiceNo = "INV-0110",
        dateTime = "05-09-2026 23:45:00",
        cashier = "NICK",
        customer = "nick summer test",
        lines = listOf(
            ReceiptLine("4G LTE CAR DASH CAM", 1.0, inclCents = 990001, unitInclCents = 990001, plate = "8978 JZ 20"),
            ReceiptLine("Labor", 1.0, inclCents = 20000, unitInclCents = 20000, plate = "8978 JZ 20"),
            ReceiptLine("BODY POLISH SUV", 1.0, inclCents = 880000, unitInclCents = 880000, plate = "1727 JZ 19"),
            ReceiptLine("CERAMIC PACK SEDAN", 1.0, inclCents = 198000, unitInclCents = 198000, plate = "7890 JK 22"),
        ),
        subtotalCents = 2088001,
        vatRatePct = 15,
        vatCents = 272348,
        discountCents = 0,
        totalCents = 2088001,
        payLabel = "Cash",
        paidCents = 2088001,
        changeCents = 0,
        onAccount = false,
    )

    private fun render(d: ReceiptDoc) = ReceiptText.render(d, 48)

    @Test
    fun `each car heads its own charges`() {
        val out = render(threeCars())
        listOf("8978 JZ 20", "1727 JZ 19", "7890 JK 22").forEach {
            assertTrue("the slip must name $it", out.contains(it))
        }
    }

    @Test
    fun `a car's heading carries that car's total, gross`() {
        val out = render(threeCars())
        // The GT86 took two charges: 9,900.01 + 200.00. The slip is VAT-INCLUSIVE, so this
        // is the gross figure — the A4 states the same group ex-VAT, by design.
        val head = out.lines().first { it.contains("8978 JZ 20") }
        assertTrue("the GT86's heading must total its two charges: $head", head.contains("10100.01"))
    }

    @Test
    fun `every car's heading sums to the bill total`() {
        val d = threeCars()
        assertEquals(d.totalCents, d.lines.sumOf { it.inclCents })
    }

    @Test
    fun `the charges stay under the car they belong to`() {
        val out = render(threeCars()).lines()
        val gt86 = out.indexOfFirst { it.contains("8978 JZ 20") }
        val vitz = out.indexOfFirst { it.contains("1727 JZ 19") }
        val dashcam = out.indexOfFirst { it.contains("4G LTE CAR DASH CAM") }
        val polish = out.indexOfFirst { it.contains("BODY POLISH SUV") }
        assertTrue("the dash cam belongs under the GT86", dashcam > gt86 && dashcam < vitz)
        assertTrue("the polish belongs under the Vitz", polish > vitz)
    }

    /** One car — the ordinary sale — prints exactly as it always did: no plate headings. */
    @Test
    fun `a single-car bill prints no headings at all`() {
        val one = threeCars().let { d -> d.copy(lines = d.lines.map { it.copy(plate = "8978 JZ 20") }) }
        assertFalse(render(one).contains("8978 JZ 20"))
    }

    /** A counter sale carries no car at all, and must not sprout an "Other items" heading. */
    @Test
    fun `a counter sale is untouched`() {
        val none = threeCars().let { d -> d.copy(lines = d.lines.map { it.copy(plate = null) }) }
        val out = render(none)
        assertFalse(out.contains("Other items"))
        assertTrue(out.contains("4G LTE CAR DASH CAM"))
    }

    /**
     * The cashier priced the GT86, moved to the Vitz, then came BACK to the GT86 — exactly
     * what the car switcher invites. Charges are stored as they were typed, so the GT86's
     * arrive scattered; heading a car wherever its plate changes named it twice and printed
     * its whole 10100.01 under each heading.
     */
    private fun outOfOrder() = threeCars().copy(
        lines = listOf(
            ReceiptLine("4G LTE CAR DASH CAM", 1.0, inclCents = 990001, unitInclCents = 990001, plate = "8978 JZ 20"),
            ReceiptLine("BODY POLISH SUV", 1.0, inclCents = 880000, unitInclCents = 880000, plate = "1727 JZ 19"),
            ReceiptLine("Labor", 1.0, inclCents = 20000, unitInclCents = 20000, plate = "8978 JZ 20"),
        ),
        subtotalCents = 1890001, totalCents = 1890001, paidCents = 1890001, vatCents = 246522,
    )

    @Test
    fun `a car typed out of order is named once, with one total`() {
        val out = render(outOfOrder())
        assertEquals("the GT86 must be headed once", 1, out.lines().count { it.contains("8978 JZ 20") })
        assertEquals("the Vitz must be headed once", 1, out.lines().count { it.contains("1727 JZ 19") })
        assertEquals("its total must be stated once", 1, out.lines().count { it.contains("10100.01") })
    }

    @Test
    fun `scattered charges are gathered under their own car`() {
        val out = render(outOfOrder()).lines()
        val dashcam = out.indexOfFirst { it.contains("4G LTE CAR DASH CAM") }
        val labor = out.indexOfFirst { it.contains("Labor") }
        val polish = out.indexOfFirst { it.contains("BODY POLISH SUV") }
        assertTrue("both GT86 charges print together, ahead of the Vitz", dashcam < labor && labor < polish)
    }

    /** Reordering is presentation only — every charge still prints, and they still add up. */
    @Test
    fun `no charge is lost or duplicated by the reordering`() {
        val d = outOfOrder()
        val ordered = orderByCar(d.lines) { it.plate }
        assertEquals(d.lines.size, ordered.size)
        assertEquals(d.lines.sumOf { it.inclCents }, ordered.sumOf { it.inclCents })
        assertEquals(d.lines.toSet(), ordered.toSet())
    }
}
