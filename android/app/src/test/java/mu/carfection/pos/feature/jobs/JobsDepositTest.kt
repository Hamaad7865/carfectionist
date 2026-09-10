package mu.carfection.pos.feature.jobs

import org.junit.Assert.assertFalse
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
}
