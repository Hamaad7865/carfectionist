package mu.carfection.pos.core.print

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.FlowInvoiceRefDto
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.JobCommentDto
import mu.carfection.pos.core.network.JobPhotoDto
import mu.carfection.pos.core.network.QuoteLineDto
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The A4 job card — the whole work order (customer, car, what was ordered, who is on it,
 * checklist, notes, photos, the paper trail) on one printable sheet.
 *
 * The tablet's thermal printer is a receipt device, so A4 goes through the ANDROID PRINT
 * FRAMEWORK instead of ESC/POS: this file renders the card as static HTML and hands it to
 * the system print dialogue, where the owner picks the shop's A4 printer. No new transport,
 * no new dependency — WebView + PrintManager are both part of the platform.
 */

private val MU = ZoneOffset.ofHours(4)
private val STAMP = DateTimeFormatter.ofPattern("EEE d MMM yyyy HH:mm")
private val SHORT_STAMP = DateTimeFormatter.ofPattern("dd MMM HH:mm")

/** ISO instants arrive in several shapes ("…Z", "+04:00"); anything unparseable prints as-is. */
private fun fmt(iso: String?): String? = iso?.let {
    runCatching { OffsetDateTime.parse(it).atZoneSameInstant(MU).format(STAMP) }.getOrDefault(it)
}

private fun fmtShort(iso: String?): String? = iso?.let {
    runCatching { OffsetDateTime.parse(it).atZoneSameInstant(MU).format(SHORT_STAMP) }.getOrDefault(it)
}

/** Mirrors statusChip() on the jobs board — same words on paper as on screen. */
internal fun statusLabel(status: String): String = when (status) {
    "in_progress" -> "IN PROGRESS"
    "ready" -> "READY"
    "delivered" -> "DELIVERED"
    "cancelled" -> "CANCELLED"
    else -> "SCHEDULED"
}

private fun esc(s: String?): String = (s ?: "")
    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    .replace("\"", "&quot;").replace("'", "&#39;")

/** Whole quantities read as counts ("2×"); fractional ones keep their decimals ("0.5×"). */
private fun qtyLabel(qty: Double): String =
    if (qty == kotlin.math.floor(qty) && !qty.isInfinite()) qty.toInt().toString() else qty.toString()

/** The live invoice — never a voided or draft copy (same rule as liveInvoiceOf on the board). */
internal fun liveInvoiceOf(j: JobBoardDto): FlowInvoiceRefDto? =
    j.invoices.lastOrNull { it.docType == "invoice" && it.status != "void" && it.status != "draft" }

/**
 * Builds the job card as a self-contained A4 HTML document. Pure — no Android classes — so
 * the layout is pinned by unit tests exactly like ReceiptText.render is.
 *
 * [crewNames] is lead-first (JobsViewModel.roster); the LEAD tag shows only once there is a
 * crew for someone to lead, matching the chips on screen.
 */
