package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The single decision that makes offline selling work — or quietly not work.
 *
 * Get it wrong in one direction and the counter refuses to sell during an outage, which is
 * the whole problem this was built for. Get it wrong in the other and the tablet captures
 * something it has no business capturing: a bill whose balance it cannot see, or a sale the
 * server may already hold.
 */
class OfflineCaptureDecisionTest {

    private val brakePad = ProductEntity(
        id = "p1", name = "Brake pad", kind = "product", sellingPriceCents = 1_000_00,
        vatRatePct = 15.0, barcode = null, isStocked = true, category = null, lowStockThreshold = null,
    )
    private val openTill = CashSessionDto(id = "till-1", status = "open")

    /** A walk-in basket, one line, cash, on an open till — the ordinary counter sale. */
    private fun walkIn() = CounterUiState(till = openTill).withCart(listOf(CartLine(brakePad, 1.0)))

    @Test
    fun `a walk-in with no network is captured`() {
        assertTrue(canCaptureOffline(walkIn(), online = false))
    }

    @Test
    fun `the same sale online goes straight to the server`() {
        assertFalse(canCaptureOffline(walkIn(), online = true))
    }

    @Test
    fun `every tender the drawer can take is capturable`() {
        listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK).forEach { m ->
            assertTrue("$m should be capturable", canCaptureOffline(walkIn().copy(method = m), online = false))
        }
    }

    /** An on-account sale moves no money, so nothing is lost by waiting for the network. */
    @Test
    fun `an on-account sale is not captured`() {
        assertFalse(canCaptureOffline(walkIn().copy(method = PayMethod.CREDIT), online = false))
    }

    /**
     * The outstanding balance of an existing bill lives on the server. Offline we cannot
     * read it, and a captured payment against a guessed balance could overpay the invoice.
     */
    @Test
    fun `a collect on an existing invoice is not captured`() {
        val collecting = walkIn().copy(
            collect = OutstandingInvoiceDto(
                id = "inv-1", number = "INV-0031", status = "issued",
                totalIncl = 1150.0, amountPaid = 0.0,
            ),
        )

        assertFalse(canCaptureOffline(collecting, online = false))
    }

    /**
     * The dangerous one. A settle that already reached `issue_document` may hold a real
     * invoice under this sale key. Capturing it would ring the same money a second time.
     */
    @Test
    fun `a sale that already reached the server is never re-rung offline`() {
        val pending = walkIn().copy(pendingSettle = PendingSettle("inv-1", "INV-0031"))

        assertFalse(canCaptureOffline(pending, online = false))
    }

    /** Every payment must name a till; capturing without one only creates a blocked sale later. */
    @Test
    fun `a sale with no open till is not captured`() {
        assertFalse(canCaptureOffline(walkIn().copy(till = null), online = false))
    }

    @Test
    fun `an empty basket is not captured`() {
        assertFalse(canCaptureOffline(CounterUiState(till = openTill), online = false))
    }
}
