package mu.carfection.pos.core.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The slip a customer walks away with when the tablet had no network.
 *
 * A VAT invoice number is minted by the server and by nothing else. This slip therefore has
 * to do two things at once: prove the customer paid, and never once imply it is the VAT
 * invoice. Those claims are what these tests pin — the arithmetic itself is the ordinary
 * receipt's, covered by [ReceiptTextTest].
 */
class ProvisionalSlipTest {

    private val biz = ReceiptBiz(
        name = "Carfectionist",
        address = "Helvetia, 80840 Moka, MU",
        brn = "C22190760",
        vatNo = "VAT28070619",
        phone = "+230 5258 8854",
        logoFile = null,
        footer = "Thank you for visiting.",
    )

    /** Rs 1,150.00 of brake pads, paid in cash from Rs 1,200.00, with the network down. */
    private fun offlineDoc() = ReceiptDoc(
        biz = biz,
        invoiceNo = null,
        offlineRef = "OFF-66D2-014",
        dateTime = "02-08-2026 14:23:07",
        cashier = "PRIYA",
        customer = "Walk-in",
        lines = listOf(
            ReceiptLine("BRAKE PADS", 1.0, inclCents = 115000, unitInclCents = 115000, grossInclCents = 115000),
        ),
        subtotalCents = 115000,
        vatRatePct = 15,
        vatCents = 15000,
        discountCents = 0,
        totalCents = 115000,
        payLabel = "Cash",
        paidCents = 120000,
        changeCents = 5000,
        onAccount = false,
        vatGroups = listOf(ReceiptVatGroup(15.0, 100000, 15000)),
    )

    private fun render() = ReceiptText.render(offlineDoc(), 32)

    @Test
    fun `it never calls itself a VAT invoice`() {
        val out = render()

        assertFalse(
            "the slip must not carry the fiscal invoice heading",
            out.contains("NUM VAT INVOICE"),
        )
        assertTrue(out.contains("Not a VAT invoice."))
    }

    @Test
    fun `it prints the device reference the sale is held under`() {
        val out = render()

        assertTrue(out.contains("PROVISIONAL SALE SLIP"))
        assertTrue("the customer's reference is how the sale is found later", out.contains("OFF-66D2-014"))
    }

    @Test
    fun `it tells the customer an invoice is still coming`() {
        val out = render()

        assertTrue(
            "a customer holding this must know the real invoice follows",
            out.contains("VAT invoice") && out.contains("online"),
        )
    }

    /** The barcode encodes the fiscal number. With no number there must be no barcode. */
    @Test
    fun `it carries no barcode, because there is no number to encode`() {
        assertNull(offlineDoc().invoiceNo)
        assertNull("codeLabel is what the transport prints under the barcode", offlineDoc().codeLabel)
    }

    /** Proof of payment is the whole point — the money must read correctly. */
    @Test
    fun `it still shows what was paid and what change was given`() {
        val out = render()

        assertTrue(out.contains("1150.00"))
        assertTrue(out.contains("50.00")) // change
        assertTrue(out.contains("BRAKE PADS"))
    }

    @Test
    fun `the VAT breakdown is still printed, as on any sale`() {
        val out = render()

        assertTrue(out.contains("TAUX NORMAL 15.0%"))
        assertTrue(out.contains("150.00"))
    }

    /** Once the sale lands, the REAL invoice reprints — and looks like every other invoice. */
    @Test
    fun `the same sale once filed prints as an ordinary VAT invoice`() {
        val filed = offlineDoc().copy(invoiceNo = "INV-0061", offlineRef = null)

        val out = ReceiptText.render(filed, 32)

        assertTrue(out.contains("NUM VAT INVOICE INV-0061"))
        assertFalse(out.contains("PROVISIONAL SALE SLIP"))
        assertFalse(out.contains("Not a VAT invoice."))
        assertEquals("INV-0061 · 02082026".take(8), filed.codeLabel!!.take(8))
    }

    /** 58mm paper is 32 columns; a slip that overflows is a slip nobody can read. */
    @Test
    fun `nothing overflows the paper at either width`() {
        listOf(32, 48).forEach { w ->
            ReceiptText.render(offlineDoc(), w).lines().forEach { line ->
                val visible = line.replace(ESC_BOLD_ON.toString(), "").replace(ESC_BOLD_OFF.toString(), "")
                assertTrue("line over $w cols: \"$visible\"", visible.length <= w)
            }
        }
    }
}