fun jobCardHtml(
    biz: ReceiptBiz,
    j: JobBoardDto,
    lines: List<QuoteLineDto>,
    crewNames: List<String>,
    comments: List<JobCommentDto>,
    photos: List<JobPhotoDto> = emptyList(),
    photoUrls: Map<String, String> = emptyMap(),
): String {
    val jobRef = "JOB-" + j.id.take(4).uppercase()
    val inv = liveInvoiceOf(j)
    val cert = j.certificates.firstOrNull()
    val quoteNo = j.sourceQuote?.number

    val sb = StringBuilder()
    sb.append("<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>")
        .append(esc(jobRef)).append(" work order</title><style>")
        .append("@page{size:A4;margin:13mm 12mm 15mm}")
        .append("*{box-sizing:border-box;margin:0;padding:0}")
        .append("body{font-family:Arial,'Helvetica Neue',sans-serif;color:#111826;font-size:11px;line-height:1.45}")
        .append(".biz{text-align:center;border-bottom:2.5px solid #111826;padding-bottom:9px;margin-bottom:14px}")
        .append(".biz h1{font-size:23px;letter-spacing:3.5px;font-weight:bold}")
        .append(".biz .sub{font-size:10px;color:#5b6773;margin-top:3px}")
        .append(".bar{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px}")
        .append(".bar h2{font-size:19px;letter-spacing:1.5px}")
        .append(".chip{display:inline-block;padding:2px 10px;border-radius:10px;font-size:9.5px;font-weight:bold;letter-spacing:.6px;border:1.5px solid #98a4b0;color:#33414f}")
        .append(".meta{text-align:right;color:#5b6773;font-size:10px;line-height:1.5}")
        .append(".grid{width:100%;border-collapse:separate;border-spacing:8px 0;margin-bottom:6px}")
        .append(".box{border:1px solid #cfd6dd;border-radius:7px;padding:8px 11px;background:#f7f9fb}")
        .append(".lbl{font-size:8.5px;letter-spacing:1.3px;font-weight:bold;color:#7a8692;margin-bottom:3px}")
        .append(".big{font-size:13px;font-weight:bold}")
        .append(".plate{display:inline-block;border:1.5px solid #111826;background:#fdfbe8;border-radius:4px;")
        .append("padding:1px 8px;font-family:'Courier New',monospace;font-weight:bold;font-size:12px;letter-spacing:.5px}")
        .append(".muted{color:#5b6773}.small{font-size:10px}")
        .append(".rowline{padding:6px 11px;border:1px solid #e3e8ed;border-radius:7px;background:#fbfcfd;margin-bottom:6px;display:flex;justify-content:space-between}")
        .append(".warn{border-color:#d9a441;background:#fdf6e7;color:#8a6414;font-weight:bold;display:block}")
        .append(".sec{font-size:9.5px;letter-spacing:1.4px;font-weight:bold;color:#7a8692;border-bottom:1px solid #cfd6dd;")
        .append("padding-bottom:3px;margin:14px 0 7px}")
        .append("table.lines{width:100%;border-collapse:collapse}")
        .append("table.lines td{padding:6px 4px;border-bottom:1px solid #eceff2;vertical-align:top}")
        .append("table.lines tr:last-child td{border-bottom:none}")
        .append(".qty{width:36px;color:#5b6773;font-weight:bold;white-space:nowrap}")
        .append(".svc{font-weight:bold;font-size:12px}")
        .append(".desc{color:#5b6773;font-size:10px;margin-top:2px}")
        .append(".person{display:inline-block;border:1.2px solid #cfd6dd;background:#f1f4f7;border-radius:12px;")
        .append("padding:3px 11px;margin:0 5px 5px 0;font-weight:bold;font-size:11px}")
        .append(".lead{border-color:#2f6fd6;color:#2f6fd6}")
        .append(".leadtag{font-size:8px;letter-spacing:.8px;vertical-align:middle;margin-left:5px}")
        .append("table.chk{width:100%;border-collapse:collapse}")
        .append("table.chk td{padding:4px 4px;border-bottom:1px dotted #e3e8ed;font-size:11.5px}")
        .append(".done{color:#7a8692;text-decoration:line-through}")
        .append(".mark{display:inline-block;width:15px;color:#33414f}")
        .append(".cmt{margin-bottom:7px}.cmt .who{color:#7a8692;font-size:9.5px;margin-top:1px}")
        .append(".photo{display:inline-block;margin:0 6px 6px 0;text-align:center;vertical-align:top}")
        .append(".photo img{width:150px;height:110px;object-fit:cover;border:1px solid #cfd6dd;border-radius:6px;display:block}")
        .append(".photo .cap{font-size:9px;color:#7a8692;margin-top:2px}")
        .append(".refs{margin-top:13px;font-size:10.5px;color:#33414f}")
        .append(".refs div{margin-bottom:2px}")
        .append("footer{margin-top:18px;border-top:1px solid #cfd6dd;padding-top:6px;color:#7a8692;font-size:9px;")
        .append("display:flex;justify-content:space-between}")
        .append("</style></head><body>")

    // ── letterhead ────────────────────────────────────────────────────────────
    sb.append("<div class='biz'><h1>").append(esc(biz.name.uppercase())).append("</h1>")
    val sub = listOfNotNull(biz.address?.takeIf { it.isNotBlank() }, biz.phone?.takeIf { it.isNotBlank() })
        .joinToString(" · ")
    if (sub.isNotEmpty()) sb.append("<div class='sub'>").append(esc(sub)).append("</div>")
    val fiscal = listOfNotNull(
        biz.brn?.takeIf { it.isNotBlank() }?.let { "BRN ${it}" },
        biz.vatNo?.takeIf { it.isNotBlank() }?.let { "VAT ${it}" },
    ).joinToString(" · ")
    if (fiscal.isNotEmpty()) sb.append("<div class='sub'>").append(esc(fiscal)).append("</div>")
    sb.append("</div>")

    // ── title bar ─────────────────────────────────────────────────────────────
    sb.append("<div class='bar'><div><h2>WORK ORDER</h2></div><div class='meta'>")
    sb.append("<span class='big'>").append(esc(jobRef)).append("</span> <span class='chip'>")
        .append(statusLabel(j.status)).append("</span><br/>")
    sb.append("Printed ").append(esc(OffsetDateTime.now(MU).format(STAMP)))
    sb.append("</div></div>")

    // ── customer / vehicle ────────────────────────────────────────────────────
    val vehBits = listOfNotNull(j.vehicles?.make, j.vehicles?.model, j.vehicles?.colour).filter { it.isNotBlank() }
    sb.append("<table class='grid'><tr>")
    sb.append("<td style='width:50%'><div class='box'><div class='lbl'>CUSTOMER</div><div class='big'>")
        .append(esc(j.customers?.name ?: "—")).append("</div>")
    if (!j.customers?.phone.isNullOrBlank()) sb.append("<div class='muted small'>").append(esc(j.customers?.phone)).append("</div>")
    sb.append("</div></td>")
    sb.append("<td style='width:50%'><div class='box'><div class='lbl'>VEHICLE</div><span class='plate'>")
        .append(esc(j.vehicles?.plate ?: "—")).append("</span>")
    if (vehBits.isNotEmpty()) sb.append("<div class='small' style='margin-top:3px'>").append(esc(vehBits.joinToString(" · "))).append("</div>")
    sb.append("</div></td></tr></table>")

    // ── timeline rows ─────────────────────────────────────────────────────────
    data class Row(val label: String, val value: String?)
    listOf(
        Row("Booked for", fmt(j.scheduledAt)),
        Row("Started", fmt(j.startedAt)),
        Row("Marked ready", fmt(j.readyAt)),
        Row("Delivered", fmt(j.deliveredAt)),
        Row("Estimate", j.estimatedMinutes?.let { "~$it min" }),
    ).filter { it.value != null }.forEach { r ->
        sb.append("<div class='rowline'><span class='muted'>").append(r.label)
            .append("</span><span>").append(esc(r.value)).append("</span></div>")
    }

    // ── standing description + damage marks ───────────────────────────────────
    if (!j.notes.isNullOrBlank()) {
        sb.append("<div class='sec'>NOTES</div><div>").append(esc(j.notes)).append("</div>")
    }
    if (j.damageMarkers.isNotEmpty()) {
        val n = j.damageMarkers.size
        sb.append("<div class='rowline warn'>⚠ ").append(n)
            .append(" pre-existing damage mark").append(if (n > 1) "s" else "")
            .append(" recorded at intake</div>")
    }
    if (j.cancelledAt != null || !j.cancelReason.isNullOrBlank()) {
        sb.append("<div class='rowline warn'>Cancelled")
        if (!j.cancelReason.isNullOrBlank()) sb.append(" — ").append(esc(j.cancelReason))
        sb.append("</div>")
    }

    // ── what the customer ordered ─────────────────────────────────────────────
    if (lines.isNotEmpty()) {
        sb.append("<div class='sec'>WORK ORDERED</div><table class='lines'>")
        lines.forEach { l ->
            sb.append("<tr><td class='qty'>").append(esc(qtyLabel(l.qty))).append("×</td><td><span class='svc'>")
                .append(esc(l.title)).append("</span>")
            if (!l.description.isNullOrBlank()) sb.append("<div class='desc'>").append(esc(l.description)).append("</div>")
            sb.append("</td></tr>")
        }
        sb.append("</table>")
    }

    // ── who is on the car ─────────────────────────────────────────────────────
    if (crewNames.isNotEmpty()) {
        sb.append("<div class='sec'>").append(if (crewNames.size > 1) "CREW" else "TECHNICIANS").append("</div>")
        crewNames.forEachIndexed { i, name ->
            sb.append("<span class='person").append(if (crewNames.size > 1 && i == 0) " lead" else "").append("'>")
                .append(esc(name))
            if (crewNames.size > 1 && i == 0) sb.append("<span class='leadtag'>LEAD</span>")
            sb.append("</span>")
        }
    }

    // ── checklist ─────────────────────────────────────────────────────────────
    if (j.checklist.isNotEmpty()) {
        val doneN = j.checklist.count { it.done }
        sb.append("<div class='sec'>CHECKLIST · ").append(doneN).append("/").append(j.checklist.size).append("</div><table class='chk'>")
        j.checklist.forEach { c ->
            sb.append("<tr><td style='width:20px'><span class='mark'>").append(if (c.done) "☑" else "☐")
                .append("</span></td><td class='").append(if (c.done) "done" else "").append("'>")
                .append(esc(c.label)).append("</td></tr>")
        }
        sb.append("</table>")
    }

    // ── comments ──────────────────────────────────────────────────────────────
    if (comments.isNotEmpty()) {
        sb.append("<div class='sec'>COMMENTS</div>")
        comments.forEach { c ->
            sb.append("<div class='cmt'><div>").append(esc(c.body))
            val who = listOfNotNull(
                c.creator?.displayName?.trim()?.split(" ")?.firstOrNull(),
                c.createdAt?.let(::fmtShort),
            ).joinToString(" · ")
            if (who.isNotEmpty()) sb.append("<div class='who'>").append(esc(who)).append("</div>")
            sb.append("</div></div>")
        }
    }

    // ── before / after photos ─────────────────────────────────────────────────
    listOf("before" to "BEFORE", "after" to "AFTER").forEach { (phase, label) ->
        val shots = photos.filter { it.phase == phase }.mapNotNull { p -> photoUrls[p.id]?.let { url -> url } }
        if (shots.isNotEmpty()) {
            sb.append("<div class='sec'>").append(label).append("</div>")
            shots.forEach { url ->
                sb.append("<span class='photo'><img src=\"").append(esc(url))
                    .append("\"/><span class='cap'>").append(label.lowercase()).append("</span></span>")
            }
        }
    }

    // ── paper trail refs ──────────────────────────────────────────────────────
    val refs = buildList {
        quoteNo?.let { add("Quote $it") }
        inv?.let { b ->
            val total = formatMUR(rupeesToCents(b.totalIncl))
            add("Invoice ${b.number ?: "—"}${if (b.status == "paid") " (paid)" else ""} · $total")
        }
        cert?.let { c -> add("Certificate ${c.number}${c.expiresAt?.let { " · valid to $it" } ?: ""}") }
    }
    if (refs.isNotEmpty()) {
        sb.append("<div class='refs'>")
        refs.forEach { sb.append("<div>").append(esc(it)).append("</div>") }
        sb.append("</div>")
    }

    // ── footer ────────────────────────────────────────────────────────────────
    sb.append("<footer><span>").append(esc(jobRef)).append(" · ").append(statusLabel(j.status))
        .append("</span><span>Carfectionist POS</span></footer>")

    sb.append("</body></html>")
    return sb.toString()
}

