package mu.carfection.pos.core.hardware

import android.util.Log
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
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

    /** Print a structured receipt at the configured paper width, with the Code128 barcode. */
    suspend fun printDoc(doc: ReceiptDoc)
}

interface CashDrawer {
    /** ESC p pulse via the printer, once wired. */
    suspend fun kick()
}

/** What the slip says when the owner hasn't written their own footer (same default as the web card). */
const val DEFAULT_RECEIPT_FOOTER = "Goods sold are not refundable. Thank you for shopping with us."

/** Header identity printed on every receipt (from business_settings). */
data class ReceiptBiz(
    val name: String,
    val address: String?,
    val brn: String?,
    val vatNo: String?,
    val phone: String? = null,
    /** Local file of the studio logo (cached from brand-assets); null = none. */
    val logoFile: String? = null,
    /** Owner-editable footer (business_settings.receipt_footer_text), synced like the logo. */
    val footer: String = DEFAULT_RECEIPT_FOOTER,
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
    val isPayment: Boolean = false, // collect-on-invoice slip
    // What is still owed after this payment. A deposit or a part payment leaves a balance,
    // and the customer must walk away holding paper that says so.
    val balanceDueCents: Long = 0,
    // Every payment taken against this bill, dated. When there are two or more — a deposit
    // then the balance — the slip lists each with its date/time instead of one "Paid" line.
    val payments: List<ReceiptPayment> = emptyList(),
    // A voided invoice must never reprint looking alive — the web card stamps it, so do we.
    val voided: Boolean = false,
) {
    val footer: String get() = biz.footer

    /** Under-barcode caption, matching the web card: "INV-0004 · 18072026". Falls back to
     *  the bare number when the display date doesn't parse (offline fallback strings). */
    val codeLabel: String? get() = invoiceNo?.let { no ->
        runCatching {
            val d = java.time.LocalDate.parse(dateTime.take(11).trim(), java.time.format.DateTimeFormatter.ofPattern("dd MMM yyyy"))
            "$no · " + d.format(java.time.format.DateTimeFormatter.ofPattern("ddMMyyyy"))
        }.getOrDefault(no)
    }
}

/** One dated payment row on the slip (a deposit, the balance, a reversal). */
data class ReceiptPayment(val dateTime: String, val method: String, val amountCents: Long, val isReversal: Boolean = false)

/**
 * Renders a [ReceiptDoc] to the plain text a thermal printer prints — mirroring
 * the on-screen slip: Rs amounts with thousands grouping, full item names, the
 * real two-line footer. [w] is the paper's column count (32 = 58mm, 48 = 80mm)
 * so the print fills — and centres on — the actual paper. The barcode + number
 * are appended by the printer transport (they aren't text).
 */
object ReceiptText {
    private fun center(s: String, w: Int) = " ".repeat(((w - s.length) / 2).coerceAtLeast(0)) + s
    private fun rule(w: Int) = "-".repeat(w)
    private fun dec(c: Long): String {
        val n = c < 0
        val a = if (n) -c else c
        val whole = (a / 100).toString().reversed().chunked(3).joinToString(",").reversed()
        return (if (n) "-" else "") + whole + "." + (a % 100).toString().padStart(2, '0')
    }
    private fun money(c: Long) = "Rs " + dec(c)
    private fun kv(k: String, v: String, w: Int) = k + v.padStart(w - k.length)
    private fun wrap(s: String, w: Int): List<String> {
        val out = mutableListOf<String>()
        var line = StringBuilder()
        s.split(" ").forEach { word ->
            if (line.isEmpty()) line.append(word)
            else if (line.length + 1 + word.length <= w) line.append(' ').append(word)
            else { out += line.toString(); line = StringBuilder(word) }
        }
        if (line.isNotEmpty()) out += line.toString()
        return out
    }

