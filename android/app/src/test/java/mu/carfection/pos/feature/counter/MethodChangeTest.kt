package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.PayMethod
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The "change method" control mirrors change_payment_method's server guards. This
 * pins the client-side affordance to them so a cashier is never shown a control
 * the RPC will refuse.
 */
class MethodChangeTest {

    @Test fun `omits the current method`() {
        assertFalse(PayMethod.CARD in methodChangeTargets(PayMethod.CARD, canManage = true))
    }

    @Test fun `never offers points`() {
        assertFalse(PayMethod.POINTS in methodChangeTargets(PayMethod.CARD, canManage = true))
    }

    @Test fun `offers cash to anyone`() {
        assertTrue(PayMethod.CASH in methodChangeTargets(PayMethod.CARD, canManage = false))
    }

    @Test fun `a cashier cannot change a cash row`() {
        assertEquals(emptyList<PayMethod>(), methodChangeTargets(PayMethod.CASH, canManage = false))
    }

    @Test fun `a manager can change a cash row`() {
        assertTrue(PayMethod.CARD in methodChangeTargets(PayMethod.CASH, canManage = true))
    }

    @Test fun `points and credit rows are never changeable`() {
        assertEquals(emptyList<PayMethod>(), methodChangeTargets(PayMethod.POINTS, canManage = true))
        assertEquals(emptyList<PayMethod>(), methodChangeTargets(PayMethod.CREDIT, canManage = true))
    }

    @Test fun `a card row offers every other non-points tender`() {
        assertEquals(
            listOf(PayMethod.CASH, PayMethod.JUICE, PayMethod.BANK, PayMethod.CHEQUE),
            methodChangeTargets(PayMethod.CARD, canManage = false),
        )
    }

    @Test fun `wire strings resolve to the enum`() {
        assertEquals(PayMethod.BANK, payMethodOfWire("bank_transfer"))
        assertEquals(PayMethod.JUICE, payMethodOfWire("juice"))
        assertEquals(null, payMethodOfWire("giftcard"))
    }
}
