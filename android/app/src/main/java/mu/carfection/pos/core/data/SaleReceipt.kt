package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPayment
import mu.carfection.pos.core.hardware.ReceiptVatGroup
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.SaleHistoryDto
import mu.carfection.pos.core.network.SaleHistoryLineDto
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The slip's "Bill" reference: terminal, then the internal order number.
 * "1-N00000028", mirroring the studio's own slip. Null when either part is unknown, so the
 * line is simply omitted rather than printed half-formed.
 */
fun billRef(billNo: Long?, terminalNo: Int?): String? =
    billNo?.let { "${terminalNo ?: 1}-N" + it.toString().padStart(8, '0') }

/**
 * One stored line → the slip's row: the full unit price for the "UP" column, what the line
 * actually cost, and what it saved.
 *
 * The saving is taken from the STORED discount fields, never from `full − charged`. VAT rounds
 * once per line, so that subtraction is a cent adrift on plenty of perfectly undiscounted lines
 * and would print an "Initial price / Discount 0.01" under items nobody discounted. When the
 * line carries no stored discount, the full price IS the charged price, by construction.
 */
private fun receiptLineOf(l: SaleHistoryLineDto): ReceiptLine {
    val chargedIncl = rupeesToCents(l.lineTotalExcl) + rupeesToCents(l.lineVat)
    val rate = l.vatRate
    val unitNet = rupeesToCents(l.unitPrice)
    val discounted = (l.discountKind == "amount" && l.discountAmount > 0.0) || l.discountPct > 0.0
    // Full price by the DB's own route — net line total first, then its own rounded VAT —
    // so it matches the charged figure exactly whenever there is no discount.
    val fullNet = Math.round(l.qty * unitNet)
    val fullIncl = if (discounted) grossCents(fullNet, rate) else chargedIncl
    return ReceiptLine(
        title = l.title,
        qty = l.qty,
        inclCents = chargedIncl,
        unitInclCents = grossCents(unitNet, rate),
        grossInclCents = fullIncl,
        discountPct = if (l.discountKind != "amount") l.discountPct else 0.0,
    )
}

/**
 * Rebuild an invoice's slip from what the SERVER stored — its lines, its VAT, its payments.
 * One builder, so the slip a job shows is the same slip Checkout reprints and the printer
 * puts on paper; the money on it is the money in the database, never recomputed here.
 */
fun saleReceiptDoc(
    h: SaleHistoryDto,
    biz: ReceiptBiz,
    vatRatePct: Int,
    ticketNo: Int? = null,
    terminalNo: Int? = null,
    duplicataNo: Int? = null,
    duplicataAt: String? = null,
): ReceiptDoc {
    fun incl(l: SaleHistoryLineDto) = rupeesToCents(l.lineTotalExcl) + rupeesToCents(l.lineVat)
    val sorted = h.lines.sortedBy { it.sortOrder }
    // Discount lines are stored as negative lines: they are the discount total, not items.
    val positives = sorted.filter { incl(it) >= 0 }
    val nonReversal = h.payments.filter { it.reversesPaymentId == null }
    val pay = nonReversal.maxByOrNull { it.receivedAt ?: "" }
    // Change is summed across EVERY tender, not just the latest — a split can hand back change
    // on any leg, and the old "latest payment's change" dropped it for every split with change.
    val totalChangeCents = nonReversal.sumOf { rupeesToCents(it.changeGiven ?: 0.0) }

    // Every payment, dated — so a deposit taken earlier and the balance taken later each
    // show with when they happened. Short date so it fits a 58mm slip.
    val payFmt = DateTimeFormatter.ofPattern("dd/MM HH:mm")
    val paymentRows = h.payments
        .sortedBy { it.receivedAt ?: "" }
        .map { p ->
            ReceiptPayment(
                dateTime = runCatching {
                    OffsetDateTime.parse(p.receivedAt).atZoneSameInstant(ZoneOffset.ofHours(4)).format(payFmt)
                }.getOrDefault(p.receivedAt?.take(10) ?: "—"),
                method = PayMethod.entries.firstOrNull { it.rpcValue == p.method }?.label ?: p.method,
                amountCents = rupeesToCents(p.amount),
                isReversal = p.reversesPaymentId != null,
            )
        }

    return ReceiptDoc(
        biz = biz,
        invoiceNo = h.number,
        dateTime = runCatching {
            OffsetDateTime.parse(h.issuedAt)
                .atZoneSameInstant(ZoneOffset.ofHours(4)) // Mauritius
                .format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm"))
        }.getOrDefault(h.issuedAt?.take(10) ?: "—"),
        cashier = h.creator?.displayName?.replace(Regex("\\s*\\(.*\\)$"), "") ?: "—",
        customer = h.customers?.name ?: "Walk-in",
        // The client's own fiscal identity — the frozen bill-to snapshot, printed under their name
        // for a business customer. Blank for a walk-in/individual, so the slip omits the lines.
        customerBrn = h.billToBrn?.trim().orEmpty(),
        customerVatNo = h.billToVatNumber?.trim().orEmpty(),
        lines = positives.map { receiptLineOf(it) },
        // The lines at FULL price — so "Subtotal − Discount = TOTAL" states what was saved.
        subtotalCents = positives.sumOf { receiptLineOf(it).grossInclCents },
        vatRatePct = vatRatePct,
        vatCents = rupeesToCents(h.vatTotal),
        // Subtotal minus TOTAL, not "the sum of the negative rows". A discount is stored three
        // different ways (documents.discount_value, document_lines.discount_amount, discount_pct)
        // and only one of them was ever a negative row — so keying on negatives printed Rs 0.00
        // beside a Subtotal that did not match the TOTAL underneath it. This rule is
        // representation-agnostic and is the same one the web receipt and the at-sale slip use.
        discountCents = (positives.sumOf { receiptLineOf(it).grossInclCents } - rupeesToCents(h.totalIncl)).coerceAtLeast(0),
        totalCents = rupeesToCents(h.totalIncl),
        // With more than one tender the slip's single "paid in" label can't name them all — the
        // per-tender `payments` list below carries the breakdown; the label reads "Split".
        payLabel = if (nonReversal.size > 1) "Split" else pay?.let { p -> PayMethod.entries.firstOrNull { it.rpcValue == p.method }?.label ?: p.method },
        // What the customer handed over = money applied + all change given back.
        paidCents = rupeesToCents(h.amountPaid) + totalChangeCents,
        changeCents = totalChangeCents,
        onAccount = pay == null,
        // A deposit or a part payment leaves the bill open; the server's amount_paid is the
        // only honest source for what is still owed, so the slip quotes it rather than guessing.
        balanceDueCents = (rupeesToCents(h.totalIncl) - rupeesToCents(h.amountPaid)).coerceAtLeast(0),
        payments = paymentRows,
        voided = h.status == "void",
        ticketNo = ticketNo,
        billNo = billRef(h.billNo, terminalNo),
        terminalNo = terminalNo,
        duplicataNo = duplicataNo,
        duplicataAt = duplicataAt,
        // Grouped by the line's OWN rate, so a zero-rated item never gets folded into the
        // standard-rate tax line. Bases come from the stored per-line figures, so the
        // breakdown always adds up to the document's own VAT total.
        vatGroups = positives
            .groupBy { it.vatRate }
            .map { (rate, ls) ->
                ReceiptVatGroup(rate, ls.sumOf { rupeesToCents(it.lineTotalExcl) }, ls.sumOf { rupeesToCents(it.lineVat) })
            }
            .sortedByDescending { it.ratePct },
    )
}
