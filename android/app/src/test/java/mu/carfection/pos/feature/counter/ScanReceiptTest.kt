package mu.carfection.pos.feature.counter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scanning the barcode printed on a receipt pulls that sale back up.
 *
 * The counter's search box doubles as the scanner's landing strip, so this recogniser decides
 * whether a burst of characters is a PRODUCT barcode, a DOCUMENT reference, or ordinary typing.
 * Getting it wrong in either direction is a live-till problem: a false positive fires a lookup
 * while someone is searching the catalogue, and a false negative leaves a scanned receipt sitting
 * in the box doing nothing.
 */
class ScanReceiptTest {

    @Test
    fun `the references the slip actually prints are recognised`() {
        // Real numbers from the live ledger.
        listOf("INV-0017", "INV-0031", "INV-0038", "A00011", "A00024")
            .forEach { assertTrue("should be a document ref: $it", isDocumentRef(it)) }
    }

    @Test
    fun `a scanner's stray whitespace and lower case still match`() {
        // Keyboard-wedge scanners commonly append a terminator, and cheap ones vary in case.
        listOf(" INV-0031", "INV-0031 ", "inv-0031", "a00024")
            .forEach { assertTrue("should be a document ref: '$it'", isDocumentRef(it)) }
    }

    @Test
    fun `ordinary product searching never triggers a lookup`() {
        listOf(
            "", "w", "wiper", "WIPER 24", "SILVER SUV", "ceramic",
            "INV", "INV-", "INV-00",          // mid-type: no lookup until the ref is complete
            "A0001",                          // one digit short of a quote number
            "1234567890123",                  // an EAN-13 product barcode
            "12345678", "0000",               // numeric product codes
            "INV-0031-COPY", "SEE INV-0031",  // a ref embedded in other text is not a scan
        ).forEach { assertFalse("should NOT be a document ref: '$it'", isDocumentRef(it)) }
    }

    /**
     * The one that would hurt: a product barcode must never be mistaken for a receipt, or
     * scanning stock at the till would stop ringing items into the cart.
     */
    @Test
    fun `a letter-prefixed product barcode is not mistaken for a quote reference`() {
        // Quote numbers are one letter + 5+ digits. Shorter letter-digit codes are products.
        assertFalse(isDocumentRef("A1234"))
        assertTrue(isDocumentRef("A12345"))
    }

    @Test
    fun `a scanned reference that is not a sale is named for what it is`() {
        assertEquals("quotation", docKindLabel("quote"))
        assertEquals("credit note", docKindLabel("credit_note"))
        assertEquals("delivery note", docKindLabel("delivery_note"))
    }
}
