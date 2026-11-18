package mu.carfection.pos.feature.jobs

import mu.carfection.pos.core.network.FlowInvoiceRefDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * When the job card offers the deposit button.
 *
 * Two conditions, both load-bearing: a deposit was agreed on the job's quote,
 * and no live bill exists yet. Once a bill is issued the cashier collects on
 * it in Checkout — a second raise would hand that bill back or mint a rival.
 * A draft does not hide the button: raising over one issues it, because
 * convert_quote_to_invoice hands back the standing draft instead of minting.
 */
class JobsDepositTest {

    @Test
    fun `an agreed deposit with no bill offers the button`() {
        assertTrue(showDepositButton(depositCents = 41200, hasLiveBill = false))
    }

    @Test
    fun `no agreed deposit offers nothing`() {
        assertFalse(showDepositButton(depositCents = 0, hasLiveBill = false))
    }

    @Test
    fun `a live bill hides the button - the cashier collects in Checkout`() {
        assertFalse(showDepositButton(depositCents = 41200, hasLiveBill = true))
    }

    private fun bill(status: String, paid: Double = 0.0, number: String = "INV-0558", docType: String = "invoice") =
        FlowInvoiceRefDto(id = number, number = number, docType = docType, status = status, totalIncl = 26950.0, amountPaid = paid)

    @Test
    fun `an agreed deposit with no bill raises it with the figure dialled in`() {
        assertEquals(DepositOffer.Agreed(41200), depositOffer("scheduled", "q1", 41200, emptyList()))
    }

    @Test
    fun `a booked job with nothing agreed and no bill raises one for the cashier to type`() {
        assertEquals(DepositOffer.RaiseBill, depositOffer("scheduled", "q1", 0, emptyList()))
        assertEquals(DepositOffer.RaiseBill, depositOffer("in_progress", "q1", 0, listOf(bill("draft"))))
    }

    @Test
    fun `a booked job whose bill is already issued opens that bill - INV-0558`() {
        assertEquals(DepositOffer.OnBill("INV-0558", "INV-0558"), depositOffer("scheduled", "q1", 0, listOf(bill("issued"))))
        assertEquals(DepositOffer.OnBill("INV-0558", "INV-0558"), depositOffer("scheduled", "q1", 41200, listOf(bill("partly_paid", paid = 500.0))))
    }

    @Test
    fun `a paid bill leaves nothing to take a deposit on`() {
        assertNull(depositOffer("scheduled", "q1", 0, listOf(bill("paid", paid = 26950.0))))
    }

    @Test
    fun `a job with no quote and no bill has nothing priced to bill`() {
        assertNull(depositOffer("scheduled", null, 0, emptyList()))
    }

    @Test
    fun `a finished car is not offered a deposit - it goes to checkout`() {
        listOf("ready", "delivered", "cancelled").forEach { st ->
            assertNull(st, depositOffer(st, "q1", 0, emptyList()))
            assertNull(st, depositOffer(st, "q1", 0, listOf(bill("issued"))))
        }
    }
}
