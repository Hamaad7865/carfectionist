package mu.carfection.pos.core.hardware

import android.content.Context
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

/**
 * One sold line as the slip prints it: the UNDISCOUNTED unit price ("UP" column) beside the
 * line total the customer actually pays, with the saving spelled out underneath.
 *
 * [inclCents] is what this line adds to the bill (post-discount, VAT-inclusive);
 * [grossInclCents] is what it would have been at full price. The difference is the discount,
 * so `Σ grossInclCents − Σ inclCents` is exactly the "Discount" the totals block shows.
 */
data class ReceiptLine(
    val title: String,
    val qty: Double,
    val inclCents: Long,
    /** Full unit price, VAT-inclusive, before any line discount. */
    val unitInclCents: Long = 0,
    /** qty × unitInclCents — the "Initial price" sub-line, and what Subtotal sums. */
    val grossInclCents: Long = inclCents,
    /** Set only for a percentage discount, so the slip can say "Discount 35.0% / 608.30". */
    val discountPct: Double = 0.0,
) {
    /** What this line saved the customer, VAT-inclusive. 0 = print no discount sub-lines. */
    val discountInclCents: Long get() = (grossInclCents - inclCents).coerceAtLeast(0)
}

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
    /** The CLIENT's own fiscal identity, printed under their name for a business customer.
     *  Blank/null for a walk-in or individual — the slip then omits the lines. */
    val customerBrn: String? = null,
    val customerVatNo: String? = null,
    val lines: List<ReceiptLine>,
    // Σ of the lines at FULL price, VAT-inclusive — i.e. before any discount, line or basket.
    // Subtotal − Discount = TOTAL always holds, so the customer can see what they saved.
    val subtotalCents: Long,
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
    // ── the fiscal slip's identity block (matches the studio's Cashmag layout) ──
    /** "No. 11" — this sale's position within the current till session. */
    val ticketNo: Int? = null,
    /** "Bill 1-N00000028" — the internal order reference, already formatted. */
    val billNo: String? = null,
    /** "Appareil 1" — which terminal rang it up. */
    val terminalNo: Int? = null,
    /** "Duplicata 2 - <when>" — set only when this is a REPRINT, never on the original. */
    val duplicataNo: Int? = null,
    val duplicataAt: String? = null,
    /** Per-VAT-rate tax breakdown ("TAUX NORMAL 15.0% : 202.23Rs"). */
    val vatGroups: List<ReceiptVatGroup> = emptyList(),
    /**
     * Set when this sale was rung with no network: the device reference standing in for a
     * fiscal number that does not exist yet ("OFF-66D2-014"). A slip carrying this is proof
     * the customer paid, and says plainly that it is NOT a VAT invoice — only the server may
     * mint one of those, and it does so when the sale reaches it. Never set together with
     * [invoiceNo]: the moment a real number exists, the real invoice is what reprints.
     */
    val offlineRef: String? = null,
    /**
     * Points earned by THIS sale, and the customer's running balance after it (rule 4,
     * 2026-08-10) — null unless the bill names a real customer, exactly like the web card's
     * ReceiptData.pointsEarned/pointsBalanceAfter. An anonymous walk-in leaves both null and
     * prints exactly as it did before points existed.
     */
    val pointsEarned: Int? = null,
    val pointsBalanceAfter: Int? = null,
) {
    val footer: String get() = biz.footer

    /** "Sale - SALES [CARFECTIONIST]" — the sale-mode line under the numbers. */
    val saleModeLabel: String get() = "Sale - SALES [${biz.name.uppercase()}]"

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

/** One VAT rate's tax line: base excl., the tax itself, and the inclusive figure. */
data class ReceiptVatGroup(val ratePct: Double, val baseCents: Long, val vatCents: Long) {
    val inclCents: Long get() = baseCents + vatCents
    /** The reference slip's wording, kept verbatim from the studio's own receipt. */
    val label: String get() = "TAUX NORMAL " + (if (ratePct % 1.0 == 0.0) "%.1f".format(ratePct) else ratePct.toString()) + "%"
}

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

    /** Plain 2dp, NO thousands separator — the studio's slip prints "2233.00", not "2,233.00". */
    private fun plain(c: Long): String {
        val n = c < 0
        val a = if (n) -c else c
        return (if (n) "-" else "") + (a / 100).toString() + "." + (a % 100).toString().padStart(2, '0')
    }

    /** "1550.45Rs" — the reference puts the unit AFTER the figure. */
    private fun rs(c: Long) = plain(c) + "Rs"

    private fun bold(s: String) = "$ESC_BOLD_ON$s$ESC_BOLD_OFF"
    private fun qtyText(q: Double) = if (q % 1.0 == 0.0) q.toInt().toString() else q.toString()

    /**
     * Laid out to match the studio's own fiscal slip section for section: identity, the
     * numbered sale block, Qty/Designation/UP/Total columns with each line's saving spelled
     * out beneath it, a Subtotal/Discount/Total block that shows what the discount was worth,
     * the tender lines, the per-rate tax breakdown, and the fiscal footer.
     */
    fun render(d: ReceiptDoc, w: Int = 32): String = buildString {
        // ── identity ──────────────────────────────────────────────────────────────
        // The logo raster is prepended by the transport, so the name only prints when
        // there is no logo — otherwise the studio's name would appear on the slip twice.
        if (d.biz.logoFile == null) appendLine(center(bold(d.biz.name.uppercase()), w))
        // "Helvetia, 80840 Moka, MU" prints as two centred lines, as on the reference.
        d.biz.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach {
            val part = it.trim()
            if (part.isNotEmpty()) appendLine(center(part, w))
        }
        appendLine(rule(w))
        if (d.voided) {
            appendLine(center(bold("*** VOID ***"), w))
            appendLine(rule(w))
        }

        // ── the numbered sale block ───────────────────────────────────────────────
        d.ticketNo?.let { appendLine(center(bold("No. $it"), w)) }
        // A sale rung offline has no fiscal number and must not pretend otherwise. It says
        // what it is instead: proof of payment, with the VAT invoice still to come.
        if (d.offlineRef != null) {
            appendLine(center(bold("PROVISIONAL SALE SLIP"), w))
            appendLine(center(bold("Ref ${d.offlineRef}"), w))
            appendLine(center("Not a VAT invoice.", w))
            wrap("Your VAT invoice is issued when this till is back online.", w)
                .forEach { appendLine(center(it, w)) }
        } else {
            appendLine(center(bold("NUM VAT INVOICE ${d.invoiceNo ?: "—"}"), w))
        }
        d.billNo?.let { appendLine(center(bold("Bill $it"), w)) }
        appendLine(center(d.saleModeLabel, w))
        appendLine(center(d.dateTime, w))
        // Who it was for. The builders already fall back to "Walk-in", so this line is never
        // blank — a counter sale says so rather than leaving the customer unidentified.
        // Wrapped, not truncated: a long Mauritian name would otherwise lose its surname on
        // 58mm paper, and it is the customer's own receipt.
        d.customer.takeIf { it.isNotBlank() }?.let { name ->
            wrap("Customer : $name", w).forEach { appendLine(center(it, w)) }
        }
        // A business client's own fiscal numbers, directly under their name — the buyer's BRN/VRN
        // a VAT invoice must carry, as distinct from the issuer's in the footer. Same VAT-prefix
        // normalisation as the footer, so "VAT20345678" states "20345678".
        d.customerBrn?.takeIf { it.isNotBlank() }?.let { appendLine(center("BRN : $it", w)) }
        d.customerVatNo?.takeIf { it.isNotBlank() }?.let { appendLine(center("VAT No : " + it.removePrefix("VAT").trim(), w)) }
        appendLine(rule(w))

        if (d.lines.isNotEmpty()) {
            // ── items: Qty | Designation | UP | Total ─────────────────────────────
            // Columns scale with the paper: the money columns keep their width and the
            // designation takes what is left, so 58mm and 80mm both stay aligned.
            val qtyW = 4
            val numW = if (w >= 48) 10 else 8
            val nameW = (w - qtyW - numW * 2).coerceAtLeast(6)
            appendLine("Qty ".take(qtyW).padEnd(qtyW) + "Designation".take(nameW).padEnd(nameW) + "UP".padStart(numW) + "Total".padStart(numW))
            d.lines.forEach { l ->
                // The item itself carries the weight; its discount sub-lines stay light, so the
                // eye lands on what was bought and what it cost — as on the studio's own slip.
                appendLine(
                    bold(
                        qtyText(l.qty).take(qtyW).padEnd(qtyW) + l.title.take(nameW).padEnd(nameW) +
                            plain(l.unitInclCents).padStart(numW) + plain(l.inclCents).padStart(numW),
                    ),
                )
                // What they saved, in the reference's own words — only when there IS a saving.
                if (l.discountInclCents > 0) {
                    appendLine("Initial price : " + plain(l.grossInclCents))
                    appendLine(
                        if (l.discountPct > 0) "Discount " + "%.1f".format(l.discountPct) + "% / " + plain(l.discountInclCents)
                        else "Discount : " + plain(l.discountInclCents),
                    )
                }
            }
            appendLine(rule(w))

            // ── totals ────────────────────────────────────────────────────────────
            // Subtotal is the lines at FULL price and Discount is the gap to the total, so
            // Subtotal − Discount = Total foots however the discount was stored (per line,
            // whole-basket, or both).
            appendLine(kv("    Subtotal :", plain(d.subtotalCents), w))
            if (d.discountCents > 0) appendLine(kv("    Discount :", plain(d.discountCents), w))
        }
        appendLine(center(bold("Total: " + rs(d.totalCents)), w))
        if (d.lines.isNotEmpty()) appendLine(center(bold("excl. VAT : " + rs(d.totalCents - d.vatCents)), w))
        appendLine(rule(w))

        // ── tenders ───────────────────────────────────────────────────────────────
        // The leading digit is the COUNT of tenders of that kind, as on the reference slip —
        // two cash legs of a split read "2   CASH", not "1" twice. A voided invoice never
        // shows money as owed or collected — same rule as the web card's showTenders
        // (ReceiptCard.tsx: !r.voided && r.isInvoice), since every doc built here is an invoice.
        if (!d.voided) {
            if (d.onAccount) {
                appendLine(bold("1   ON ACCOUNT : " + rs(d.totalCents)))
            } else if (d.payments.size > 1) {
                d.payments
                    .filterNot { it.isReversal }
                    .groupBy { it.method.uppercase() }
                    .forEach { (method, ps) -> appendLine(bold("${ps.size}   $method : " + rs(ps.sumOf { it.amountCents }))) }
                // A reversed leg is money that came back — state it rather than quietly netting it.
                d.payments.filter { it.isReversal }.forEach { p ->
                    appendLine(bold("1   ${p.method.uppercase()} REVERSED : " + rs(p.amountCents)))
                }
            } else {
                appendLine(bold("1   ${(d.payLabel ?: "PAID").uppercase()} : " + rs(d.paidCents)))
                if (d.changeCents > 0) appendLine(kv("    Change :", plain(d.changeCents), w))
            }
            // The one number a customer leaving a deposit needs to see on the paper.
            if (d.balanceDueCents > 0) appendLine(kv("    BALANCE DUE :", plain(d.balanceDueCents), w))
            // Points earned by this sale, and the running balance after it — only when the
            // bill actually names a customer (never the anonymous walk-in). Word for word
            // the same lines as the web card (ReceiptCard.tsx).
            if (d.pointsEarned != null && d.pointsBalanceAfter != null) {
                appendLine(kv("    Points earned :", "${d.pointsEarned} pts", w))
                appendLine(kv("    Points balance :", "${d.pointsBalanceAfter} pts", w))
            }
            appendLine(rule(w))
        }

        // ── tax breakdown ─────────────────────────────────────────────────────────
        if (d.lines.isNotEmpty()) {
            val groups = d.vatGroups.ifEmpty {
                listOf(ReceiptVatGroup(d.vatRatePct.toDouble(), d.totalCents - d.vatCents, d.vatCents))
            }
            groups.forEach { g ->
                appendLine("${g.label} : " + rs(g.vatCents))
                // One line on 80mm as the reference has it; 58mm can't hold it, so it
                // breaks in two rather than running off the edge of the paper.
                val both = "excl. VAT = " + rs(g.baseCents) + " / Incl. tax = " + rs(g.inclCents)
                if (both.length <= w) appendLine(both)
                else {
                    appendLine("excl. VAT = " + rs(g.baseCents))
                    appendLine("Incl. tax = " + rs(g.inclCents))
                }
            }
            appendLine(rule(w))
        }

        // ── fiscal footer ─────────────────────────────────────────────────────────
        wrap(d.footer, w).forEach { appendLine(center(bold(it), w)) }
        // A reprint has to declare itself — the original is the only one that doesn't.
        d.duplicataNo?.let { appendLine(center("Duplicata $it" + (d.duplicataAt?.let { at -> " - $at" } ?: ""), w)) }
        d.terminalNo?.let { appendLine(center("Appareil $it", w)) }
        d.biz.brn?.takeIf { it.isNotBlank() }?.let { appendLine(center("BRN : $it", w)) }
        // Stored as "VAT28070619"; the slip states the number itself under its own label.
        d.biz.vatNo?.takeIf { it.isNotBlank() }?.let { appendLine(center("VAT number : " + it.removePrefix("VAT").trim(), w)) }
        appendLine(center(d.cashier, w))
    }
}

