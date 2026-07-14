package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.HardwareSettings
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.PosApi
import kotlinx.coroutines.flow.first
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The "Clôture de période" slip — Cashmag parity, printed the moment the till
 * closes so the owner gets the same end-of-day paper the studio is used to:
 * floats, period totals, sales by category, per-cashier takings split by
 * payment method, means of payment, drawer reconciliation, on-account credit
 * and the VAT summary. Everything is computed from the session's own payment
 * rows (all methods link to the session), so the slip is the server's truth.
 */
@Singleton
class TillZReport @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val session: SessionRepository,
    private val hw: HardwareSettings,
    private val printer: ReceiptPrinter,
) {
    private val mu: ZoneId = ZoneId.of("Indian/Mauritius")

    suspend fun printFor(closed: CashSessionDto) {
        printer.printReceipt(render(closed))
    }

    /**
     * Print a Z from its FROZEN totals — the server's figures, fixed at the moment the till
     * was closed. This is the one to use: it reprints the same paper however long afterwards,
     * where the legacy render above recomputes from rows that keep moving.
     */
    suspend fun print(z: mu.carfection.pos.core.network.ZReportDto) {
        val w = if (hw.config.first().paperWidthMm == 58) 32 else 48
        printer.printReceipt(ZSlip.render(z, catalog.receiptBiz(), w))
    }

    suspend fun render(closed: CashSessionDto): String {
        val w = if (hw.config.first().paperWidthMm == 58) 32 else 48
        val biz = catalog.receiptBiz()
        val pays = api.fetchSessionPayments(closed.id)
        val names = api.fetchUserNames().associate {
            it.id to it.displayName.replace(Regex("\\s*\\(.*\\)\\s*$"), "").trim()
        }
        val nowIso = ZonedDateTime.now(mu).toInstant().toString()
        val onAccount = closed.openedAt?.let { runCatching { api.fetchOnAccountBetween(it, nowIso) }.getOrNull() } ?: emptyList()

        fun cents(v: Double) = rupeesToCents(v)
        val reversedIds = pays.mapNotNull { it.reversesPaymentId }.toSet()
        val reversals = pays.count { it.reversesPaymentId != null }

        // Net takings per method (reversal pairs cancel), counts of standing tenders.
        val netByMethod = pays.groupBy { it.method }.mapValues { (_, v) -> v.sumOf { cents(it.amount) } }
        val countByMethod = pays.filter { it.reversesPaymentId == null && it.id !in reversedIds }
            .groupBy { it.method }.mapValues { (_, v) -> v.size }
        val totalNet = netByMethod.values.sum()
        val changeCents = pays.filter { it.reversesPaymentId == null && it.id !in reversedIds }
            .sumOf { cents(it.changeGiven ?: 0.0) }

        // Per-cashier: net by operator, split by method.
        val byCashier = pays.groupBy { names[it.receivedBy] ?: "—" }
            .mapValues { (_, v) ->
                v.sumOf { cents(it.amount) } to v.groupBy { p -> p.method }.mapValues { (_, m) -> m.sumOf { cents(it.amount) } }
            }
            .toList().sortedByDescending { it.second.first }

        // Documents settled this session (deduped; reversal pairs excluded).
        val docs = pays.filter { it.reversesPaymentId == null && it.id !in reversedIds }
            .mapNotNull { it.documents }.distinctBy { it.id }
        val tickets = docs.size
        val avg = if (tickets > 0) totalNet / tickets else 0L

        // Sales by product category (qty + VAT-inclusive amount).
        data class Cat(var qty: Double, var incl: Long)
        val cats = linkedMapOf<String, Cat>()
        docs.forEach { d ->
            d.lines.forEach { l ->
                val incl = cents(l.lineTotalExcl) + cents(l.lineVat)
                val key = (l.products?.category?.ifBlank { null } ?: "OTHER").uppercase()
                val c = cats.getOrPut(key) { Cat(0.0, 0) }
                c.qty += l.qty; c.incl += incl
            }
        }

        val vatCents = docs.sumOf { cents(it.vatTotal) }
        val exclCents = docs.sumOf { cents(it.subtotalExcl) }
        val inclCents = docs.sumOf { cents(it.totalIncl) }

        val onAccountCents = onAccount.sumOf { cents(it.totalIncl) - cents(it.amountPaid) }
        val floatCents = cents(closed.openingFloat)
        val countedCents = cents(closed.closingCount ?: 0.0)
        val expectedCents = cents(closed.expectedCash ?: 0.0)
        val varianceCents = cents(closed.variance ?: 0.0)

        val now = ZonedDateTime.now(mu)
        val dayLine = now.format(DateTimeFormatter.ofPattern("EEEE dd MMMM yyyy", Locale.ENGLISH))
        val stampLine = now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
        val device = session.deviceId().takeLast(6).uppercase()

        fun center(s: String) = " ".repeat(((w - s.length) / 2).coerceAtLeast(0)) + s
        fun rule() = "-".repeat(w)
        fun kv(k: String, v: String) = k + v.padStart((w - k.length).coerceAtLeast(1))
        fun qty(q: Double) = if (q % 1.0 == 0.0) q.toInt().toString() else q.toString()

        return buildString {
            appendLine(center(biz.name.uppercase()))
            biz.address?.takeIf { it.isNotBlank() }?.let { appendLine(center(it)) }
            appendLine(rule())
            appendLine(center("Cloture de periode"))
            appendLine(center(dayLine))
            appendLine(center(stampLine))
            appendLine(center("Appareil 1 / Device $device"))
            appendLine(rule())
            appendLine(center("Service"))
            appendLine(kv("Initial cash float", formatMUR(floatCents)))
            appendLine(kv("Final cash count", formatMUR(countedCents)))
            appendLine(rule())
            appendLine(center("Period"))
            appendLine(kv("Total incl. tax", formatMUR(totalNet)))
            appendLine(kv("$tickets ticket${if (tickets == 1) "" else "s"}", "Avg ${formatMUR(avg)}"))
            appendLine(kv("Reversals", reversals.toString()))
            if (cats.isNotEmpty()) {
                appendLine(rule())
                appendLine(center("Categories"))
                cats.entries.sortedByDescending { it.value.incl }.forEach { (name, c) ->
                    appendLine(kv("${qty(c.qty)} ${name.take(w - 18)}", formatMUR(c.incl)))
                }
            }
            if (byCashier.isNotEmpty()) {
                appendLine(rule())
                appendLine(center("User as cashier"))
                byCashier.forEach { (name, t) ->
                    appendLine(kv(name.uppercase().take(w - 14), formatMUR(t.first)))
                    t.second.entries.sortedByDescending { it.value }.forEach { (m, amt) ->
                        appendLine(kv("   ${m.replace('_', ' ').uppercase()}", formatMUR(amt)))
                    }
                }
            }
            appendLine(rule())
            appendLine(center("Means of payment"))
            appendLine(kv("CASH", formatMUR(netByMethod["cash"] ?: 0)))
            appendLine(kv("CHANGE GIVEN", formatMUR(changeCents)))
            netByMethod.entries.filter { it.key != "cash" }.sortedByDescending { it.value }.forEach { (m, amt) ->
                appendLine(kv("${countByMethod[m] ?: 0} ${m.replace('_', ' ').uppercase()}", formatMUR(amt)))
            }
            appendLine(rule())
            appendLine(center("Drawer"))
            appendLine(kv("Expected", formatMUR(expectedCents)))
            appendLine(kv("Counted", formatMUR(countedCents)))
            appendLine(kv("Variance", formatMUR(varianceCents)))
            if (onAccountCents > 0) {
                appendLine(rule())
                appendLine(center("Customer credit"))
                appendLine(kv("${onAccount.size} on account", formatMUR(onAccountCents)))
            }
            appendLine(rule())
            appendLine(center("VAT rate"))
            appendLine(kv("TAUX NORMAL 15.00%", formatMUR(vatCents)))
            appendLine(kv("excl. VAT", formatMUR(exclCents)))
            appendLine(kv("Incl. tax", formatMUR(inclCents)))
            appendLine(rule())
            appendLine(center("Closed by ${session.userName}"))
        }
    }
}
