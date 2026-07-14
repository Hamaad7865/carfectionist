package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
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
    val pay = h.payments.filter { it.reversesPaymentId == null }.maxByOrNull { it.receivedAt ?: "" }

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
        discountCents = -sorted.filter { incl(it) < 0 }.sumOf { incl(it) },
        totalCents = rupeesToCents(h.totalIncl),
        payLabel = pay?.let { p -> PayMethod.entries.firstOrNull { it.rpcValue == p.method }?.label ?: p.method },
        paidCents = pay?.tendered?.let { rupeesToCents(it) } ?: rupeesToCents(h.amountPaid),
        changeCents = pay?.changeGiven?.let { rupeesToCents(it) } ?: 0L,
        onAccount = pay == null,
        // A deposit or a part payment leaves the bill open; the server's amount_paid is the
        // only honest source for what is still owed, so the slip quotes it rather than guessing.
        balanceDueCents = (rupeesToCents(h.totalIncl) - rupeesToCents(h.amountPaid)).coerceAtLeast(0),
    )
}