/**
 * Hands rendered HTML to the system print dialogue at A4. The dialogue itself talks to the
 * paired A4 printer (USB or network print service) — like every other print path here, this
 * is fire-and-forget: a refusal surfaces as a toast, never blocks anything.
 *
 * The off-screen WebView must outlive the call (the framework snapshots pages from it after
 * return), so the instance is held until the next print replaces it.
 */
@Singleton
class JobCardPrinter @Inject constructor() {
    private var pending: WebView? = null

    /** Must be called on the main thread (WebView creation). */
    fun print(ctx: Context, html: String, documentName: String): Result<Unit> = runCatching {
        val activity = ctx.findActivity() ?: error("Printing needs the app's own screen")
        pending?.destroy()
        pending = null

        val webView = WebView(activity)
        pending = webView
        // Only needed to poll image readiness below; the document itself is static HTML.
        webView.settings.javaScriptEnabled = true

        var waitedMs = 0L
        fun handOff() {
            val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
            val attrs = PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                // ~5 mm minimum; the page's own @page margins do the rest of the framing.
                .setMinMargins(PrintAttributes.Margins(200, 200, 200, 200))
                .build()
            pm.print(documentName, webView.createPrintDocumentAdapter(documentName), attrs)
        }

        /** Photos load over the network into the snapshot; wait (bounded) for them. */
        fun waitForImages() {
            webView.evaluateJavascript(
                "(function(){var i=document.images;for(var k=0;k<i.length;k++){if(!i[k].complete)return 'loading';}return 'ok';})()",
            ) { state ->
                when {
                    state != "\"loading\"" -> handOff()
                    waitedMs < IMAGE_WAIT_BUDGET_MS -> {
                        waitedMs += IMAGE_POLL_MS
                        webView.postDelayed({ waitForImages() }, IMAGE_POLL_MS)
                    }
                    else -> handOff()
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) = waitForImages()
        }
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private tailrec fun Context.findActivity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

    companion object {
        private const val IMAGE_POLL_MS = 300L
        private const val IMAGE_WAIT_BUDGET_MS = 4000L
    }
}
