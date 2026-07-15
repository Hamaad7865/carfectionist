package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mu.carfection.pos.core.hardware.ReceiptBiz
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.ZReportDto

/**
 * The "Clôture de période" slip, rendered from the Z report's FROZEN totals.
 *
 * Nothing is recomputed here — every figure was fixed by the server at the moment the till
 * was closed. That is what makes a reprint next month identical to the paper in the file,
 * even though the world has moved on (the on-account invoice on it may since have been paid).
 */
object ZSlip {

    private fun JsonObject.num(key: String): Double =
        this[key]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0

    private fun JsonObject.int(key: String): Int =
        this[key]?.jsonPrimitive?.content?.toDoubleOrNull()?.toInt() ?: 0

    private fun JsonObject.str(key: String): String? =
        this[key]?.jsonPrimitive?.content?.takeIf { it != "null" }

    private fun money(rupees: Double) = formatMUR(rupeesToCents(rupees))

    fun render(z: ZReportDto, biz: ReceiptBiz, width: Int = 48): String = buildString {
        val t = z.totals
        fun line(left: String, right: String) {
            val room = (width - left.length - right.length).coerceAtLeast(1)
            appendLine(left + " ".repeat(room) + right)
        }
        fun centre(s: String) = appendLine(s.padStart(((width + s.length) / 2).coerceAtMost(width)))
        fun rule() = appendLine("-".repeat(width))

        centre(biz.name.uppercase())
        centre("Cloture de periode")
        biz.address?.takeIf { it.isNotBlank() }?.let { centre(it) }
        centre(z.number)
        z.closedAt?.let { centre(it.take(16).replace('T', ' ')) }
        rule()

        // A day slip carries every service, then the period — exactly like the owner's till.
        val services = t["services"]?.jsonArray
        if (services != null && services.size > 0) {
            services.forEach { s ->
                appendServiceBlock(s.jsonObject, ::line, ::centre, ::rule, width)
            }
            centre("Period")
        } else {
            centre("Service ${t.int("service_no")}")
            line("Initial cash float", money(t.num("float_initial")))
            line("Final cash float", money(t.num("float_final")))
            line("Deleted bills", t.int("voided_bills").toString())
            line("Canceled orders", "0")
            line("Delete items", "0")
            rule()
        }

        appendTotalsBlock(t, ::line, ::rule)

        // Sale modes — SALES [trading name] restated with its VAT, like the owner's slip.
        line("Sale modes", "")
        line("  SALES [${biz.name.uppercase()}]", money(t.num("total_incl")))
        t["vat"]?.jsonArray?.forEach { v ->
            val o = v.jsonObject
            line("  ${o.str("label")}", money(o.num("vat")))
            line("    excl. ${money(o.num("excl"))}", "incl. ${money(o.num("incl"))}")
        }
        rule()

        appendLine("Closed by ${(t["cashiers"]?.jsonArray?.firstOrNull()?.jsonObject?.str("name")) ?: "—"}")
        z.note?.takeIf { it.isNotBlank() }?.let { appendLine("Note: $it") }
        appendLine()
        appendLine()
    }

    private fun appendServiceBlock(
        s: JsonObject,
        line: (String, String) -> Unit,
        centre: (String) -> Unit,
        rule: () -> Unit,
        width: Int,
    ) {
        centre("Service ${s.int("service_no")}")
        line("Initial cash float", money(s.num("float_initial")))
        line("Final cash float", money(s.num("float_final")))
        line("Deleted bills", s.int("voided_bills").toString())
        line("Canceled orders", "0")
        line("Delete items", "0")
        line("Counted", money(s.num("counted_cash")))
        val variance = s.num("variance")
        if (variance != 0.0) line("Variance", money(variance))
        line("Total service incl. tax", money(s.num("total_incl")))
        line("${s.int("tickets")} tickets", "Avg. " + money(s.num("avg_basket")))
        rule()
    }

    private fun appendTotalsBlock(t: JsonObject, line: (String, String) -> Unit, rule: () -> Unit) {
        line("Total incl. tax", money(t.num("total_incl")))
        line("${t.int("tickets")} tickets", "Avg. " + money(t.num("avg_basket")))
        val reversals = t.int("reversals")
        if (reversals > 0) line("$reversals reversal${if (reversals == 1) "" else "s"}", "")
        val voided = t.int("voided_bills")
        if (voided > 0) line("$voided voided bill${if (voided == 1) "" else "s"}", "")
        rule()

        line("Means of payment", "")
        t["methods"]?.jsonArray?.forEach { m ->
            val o = m.jsonObject
            val method = o.str("method")?.replace('_', ' ')?.uppercase() ?: "?"
            val count = o.int("count")
            if (method == "CASH") {
                line("  CASH", money(o.num("gross")))
                line("  CHANGE", money(o.num("change")))
                line("  CASHBACK", money(0.0))
                line("  CASH NET", money(o.num("net")))
            } else {
                line("  $count $method", money(o.num("net")))
            }
        }
        val credit = t["customer_credit"]?.jsonObject
        if (credit != null && credit.num("amount") != 0.0) {
            line("  ${credit.int("count")} CUSTOMER CREDIT", money(credit.num("amount")))
        }
        rule()

        val cats = t["categories"]?.jsonArray
        if (cats != null && cats.size > 0) {
            line("Categories", "")
            cats.forEach { c ->
                val o = c.jsonObject
                line("  ${o.int("lines")} ${o.str("name")?.uppercase()}", money(o.num("incl")))
            }
            rule()
        }

        val cashiers = t["cashiers"]?.jsonArray
        if (cashiers != null && cashiers.size > 0) {
            line("User as cashier", "")
            cashiers.forEach { c ->
                val o = c.jsonObject
                line("  ${o.str("name")}", money(o.num("total")))
                o["methods"]?.jsonArray?.forEach { m ->
                    val mo = m.jsonObject
                    line("      ${mo.str("method")?.replace('_', ' ')?.uppercase()}", money(mo.num("amount")))
                }
            }
            rule()
            // Sales person = the same people (the shop's cashier is the salesperson).
            line("Sales person", "")
            cashiers.forEach { c ->
                val o = c.jsonObject
                line("  ${o.str("name")}", money(o.num("total")))
            }
            rule()
        }

        val vat = t["vat"]?.jsonArray
        if (vat != null && vat.size > 0) {
            line("VAT", "")
            vat.forEach { v ->
                val o = v.jsonObject
                line("  ${o.str("label")}", money(o.num("vat")))
                line("    excl. ${money(o.num("excl"))}", "incl. ${money(o.num("incl"))}")
            }
            rule()
        }

        // What went to the bank on this close, and what is still piling up in the drawer.
        val acc = t["accumulation"]?.jsonArray
        if (acc != null && acc.size > 0) {
            line("Float accumulation", "")
            acc.forEach { a ->
                val o = a.jsonObject
                val m = o.str("method")?.replace('_', ' ')?.uppercase() ?: "?"
                if (o.num("remitted") > 0.0) line("  $m remitted to bank", money(o.num("remitted")))
                line("  $m carried on", money(o.num("float_out")))
            }
        }
    }
}
