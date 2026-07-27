package mu.carfection.pos.core.data

import mu.carfection.pos.core.hardware.ESC_BOLD_OFF
import mu.carfection.pos.core.hardware.ESC_BOLD_ON
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.network.StockAdjustmentDto

/** One adjustment as the slip states it — resolved once so the UI and the paper agree. */
data class AdjustmentRow(
    val id: String,
    val whenLabel: String,   // "27-07 12:04"
    val product: String,
    val qty: Double,         // signed: + received, − removed
    val reason: String,
    val location: String?,
    val who: String?,
) {
    /** "+3" / "−1" — the sign is the whole point of the line, so it is never dropped. */
    val qtyLabel: String get() {
        val n = if (qty % 1.0 == 0.0) qty.toInt().toString() else qty.toString()
        return if (qty < 0) "−" + n.removePrefix("-") else "+$n"
    }
}

/** "2026-07-27T12:04:31.12+00:00" → "27-07 12:04" (Mauritius, UTC+4). */
internal fun adjustmentWhen(iso: String?): String = runCatching {
    java.time.OffsetDateTime.parse(iso)
        .atZoneSameInstant(java.time.ZoneOffset.ofHours(4))
        .format(java.time.format.DateTimeFormatter.ofPattern("dd-MM HH:mm"))
}.getOrDefault(iso?.take(16)?.replace('T', ' ') ?: "—")

fun adjustmentRow(d: StockAdjustmentDto): AdjustmentRow = AdjustmentRow(
    id = d.id,
    whenLabel = adjustmentWhen(d.movedAt),
    product = d.products?.name ?: "—",
    qty = d.qty,
    reason = d.note?.trim().orEmpty().ifBlank { "Adjustment" },
    location = d.location?.name,
    who = d.creator?.displayName?.replace(Regex("\\s*\\(.*\\)$"), "")?.takeIf { it.isNotBlank() },
)

/**
 * The stock-adjustment log, printed on the same thermal roll as the receipts.
 *
 * What the owner does with this: hand it to a supplier with a return, file it against a
 * stock count, or check what a member of staff moved. So each line has to carry the four
 * facts that make an adjustment answerable — when, what, how much, and why — and the
 * footer has to say what the selection did to stock on the whole.
 */
object StockAdjustmentSlip {

    fun render(rows: List<AdjustmentRow>, biz: ReceiptBiz, width: Int = 48, printedAt: String): String = buildString {
        fun centre(s: String) = appendLine(s.padStart(((width + s.length) / 2).coerceAtMost(width)))
        fun centreBold(s: String) = appendLine(ESC_BOLD_ON + s.padStart(((width + s.length) / 2).coerceAtMost(width)) + ESC_BOLD_OFF)
        fun rule() = appendLine("-".repeat(width))
        fun kv(left: String, right: String) {
            val room = (width - left.length - right.length).coerceAtLeast(1)
            appendLine(left + " ".repeat(room) + right)
        }
        fun kvBold(left: String, right: String) {
            val room = (width - left.length - right.length).coerceAtLeast(1)
            appendLine(ESC_BOLD_ON + left + " ".repeat(room) + right + ESC_BOLD_OFF)
        }

        // ALWAYS as text, unlike the receipt. This slip goes out through printReceipt(), which
        // is escPosReceipt(text) — no logo raster is prepended, only printDoc() does that. Making
        // the name conditional on a logo (as the receipt does) left this slip with no header at
        // all on the live tablet, where a logo IS configured. Same rule ZSlip uses.
        centreBold(biz.name.uppercase())
        // split(",", limit = 2) — the SAME rule the receipt header uses, so the studio's
        // address reads identically on both papers ("Helvetia" / "80840 Moka, MU").
        biz.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { centre(it.trim()) }
        centreBold("STOCK ADJUSTMENTS")
        centre(printedAt)
        rule()

        if (rows.isEmpty()) {
            centre("Nothing selected")
            rule()
            return@buildString
        }

        // qty right-aligned in its own column so a column of +/- reads down the page.
        val qtyW = 5
        val nameW = (width - qtyW - 1).coerceAtLeast(8)
        rows.forEach { r ->
            appendLine(ESC_BOLD_ON + r.whenLabel + ESC_BOLD_OFF)
            appendLine(ESC_BOLD_ON + r.product.take(nameW).padEnd(nameW) + " " + r.qtyLabel.padStart(qtyW) + ESC_BOLD_OFF)
            // Reason and place stay light: the eye wants the product and the number first.
            appendLine("  " + listOfNotNull(r.reason, r.location).joinToString(" · ").take(width - 2))
            r.who?.let { appendLine("  by $it") }
        }
        rule()

        val received = rows.filter { it.qty > 0 }.sumOf { it.qty }
        val removed = rows.filter { it.qty < 0 }.sumOf { -it.qty }
        val net = received - removed
        fun n(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else d.toString()
        kv("Adjustments", rows.size.toString())
        kv("Units received", "+" + n(received))
        kv("Units removed", "−" + n(removed))
        kvBold("NET CHANGE", (if (net < 0) "−" + n(-net) else "+" + n(net)))
        rule()
        appendLine()
        appendLine()
    }
}