// ─── Real ESC/POS transport (NETWORK link — raw TCP, port 9100) ───────────────
// BLUETOOTH/USB still log until their transports land; NONE logs by design.
// Failures throw IOException: the sale flow wraps print in runCatching (the sale
// committed first, and a failed print now honestly audits receipt_skipped), and
// the Settings test button surfaces the error as a toast.

// Sentinel chars ZSlip wraps section headers with; cp437Bytes turns them into ESC/POS
// emphasis (bold) on/off. They are non-printable and never appear in real receipt/slip text.
internal const val ESC_BOLD_ON = '\u0001'
internal const val ESC_BOLD_OFF = '\u0002'

/** Text → printer bytes on codepage 437 (the ESC/POS default — has a real '·'). */
internal fun cp437Bytes(text: String): ByteArray {
    val out = java.io.ByteArrayOutputStream(text.length)
    text.forEach { ch ->
        when (ch) {
            // Header sentinels → ESC E 1 / ESC E 0 (emphasis on/off).
            ESC_BOLD_ON -> { out.write(0x1B); out.write(0x45); out.write(0x01) }
            ESC_BOLD_OFF -> { out.write(0x1B); out.write(0x45); out.write(0x00) }
            '\n' -> out.write(0x0A)
            '·' -> out.write(0xFA) // CP437 middle dot
            '—', '–' -> out.write('-'.code)
            '’', '‘' -> out.write('\''.code)
            else -> out.write(if (ch.code in 32..126) ch.code else '?'.code)
        }
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

/**
 * The Ethernet network whose subnet contains [host], if the tablet has one. A printer
 * cabled into the tablet's OWN LAN jack lives on a network Android never routes to by
 * default (Wi-Fi, with internet, is the default network) — an unbound socket to
 * 192.168.10.100 would take the Wi-Fi and die with EHOSTUNREACH. Binding the socket
 * to the Ethernet network forces the bytes down the wire the printer hangs off.
 */
private fun ethernetFor(context: Context, host: String): android.net.Network? {
    val cm = context.getSystemService(android.net.ConnectivityManager::class.java) ?: return null
    val target = runCatching { java.net.InetAddress.getByName(host).address }.getOrNull() ?: return null
    for (n in cm.allNetworks) {
        val caps = cm.getNetworkCapabilities(n) ?: continue
        if (!caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)) continue
        val links = cm.getLinkProperties(n)?.linkAddresses ?: continue
        for (la in links) {
            val a = la.address.address
            if (a.size != target.size) continue
            var bits = la.prefixLength
            var same = true
            for (i in a.indices) {
                if (bits <= 0) break
                val mask = if (bits >= 8) 0xFF else (0xFF shl (8 - bits)) and 0xFF
                if ((a[i].toInt() and mask) != (target[i].toInt() and mask)) { same = false; break }
                bits -= 8
            }
            if (same) return n
        }
    }
    return null
}

private suspend fun sendRaw(context: Context, host: String, port: Int, bytes: ByteArray) =
    withContext(Dispatchers.IO) {
        java.net.Socket().use { s ->
            ethernetFor(context, host)?.bindSocket(s)
            s.connect(java.net.InetSocketAddress(host, port), 3_000)
            s.soTimeout = 3_000
            s.getOutputStream().run { write(bytes); flush() }
        }
    }

/** No printer configured = nothing was printed. Say so; never claim paper that does not exist. */
class NoPrinterConfigured : Exception("No printer is set up — add it in Settings › Hardware")

@Singleton
class EscPosPrinter @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context,
    private val settings: HardwareSettings,
    private val usb: UsbEscPos,
) : ReceiptPrinter {
    /** One dispatch for both slips: NETWORK and USB carry identical bytes. */
    private suspend fun deliver(c: HardwareConfig, bytes: ByteArray, logBody: String) {
        when {
            c.printerLink == PrinterLink.NETWORK && c.printerIp.isNotBlank() -> sendRaw(context, c.printerIp, c.printerPort, bytes)
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
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context,
    private val settings: HardwareSettings,
    private val usb: UsbEscPos,
) : CashDrawer {
    override suspend fun kick() {
        val c = settings.config.first()
        // ESC p 0 25ms 250ms — the standard drawer-port pulse through the printer.
        val pulse = byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())
        when {
            !c.drawerKickEnabled -> Log.i("POS-Drawer", "kick (disabled)")
            c.printerLink == PrinterLink.NETWORK && c.printerIp.isNotBlank() -> sendRaw(context, c.printerIp, c.printerPort, pulse)
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
