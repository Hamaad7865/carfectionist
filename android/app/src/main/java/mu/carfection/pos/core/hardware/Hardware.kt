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
data class ReceiptBiz(val name: String, val address: String?, val brn: String?, val vatNo: String?)

/** One sold line as it prints: title, qty, VAT-INCLUSIVE line total. */
data class ReceiptLine(val title: String, val qty: Double, val inclCents: Long)

/**
 * Plain-text 32-column receipt, formatted like the studio's existing Cashmag
 * till slips (same sections/order) minus the Cashmag/NF525 machine footer.
 * The ESC/POS ReceiptBuilder replaces the transport when the printer lands.
 */
object ReceiptText {
    private const val W = 32
    private fun center(s: String) = " ".repeat(((W - s.length) / 2).coerceAtLeast(0)) + s
    private fun rule() = "-".repeat(W)

    /** "1320.00" — plain 2dp, no currency prefix (table columns). */
    private fun dec(cents: Long): String {
        val neg = cents < 0; val a = if (neg) -cents else cents
        return (if (neg) "-" else "") + "${a / 100}.${(a % 100).toString().padStart(2, '0')}"
    }

    private fun rs(cents: Long) = dec(cents) + "Rs"

    fun forSale(
        biz: ReceiptBiz,
        number: String?,
        dateTime: String,
        lines: List<ReceiptLine>,
        totalCents: Long,
        exclCents: Long,
        vatByRate: List<Pair<Double, Long>>, // rate% -> VAT amount
        payLabel: String?, // null = on account
        paidCents: Long?,
        changeCents: Long,
        onAccount: Boolean,
        operator: String,
    ): String = buildString {
        appendLine(center(biz.name.uppercase()))
        biz.address?.takeIf { it.isNotBlank() }?.let { appendLine(center(it)) }
        appendLine(rule())
        appendLine("VAT INVOICE ${number ?: "(draft)"}")
        appendLine("Sale - ${biz.name.uppercase()} POS")
        appendLine(dateTime)
        appendLine(rule())
        appendLine("Qty Designation       UP   Total")
        lines.forEach { l ->
            val qty = if (l.qty % 1.0 == 0.0) l.qty.toInt().toString() else l.qty.toString()
            val up = if (l.qty != 0.0) Math.round(l.inclCents / l.qty) else l.inclCents
            appendLine(qty.take(3).padEnd(4) + l.title.take(12).padEnd(12) + dec(up).padStart(8) + dec(l.inclCents).padStart(8))
        }
        appendLine(rule())
        appendLine(center("Total: " + rs(totalCents)))
        appendLine(center("excl. VAT : " + rs(exclCents)))
        appendLine(rule())
        if (payLabel != null) {
            appendLine("1  $payLabel : ${rs(paidCents ?: totalCents)}")
            if (changeCents > 0) appendLine("   CHANGE : -${rs(changeCents)}")
        } else {
            appendLine("ON ACCOUNT - BALANCE DUE")
        }
        appendLine(rule())
        vatByRate.forEach { (rate, vat) ->
            appendLine("TAUX NORMAL ${if (rate % 1.0 == 0.0) "${rate.toInt()}.0" else rate.toString()}% : ${rs(vat)}")
        }
        appendLine("excl. VAT = ${rs(exclCents)}")
        appendLine("Incl. tax = ${rs(totalCents)}")
        appendLine(rule())
        appendLine(center("Thank you for visiting."))
        biz.brn?.takeIf { it.isNotBlank() }?.let { appendLine("BRN : $it") }
        biz.vatNo?.takeIf { it.isNotBlank() }?.let { appendLine("VAT number : ${it.removePrefix("VAT")}") }
        appendLine("Served by ${operator.uppercase()}")
        if (onAccount) appendLine(center("*** ON ACCOUNT ***"))
    }

    /** Collecting on an existing invoice — a short payment slip. */
    fun forPayment(
        biz: ReceiptBiz,
        number: String?,
        dateTime: String,
        amountCents: Long,
        payLabel: String,
        tenderCents: Long?,
        changeCents: Long,
        operator: String,
    ): String = buildString {
        appendLine(center(biz.name.uppercase()))
        biz.address?.takeIf { it.isNotBlank() }?.let { appendLine(center(it)) }
        appendLine(rule())
        appendLine("PAYMENT - ${number ?: "invoice"}")
        appendLine(dateTime)
        appendLine(rule())
        appendLine("1  $payLabel : ${rs(tenderCents ?: amountCents)}")
        appendLine("   Applied : ${rs(amountCents)}")
        if (changeCents > 0) appendLine("   CHANGE : -${rs(changeCents)}")
        appendLine(rule())
        appendLine(center("Thank you for visiting."))
        biz.brn?.takeIf { it.isNotBlank() }?.let { appendLine("BRN : $it") }
        biz.vatNo?.takeIf { it.isNotBlank() }?.let { appendLine("VAT number : ${it.removePrefix("VAT")}") }
        appendLine("Served by ${operator.uppercase()}")
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
