package mu.carfection.pos.core.hardware

import android.util.Log
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hardware seams. The tablet/printer/drawer/scanner are separate devices (models
 * TBD), so M1 ships log-only implementations behind these interfaces — the sale
 * logic never changes when the real DantSu ESC/POS transport lands.
 *
 * Invariant: the sale COMMITS BEFORE printing — a printer failure can never
 * lose a sale (callers must treat print/kick as fire-and-forget).
 */
interface ReceiptPrinter {
    suspend fun printReceipt(text: String)
}

interface CashDrawer {
    /** ESC p pulse via the printer, once wired. */
    suspend fun kick()
}

/** Header identity printed on every receipt (from business_settings). */
data class ReceiptBiz(
    val name: String,
    val address: String?,
    val brn: String?,
    val vatNo: String?,
    val phone: String? = null,
)

/** One sold line: title, qty, VAT-inclusive line total. */
data class ReceiptLine(val title: String, val qty: Double, val inclCents: Long)

/**
 * The receipt as a structured document — one source of truth rendered two ways:
 * the on-screen paper slip (ReceiptPaper composable) and the printer's plain text
 * (ReceiptText.render). Modelled on the studio's retail till slip.
 */
data class ReceiptDoc(
    val biz: ReceiptBiz,
    val invoiceNo: String?,
    val dateTime: String, // display, e.g. "10 Jul 2026 15:04"
    val cashier: String,
    val customer: String,
    val lines: List<ReceiptLine>,
    val subtotalCents: Long, // gross, VAT-inclusive, before discount
    val vatRatePct: Int,
    val vatCents: Long,
    val discountCents: Long, // total discount, VAT-inclusive (>= 0)
    val totalCents: Long,
    val payLabel: String?, // "Cash" etc.; null = on account
    val paidCents: Long,
    val changeCents: Long,
    val onAccount: Boolean,
    val isPayment: Boolean = false, // collect-on-invoice slip (no item table / tax lines)
) {
    val footer = "Goods sold are not refundable. Thank you for shopping with us."
}

/** Renders a [ReceiptDoc] to the 32-column plain text a thermal printer prints. */
object ReceiptText {
    private const val W = 32
    private fun center(s: String) = " ".repeat(((W - s.length) / 2).coerceAtLeast(0)) + s
    private fun rule() = "-".repeat(W)
    private fun dec(c: Long): String { val n = c < 0; val a = if (n) -c else c; return (if (n) "-" else "") + "${a / 100}.${(a % 100).toString().padStart(2, '0')}" }
    private fun money(c: Long) = "Rs " + dec(c)
    private fun kv(k: String, v: String) = k + v.padStart(W - k.length)

    fun render(d: ReceiptDoc): String = buildString {
        appendLine(center(d.biz.name.uppercase()))
        d.biz.address?.takeIf { it.isNotBlank() }?.let { appendLine(center(it)) }
        val ids = listOfNotNull(d.biz.brn?.let { "BRN $it" }, d.biz.vatNo?.let { "VAT $it" }).joinToString(" · ")
        if (ids.isNotBlank()) appendLine(center(ids))
        d.biz.phone?.takeIf { it.isNotBlank() }?.let { appendLine(center(it)) }
        appendLine(rule())
        appendLine(kv("Invoice", d.invoiceNo ?: "—"))
        appendLine(kv("Date", d.dateTime))
        appendLine(kv("Cashier", d.cashier))
        appendLine(kv("Customer", d.customer))
        appendLine(rule())
        if (!d.isPayment) {
            d.lines.forEach { l ->
                val qty = if (l.qty % 1.0 == 0.0) l.qty.toInt().toString() else l.qty.toString()
                appendLine("$qty x ${l.title}".take(W - 10).padEnd(W - 10) + dec(l.inclCents).padStart(10))
            }
            appendLine(rule())
            appendLine(kv("Subtotal", money(d.subtotalCents)))
            appendLine(kv("VAT ${d.vatRatePct}%", money(d.vatCents)))
            appendLine(kv("Discount", money(d.discountCents)))
        }
        appendLine(kv("TOTAL", money(d.totalCents)))
        if (d.onAccount) appendLine(kv("On account", money(d.totalCents)))
        else {
            appendLine(kv("Paid · ${d.payLabel?.lowercase()}", money(d.paidCents)))
            appendLine(kv("Change", money(d.changeCents)))
        }
        appendLine(rule())
        appendLine(center("Thank you for shopping with us."))
        d.invoiceNo?.let { appendLine(center(it)) }
    }
}

@Singleton
class LogPrinter @Inject constructor() : ReceiptPrinter {
    override suspend fun printReceipt(text: String) {
        Log.i("POS-Printer", "\n$text")
    }
}

@Singleton
class LogDrawer @Inject constructor() : CashDrawer {
    override suspend fun kick() {
        Log.i("POS-Drawer", "kick! (ESC p once the printer is wired)")
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class HardwareModule {
    @Binds abstract fun printer(impl: LogPrinter): ReceiptPrinter
    @Binds abstract fun drawer(impl: LogDrawer): CashDrawer
}
