package mu.carfection.pos.feature.settlement

import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.Tender
import mu.carfection.pos.core.network.AccountInvoiceDto
import mu.carfection.pos.core.network.JobCustomerDto
import org.junit.Assert.assertEquals
import org.junit.Test

private fun inv(id: String, issueDate: String?, outstandingCents: Long, customerId: String = "c1", customerName: String = "Cust", pts: Int = 0) =
    SettleableInvoice(id, number = id, issueDate = issueDate, outstandingCents = outstandingCents, customerId = customerId, customerName = customerName, customerPointsBalance = pts)

/**
 * Same cases as apps/web/src/features/documents/account-settlement.test.ts, same numbers —
 * planSettlement here is a direct port of that algorithm.
 */
class AccountSettlementTest {

    @Test
    fun `pays a single invoice in full with cash, tendered exactly`() {
        val legs = planSettlement(listOf(inv("a", "2026-08-01", 150_000)), 0, PayMethod.CASH, 150_000)

        assertEquals(listOf(SettlementLeg("a", Tender(PayMethod.CASH, 150_000, tenderedCents = 150_000))), legs)
    }

    @Test
    fun `orders invoices oldest first regardless of input order`() {
        val legs = planSettlement(
            listOf(inv("newer", "2026-08-10", 10_000), inv("older", "2026-08-01", 20_000)),
            0, PayMethod.CARD, null,
        )

        assertEquals(listOf("older", "newer"), legs.map { it.invoiceId })
    }

    @Test
    fun `treats a missing issue date as the newest — sorted after every dated invoice`() {
        val legs = planSettlement(
            listOf(inv("undated", null, 5_000), inv("dated", "2026-01-01", 5_000)),
            0, PayMethod.CARD, null,
        )

        assertEquals(listOf("dated", "undated"), legs.map { it.invoiceId })
    }

    @Test
    fun `puts all of a cash overpayment's change on the LAST leg, not spread across invoices`() {
        // Two invoices, Rs 1,000 and Rs 500 (oldest first). Customer hands over Rs 2,000 —
        // Rs 1,500 due, Rs 500 change. The change must land once, on the final leg, not be
        // double-counted or dropped by splitting it evenly.
        val legs = planSettlement(listOf(inv("a", "2026-08-01", 100_000), inv("b", "2026-08-05", 50_000)), 0, PayMethod.CASH, 200_000)

        assertEquals(
            listOf(
                SettlementLeg("a", Tender(PayMethod.CASH, 100_000, tenderedCents = 100_000)),
                SettlementLeg("b", Tender(PayMethod.CASH, 50_000, tenderedCents = 100_000)),
            ),
            legs,
        )
        // leg "b"'s change: 100_000 tendered - 50_000 amount = 50_000 — the true overall change.
    }

    @Test
    fun `splits points across an invoice boundary, then covers the rest by the chosen method`() {
        // inv1 owes Rs 30, inv2 owes Rs 50. Rs 40 in points: Rs 30 clears inv1 outright, the
        // remaining Rs 10 comes off inv2, leaving Rs 40 of inv2 for the card.
        val legs = planSettlement(
            listOf(inv("inv1", "2026-08-01", 3_000), inv("inv2", "2026-08-05", 5_000)),
            4_000, PayMethod.CARD, null,
        )

        assertEquals(
            listOf(
                SettlementLeg("inv1", Tender(PayMethod.POINTS, 3_000)),
                SettlementLeg("inv2", Tender(PayMethod.POINTS, 1_000)),
                SettlementLeg("inv2", Tender(PayMethod.CARD, 4_000)),
            ),
            legs,
        )
    }

    @Test
    fun `emits no method leg at all when points cover everything`() {
        val legs = planSettlement(listOf(inv("a", "2026-08-01", 2_000), inv("b", "2026-08-02", 3_000)), 5_000, PayMethod.CASH, null)

        assertEquals(
            listOf(SettlementLeg("a", Tender(PayMethod.POINTS, 2_000)), SettlementLeg("b", Tender(PayMethod.POINTS, 3_000))),
            legs,
        )
    }

    @Test
    fun `never sets a tendered amount on a non-cash leg`() {
        val legs = planSettlement(listOf(inv("a", "2026-08-01", 10_000)), 0, PayMethod.BANK, null)

        assertEquals(listOf(SettlementLeg("a", Tender(PayMethod.BANK, 10_000))), legs)
    }

    @Test
    fun `every leg for one invoice sums back to exactly its outstanding balance`() {
        val invoices = listOf(inv("a", "2026-08-01", 7_777), inv("b", "2026-08-02", 12_345))
        val legs = planSettlement(invoices, 3_000, PayMethod.JUICE, null)

        for (original in invoices) {
            val sum = legs.filter { it.invoiceId == original.id }.sumOf { it.tender.amountCents }
            assertEquals(original.outstandingCents, sum)
        }
    }

    // ── settleableInvoices / customerBalances — Android-only eligibility plumbing ──

    private fun row(
        id: String, customerId: String?, docType: String = "invoice", status: String = "issued",
        totalIncl: Double = 100.0, amountPaid: Double = 0.0, issueDate: String? = "2026-08-01",
        sourceDocumentId: String? = null, customerName: String? = "Cust", pts: Int? = 0,
    ) = AccountInvoiceDto(id, customerId, docType, status, id, totalIncl, amountPaid, issueDate, sourceDocumentId, JobCustomerDto(customerName, null, null, pts))

    @Test
    fun `excludes an invoice that has a credit note against it`() {
        val rows = listOf(
            row("inv1", "c1", totalIncl = 100.0),
            row("cn1", "c1", docType = "credit_note", sourceDocumentId = "inv1"),
        )

        assertEquals(emptyList<SettleableInvoice>(), settleableInvoices(rows))
    }

    @Test
    fun `excludes a fully paid invoice`() {
        val rows = listOf(row("inv1", "c1", totalIncl = 100.0, amountPaid = 100.0))

        assertEquals(emptyList<SettleableInvoice>(), settleableInvoices(rows))
    }

    @Test
    fun `sums two customers' open invoices independently, highest balance first`() {
        val rows = listOf(
            row("a1", "c1", totalIncl = 30.0, customerName = "Alice"),
            row("a2", "c1", totalIncl = 20.0, customerName = "Alice"),
            row("b1", "c2", totalIncl = 100.0, customerName = "Bob"),
        )

        val balances = customerBalances(settleableInvoices(rows))

        assertEquals(listOf(CustomerBalance("c2", "Bob", 10_000), CustomerBalance("c1", "Alice", 5_000)), balances)
    }
}
