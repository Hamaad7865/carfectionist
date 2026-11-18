package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pad's Deposit button.
 *
 * INV-0558 (18 Nov 2026): a customer booked for Monday wanted to leave Rs 500. The pad opened
 * on the whole Rs 26,950 with nothing on it saying "deposit", and the cashier reached for
 * Credit — which hands the car over. Deposit entry opens on an EMPTY figure: nothing is taken
 * until the cashier types what the customer is leaving.
 */
class DepositEntryTest {

    private val till = CashSessionDto(id = "till-1", status = "open")
    private val inv0558 = OutstandingInvoiceDto(id = "b1", status = "issued", totalIncl = 26950.0, amountPaid = 0.0, jobId = "j1")

    private fun pad(payText: String = "", depositEntry: Boolean = true, method: PayMethod = PayMethod.CASH) =
        CounterUiState(till = till, collect = inv0558, padOpen = true, method = method, payText = payText, depositEntry = depositEntry)

    @Test
    fun `nothing typed yet takes nothing - Take stays dead`() {
        val s = pad()
        assertEquals(0L, s.payCents)
        assertFalse(s.canRecord)
    }

    @Test
    fun `the typed deposit is what is taken and the rest stays owed`() {
        val s = pad(payText = "500")
        assertEquals(500_00L, s.payCents)
        assertTrue(s.isPartPayment)
        assertEquals(26_450_00L, s.balanceAfterCents)
        assertTrue(s.canRecord)
    }

    @Test
    fun `a non-cash deposit works the same`() {
        val s = pad(payText = "500", method = PayMethod.JUICE)
        assertEquals(500_00L, s.payCents)
        assertTrue(s.canRecord)
    }

    @Test
    fun `without deposit entry an untouched pad still opens on the whole balance`() {
        assertEquals(26_950_00L, pad(depositEntry = false).payCents)
    }

    @Test
    fun `a deposit can never exceed the balance`() {
        assertEquals(26_950_00L, pad(payText = "30000").payCents)
    }
}
