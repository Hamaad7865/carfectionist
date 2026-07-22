package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPayment
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.SaleHistoryDto
import mu.carfection.pos.core.network.SaleHistoryLineDto
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Rebuild an invoice's slip from what the SERVER stored — its lines, its VAT, its payments.
 * One builder, so the slip a job shows is the same slip Checkout reprints and the printer
 * puts on paper; the money on it is the money in the database, never recomputed here.
 */
fun saleReceiptDoc(h: SaleHistoryDto, biz: ReceiptBiz, vatRatePct: Int): ReceiptDoc {
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
        lines = positives.map { ReceiptLine(it.title, it.qty, incl(it)) },
        subtotalCents = positives.sumOf { incl(it) },
        vatRatePct = vatRatePct,
        vatCents = rupeesToCents(h.vatTotal),
        // Subtotal minus TOTAL, not "the sum of the negative rows". A discount is stored three
        // different ways (documents.discount_value, document_lines.discount_amount, discount_pct)
        // and only one of them was ever a negative row — so keying on negatives printed Rs 0.00
        // beside a Subtotal that did not match the TOTAL underneath it. This rule is
        // representation-agnostic and is the same one the web receipt and the at-sale slip use.
        discountCents = (positives.sumOf { incl(it) } - rupeesToCents(h.totalIncl)).coerceAtLeast(0),
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
    )
}
