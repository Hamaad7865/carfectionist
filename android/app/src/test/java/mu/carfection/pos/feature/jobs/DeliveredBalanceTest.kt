package mu.carfection.pos.feature.jobs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The delivered-owing pay path, and the invoice dialog's VAT words.
 *
 * A delivered car that left owing had its balance readable but uncollectable from the
 * board — "view invoice" opened no pay path. The collect button latches the live
 * outstanding figure for the pad. And the amount dialog always claimed "excl. VAT /
 * added automatically", which lied on a gross-quoting shop where the typed figure IS
 * the price and the ledger extracts the VAT instead.
 */
class DeliveredBalanceTest {

    @Test
    fun `the outstanding balance is what is still owed`() {
        assertEquals(800_00L, deliveredOutstandingCents(totalIncl = 1000.0, amountPaid = 200.0))
    }

    @Test
    fun `a settled bill latches nothing`() {
        assertEquals(0L, deliveredOutstandingCents(totalIncl = 1000.0, amountPaid = 1000.0))
    }

    @Test
    fun `an overpayment never latches a negative figure`() {
        assertEquals(0L, deliveredOutstandingCents(totalIncl = 1000.0, amountPaid = 1200.0))
    }

    @Test
    fun `a gross shop labels the amount inclusive`() {
        assertTrue(invoiceAmountSectionLabel(pricesInclVat = true).contains("incl", ignoreCase = true))
    }

    @Test
    fun `a net shop keeps the excl label`() {
        assertTrue(invoiceAmountSectionLabel(pricesInclVat = false).contains("excl", ignoreCase = true))
    }

    @Test
    fun `a gross shop says the figure is stored as typed`() {
        assertTrue(invoiceAmountHint(pricesInclVat = true).contains("stored as typed"))
    }

    @Test
    fun `a net shop says VAT is added on issue`() {
        assertTrue(invoiceAmountHint(pricesInclVat = false).contains("added automatically"))
    }
}