    fun render(d: ReceiptDoc, w: Int = 32): String = buildString {
        appendLine(center(d.biz.name.uppercase(), w))
        d.biz.address?.takeIf { it.isNotBlank() }?.let { appendLine(center(it, w)) }
        val ids = listOfNotNull(d.biz.brn?.let { "BRN $it" }, d.biz.vatNo?.let { "VAT $it" }).joinToString(" · ")
        if (ids.isNotBlank()) appendLine(center(ids, w))
        d.biz.phone?.takeIf { it.isNotBlank() }?.let { appendLine(center(it, w)) }
        appendLine(rule(w))
        if (d.voided) {
            appendLine(center("*** VOID ***", w))
            appendLine(rule(w))
        }
        appendLine(kv("Invoice", d.invoiceNo ?: "—", w))
        appendLine(kv("Date", d.dateTime, w))
        appendLine(kv("Cashier", d.cashier, w))
        appendLine(kv("Customer", d.customer, w))
        appendLine(rule(w))
        // What the customer bought belongs on the slip whether they paid at the counter or
        // against a job's invoice — how the money arrived says nothing about what it was
        // for. Print the items whenever we have them; only a slip we could not price
        // (offline fallback) falls back to a bare total.
        if (d.lines.isNotEmpty()) {
            d.lines.forEach { l ->
                val qty = if (l.qty % 1.0 == 0.0) l.qty.toInt().toString() else l.qty.toString()
                val amt = money(l.inclCents)
                val nameW = w - amt.length - 1
                appendLine("$qty x ${l.title}".take(nameW).padEnd(nameW) + " " + amt)
            }
            appendLine(rule(w))
            appendLine(kv("Subtotal", money(d.subtotalCents), w))
            // Zero prints as noise — the web card hides it too.
            if (d.discountCents > 0) appendLine(kv("Discount", money(d.discountCents), w))
        }
        appendLine(kv("TOTAL", money(d.totalCents), w))
        if (d.lines.isNotEmpty()) appendLine(kv("Excl. VAT", money(d.totalCents - d.vatCents), w))
        if (d.onAccount) appendLine(kv("On account", money(d.totalCents), w))
        else if (d.payments.size > 1) {
            // A deposit then the balance — one dated line per payment.
            d.payments.forEach { p -> appendLine(kv("${p.method} ${p.dateTime}", money(p.amountCents), w)) }
        } else {
            appendLine(kv("Paid · ${d.payLabel?.lowercase()}", money(d.paidCents), w))
            appendLine(kv("Change", money(d.changeCents), w))
        }
        // The one number a customer leaving a deposit needs to see on the paper.
        if (d.balanceDueCents > 0) appendLine(kv("BALANCE DUE", money(d.balanceDueCents), w))
        appendLine(rule(w))
        wrap(d.footer, w).forEach { appendLine(center(it, w)) }
        appendLine(center("powered by ${d.biz.name}", w))
    }
}

// ─── Real ESC/POS transport (NETWORK link — raw TCP, port 9100) ───────────────
// BLUETOOTH/USB still log until their transports land; NONE logs by design.
// Failures throw IOException: the sale flow wraps print in runCatching (the sale
// committed first, and a failed print now honestly audits receipt_skipped), and
// the Settings test button surfaces the error as a toast.

/** Text → printer bytes on codepage 437 (the ESC/POS default — has a real '·'). */
internal fun cp437Bytes(text: String): ByteArray {
    val out = java.io.ByteArrayOutputStream(text.length)
    text.forEach { ch ->
        out.write(
            when {
                ch == '\n' -> 0x0A
                ch.code in 32..126 -> ch.code
                ch == '·' -> 0xFA // CP437 middle dot
                ch == '—' || ch == '–' -> '-'.code
                ch == '’' || ch == '‘' -> '\''.code
                else -> '?'.code
            },
        )
    }
    return out.toByteArray()
}

private val ESC_INIT = byteArrayOf(0x1B, 0x40, 0x1B, 0x74, 0x00) // ESC @ + select CP437
private val FEED_CUT = byteArrayOf(0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00) // feed ×4 + GS V 66 0

/** ESC @ init + CP437 body + feed + partial cut (plain-text jobs, e.g. the test slip). */
internal fun escPosReceipt(text: String): ByteArray = ESC_INIT + cp437Bytes(text) + FEED_CUT

/** Centred Code128 barcode with a caption beneath (web card prints "number · ddmmyyyy"). */
internal fun escPosBarcode(value: String, label: String = value): ByteArray {
    val data = byteArrayOf(0x7B, 0x42) + value.toByteArray(Charsets.US_ASCII) // {B → code set B
    return byteArrayOf(0x0A, 0x1B, 0x61, 0x01) + // LF + centre align
        byteArrayOf(0x1D, 0x68, 60) +            // GS h — barcode height (dots)
        byteArrayOf(0x1D, 0x77, 0x02) +          // GS w — module width
        byteArrayOf(0x1D, 0x48, 0x00) +          // GS H — no HRI (we print the caption ourselves)
        byteArrayOf(0x1D, 0x6B, 0x49, data.size.toByte()) + data + // GS k 73 (CODE128)
        cp437Bytes("\n$label\n") +
        byteArrayOf(0x1B, 0x61, 0x00)            // back to left align
}

/**
 * The cached studio logo as printer bytes, sized for [paperDots]-wide paper —
 * or null when there is no logo or it will not decode (a bad image must never
 * kill a receipt). The studio's artwork is white-and-gold on a black banner;
 * printed literally that is a solid slab of ink, so dark-majority images are
 * inverted — what is BRIGHT in the artwork becomes the ink on the paper.
 */
