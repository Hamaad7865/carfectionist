package mu.carfection.pos.feature.settlement

import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.Tender
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.AccountInvoiceDto

private val OPEN_STATUSES = setOf("issued", "partly_paid")

/** One open invoice eligible for settlement — not fully paid, not credited. */
data class SettleableInvoice(
    val id: String,
    val number: String?,
    val issueDate: String?,
    val outstandingCents: Long,
    val customerId: String,
    val customerName: String,
    val customerPointsBalance: Int,
)

/** One customer's total owed, for the settlement picker's customer list. */
data class CustomerBalance(
    val customerId: String,
    val customerName: String,
    val outstandingCents: Long,
)

/**
 * Every open (not fully paid, not credited) invoice, oldest first — the exact filter the
 * web's getSettleableInvoices applies, run client-side over one shop-wide fetch
 * ([mu.carfection.pos.core.network.PosApi.fetchAccountInvoices]) rather than a per-customer
 * round trip.
 */
fun settleableInvoices(rows: List<AccountInvoiceDto>): List<SettleableInvoice> {
    val creditedIds = rows.filter { it.docType == "credit_note" }.mapNotNull { it.sourceDocumentId }.toSet()
    return rows
        .asSequence()
        .filter { it.docType == "invoice" && it.status in OPEN_STATUSES && it.id !in creditedIds }
        .mapNotNull { d ->
            val customerId = d.customerId ?: return@mapNotNull null
            val outstandingCents = rupeesToCents(d.totalIncl - d.amountPaid)
            if (outstandingCents <= 0) null
            else SettleableInvoice(
                id = d.id,
                number = d.number,
                issueDate = d.issueDate,
                outstandingCents = outstandingCents,
                customerId = customerId,
                customerName = d.customers?.name ?: "—",
                customerPointsBalance = d.customers?.pointsBalance ?: 0,
            )
        }
        .sortedWith(compareBy { it.issueDate ?: "9999-99-99" })
        .toList()
}

/** Every customer who owes the shop, highest balance first — one row per customer_id,
 *  summed across [settleableInvoices]. */
fun customerBalances(invoices: List<SettleableInvoice>): List<CustomerBalance> =
    invoices.groupBy { it.customerId }
        .map { (id, invs) -> CustomerBalance(id, invs.first().customerName, invs.sumOf { it.outstandingCents }) }
        .filter { it.outstandingCents > 0 }
        .sortedByDescending { it.outstandingCents }

/** One record_payment call's worth of one invoice's settlement — [tender.ref] is filled in by
 *  the caller (the single external reference the operator typed), never by the planner. */
data class SettlementLeg(val invoiceId: String, val tender: Tender)

/**
 * Splits one payment (an optional points amount, plus a chosen method for the rest) across
 * several invoices, oldest first. Every invoice is always paid in full — points are applied
 * invoice-by-invoice until they run out, then the chosen method covers whatever remains on
 * that invoice, before moving to the next.
 *
 * Direct Kotlin port of apps/web/src/features/documents/account-settlement.ts's
 * planSettlement — same algorithm, same test cases (AccountSettlementTest.kt).
 *
 * Cash tendered/change is not per-invoice: the customer hands over one amount for the whole
 * settlement. Every cash leg before the last is recorded as exact change (tendered = amount);
 * the LAST cash leg receives whatever remains of the customer's tendered total, so its change
 * resolves to the true overall change instead of being spread — or lost — across several rows.
 *
 * [method] must be CASH, CARD, JUICE, BANK or CHEQUE — never POINTS or CREDIT; the caller
 * (the settlement screen) only ever offers those.
 */
fun planSettlement(
    invoices: List<SettleableInvoice>,
    pointsAppliedCents: Long,
    method: PayMethod,
    tenderedCents: Long?,
): List<SettlementLeg> {
    val sorted = invoices.sortedWith(compareBy { it.issueDate ?: "9999-99-99" })

    data class Split(val invoiceId: String, val pointsCents: Long, val methodCents: Long)
    var remainingPoints = pointsAppliedCents.coerceAtLeast(0)
    val splits = sorted.map { inv ->
        val pointsCents = minOf(remainingPoints, inv.outstandingCents)
        remainingPoints -= pointsCents
        Split(inv.id, pointsCents, inv.outstandingCents - pointsCents)
    }

    val methodIds = splits.filter { it.methodCents > 0 }.map { it.invoiceId }
    val lastMethodId = methodIds.lastOrNull()

    var tenderedRemaining = tenderedCents ?: 0
    val legs = mutableListOf<SettlementLeg>()
    for (s in splits) {
        if (s.pointsCents > 0) {
            legs += SettlementLeg(s.invoiceId, Tender(PayMethod.POINTS, s.pointsCents))
        }
        if (s.methodCents > 0) {
            if (method == PayMethod.CASH) {
                val isLast = s.invoiceId == lastMethodId
                val rowTendered = if (isLast) tenderedRemaining else s.methodCents
                legs += SettlementLeg(s.invoiceId, Tender(PayMethod.CASH, s.methodCents, tenderedCents = rowTendered))
                tenderedRemaining -= rowTendered
            } else {
                legs += SettlementLeg(s.invoiceId, Tender(method, s.methodCents))
            }
        }
    }
    return legs
}