internal fun logoRasterBytes(path: String?, paperDots: Int): ByteArray? {
    if (path.isNullOrBlank()) return null
    return runCatching {
        val src = android.graphics.BitmapFactory.decodeFile(path) ?: return@runCatching null
        // Fit within the paper width and a sane header height; never upscale >2×.
        val scale = minOf(paperDots.toDouble() / src.width, 200.0 / src.height, 2.0)
        val w = (src.width * scale).toInt().coerceIn(1, paperDots)
        val h = (src.height * scale).toInt().coerceAtLeast(1)
        val bmp = android.graphics.Bitmap.createScaledBitmap(src, w, h, true)
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        // Luminance with transparency composited on white — paper, not black.
        val lum = DoubleArray(px.size)
        for (i in px.indices) {
            val a = (px[i] ushr 24 and 0xFF) / 255.0
            val r = px[i] ushr 16 and 0xFF
            val g = px[i] ushr 8 and 0xFF
            val b = px[i] and 0xFF
            lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a + 255.0 * (1 - a)
        }
        val invert = lum.count { it < 128.0 } * 2 > lum.size
        LogoRaster.encode(paperDots, w, h) { x, y ->
            val l = lum[y * w + x]
            if (invert) l >= 160.0 else l < 160.0
        } + byteArrayOf(0x0A)
    }.getOrNull()
}

private suspend fun sendRaw(host: String, port: Int, bytes: ByteArray) =
    withContext(Dispatchers.IO) {
        java.net.Socket().use { s ->
            s.connect(java.net.InetSocketAddress(host, port), 3_000)
            s.soTimeout = 3_000
            s.getOutputStream().run { write(bytes); flush() }
        }
    }

/** No printer configured = nothing was printed. Say so; never claim paper that does not exist. */
class NoPrinterConfigured : Exception("No printer is set up — add it in Settings › Hardware")

@Singleton
class EscPosPrinter @Inject constructor(
    private val settings: HardwareSettings,
    private val usb: UsbEscPos,
) : ReceiptPrinter {
    /** One dispatch for both slips: NETWORK and USB carry identical bytes. */
    private suspend fun deliver(c: HardwareConfig, bytes: ByteArray, logBody: String) {
        when {
            c.printerLink == PrinterLink.NETWORK && c.printerIp.isNotBlank() -> sendRaw(c.printerIp, c.printerPort, bytes)
            c.printerLink == PrinterLink.USB -> usb.send(bytes)
            else -> {
                // It used to log and return normally, so the caller cheerfully reported "printed"
                // while nothing came out. On a Z report — the fiscal slip the cash-up is signed off
                // on — that is a lie the cashier would act on.
                Log.i("POS-Printer", "(${c.printerLink.name.lowercase()} — no printer)\n$logBody")
                throw NoPrinterConfigured()
            }
        }
    }

    override suspend fun printReceipt(text: String) {
        val c = settings.config.first()
        deliver(c, escPosReceipt(text), text)
    }

    override suspend fun printDoc(doc: ReceiptDoc) {
        val c = settings.config.first()
        val w = if (c.paperWidthMm == 58) 32 else 48
        val body = ReceiptText.render(doc, w)
        // The studio logo tops the slip, like Cashmag's header (384/576 dots
        // at 8 dots per mm of printable width).
        val logo = logoRasterBytes(doc.biz.logoFile, if (c.paperWidthMm == 58) 384 else 576) ?: ByteArray(0)
        val bytes = ESC_INIT + logo + cp437Bytes(body) +
            (doc.invoiceNo?.let { escPosBarcode(it, doc.codeLabel ?: it) } ?: ByteArray(0)) +
            FEED_CUT
        deliver(c, bytes, body)
    }
}

@Singleton
class EscPosDrawer @Inject constructor(
    private val settings: HardwareSettings,
    private val usb: UsbEscPos,
) : CashDrawer {
    override suspend fun kick() {
        val c = settings.config.first()
        // ESC p 0 25ms 250ms — the standard drawer-port pulse through the printer.
        val pulse = byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())
        when {
            !c.drawerKickEnabled -> Log.i("POS-Drawer", "kick (disabled)")
            c.printerLink == PrinterLink.NETWORK && c.printerIp.isNotBlank() -> sendRaw(c.printerIp, c.printerPort, pulse)
            c.printerLink == PrinterLink.USB -> usb.send(pulse)
            else -> Log.i("POS-Drawer", "kick (${c.printerLink.name.lowercase()} — logging only)")
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class HardwareModule {
    @Binds abstract fun printer(impl: EscPosPrinter): ReceiptPrinter
    @Binds abstract fun drawer(impl: EscPosDrawer): CashDrawer
}
