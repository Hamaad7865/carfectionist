package mu.carfection.pos.feature.counter

import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.CompanyDiscountSpec
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.money.Allowance
import mu.carfection.pos.core.money.DocDiscount
import mu.carfection.pos.core.money.DocDiscountTotals
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.computeAllowance
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.CompanyDto
import java.security.MessageDigest

/**
 * The till of a shop with SEVERAL issuing companies (the tyre centre: VAT tyres + non-VAT
 * services) — the tablet twin of the web's features/tyrecentre/new-sale/bills.ts.
 *
 * Owner rule (2026-11-22): discounts are PER COMPANY. Each company's lines are one bill with its
 * own discount, its own allowance and its own reason, exactly as issue_checkout will issue them
 * and as app.assert_discount_allowed checks each bill on its own. A one-company shop
 * (Carfectionist) never builds these: its whole-sale discount stays as it always was.
 */

/** One company's bill discount, as the cashier typed it. */
data class CompanyDisc(
    val mode: DiscountMode = DiscountMode.PCT,
    val text: String = "",
    val reason: String = "",
    /** An owner's PIN approval, pinned to this company's bill id ([checkoutBillId]). */
    val approvedMaxCents: Long? = null,
) {
    val pct: Int get() = if (mode == DiscountMode.PCT) (text.toIntOrNull() ?: 0).coerceIn(0, 100) else 0
    val amtCents: Long get() = if (mode == DiscountMode.AMT) (parseMoneyToCents(text) ?: 0L).coerceAtLeast(0) else 0
    val kind: String?
        get() = when {
            mode == DiscountMode.PCT && pct > 0 -> "percent"
            mode == DiscountMode.AMT && amtCents > 0 -> "amount"
            else -> null
        }
}

/** One invoice of the sale, as the till shows it before charging. */
data class TillBill(
    val company: CompanyDto,
    /** Indexes into the cart of this company's lines, in cart order. */
    val lineIndexes: List<Int>,
    val totals: DocDiscountTotals,
    val allowance: Allowance,
    val blockReason: String?,
    val disc: CompanyDisc,
) {
    val name: String get() = companyName(company)
}

fun companyName(c: CompanyDto): String = c.tradingName?.trim()?.takeIf { it.isNotEmpty() } ?: c.legalName

/** Which company sells a line: the product's own, else the shop's main company — the rule the
 *  database stamps lines with (app.lines_stamp_entity). An ad-hoc line has no product: main. */
fun companyIdOf(line: CartLine, companies: List<CompanyDto>): String? {
    val main = companies.firstOrNull { it.isDefault } ?: companies.firstOrNull()
    val own = line.product.legalEntityId
    return if (own != null && companies.any { it.id == own }) own else main?.id
}

/** Why a bill can't be charged yet — the same two refusals as the whole-sale discount. */
fun discountBlockOf(a: Allowance, reason: String): String? = when {
    a.overCeiling -> "This discount is over the ${formatMUR(a.ceilingCents)} allowed on this bill — ask the owner."
    a.reasonRequired && reason.isBlank() -> "Add a reason for this discount before issuing."
    else -> null
}

/**
 * The sale as one bill per company, in the shop's company order (the order issue_checkout
 * issues them). A company with nothing in the cart has no bill.
 */
fun tillBills(
    cart: List<CartLine>,
    companies: List<CompanyDto>,
    discs: Map<String, CompanyDisc>,
    carwashPct: Double,
): List<TillBill> {
    if (cart.isEmpty() || companies.isEmpty()) return emptyList()
    val byCompany = cart.indices.groupBy { companyIdOf(cart[it], companies) }
    return companies.mapNotNull { co ->
        val idx = byCompany[co.id].orEmpty()
        if (idx.isEmpty()) return@mapNotNull null
        val lines = idx.map { cart[it] }
        val disc = discs[co.id] ?: CompanyDisc()
        val kind = disc.kind
        val allowance = computeAllowance(
            lines.map { it.allowanceInput },
            docDiscount = kind?.let { DocDiscount(it, if (it == "percent") disc.pct.toDouble() else disc.amtCents.toDouble()) },
            approvedMaxCents = disc.approvedMaxCents,
            carwashPct = carwashPct,
        )
        TillBill(
            company = co,
            lineIndexes = idx,
            totals = computeDocTotals(lines.map { it.docLine }, kind, disc.pct.toDouble(), disc.amtCents),
            allowance = allowance,
            blockReason = discountBlockOf(allowance, disc.reason),
            disc = disc,
        )
    }
}

/**
 * Every bill's figures as ONE [DocDiscountTotals], so the footer, the pay panel and the slip keep
 * reading a single object. Line figures come from the whole cart in cart order (a line's own
 * amount never depends on the bill discount); the headline figures are the bills' sums.
 */
fun combinedTotals(cart: List<CartLine>, bills: List<TillBill>): DocDiscountTotals {
    val lines = computeDocTotals(cart.map { it.docLine }, null, 0.0, 0)
    return lines.copy(
        orderDiscountInclCents = bills.sumOf { it.totals.orderDiscountInclCents },
        subtotalCents = bills.sumOf { it.totals.subtotalCents },
        vatCents = bills.sumOf { it.totals.vatCents },
        totalCents = bills.sumOf { it.totals.totalCents },
    )
}

/** Why the sale can't be charged yet, naming the company when there are two bills. */
fun billsBlockReason(bills: List<TillBill>): String? {
    val blocked = bills.firstOrNull { it.blockReason != null } ?: return null
    return if (bills.size > 1) "${blocked.name}: ${blocked.blockReason}" else blocked.blockReason
}

/** What issue_checkout takes: each discounted company's own discount (amount in rupees). */
fun companyDiscountSpecs(bills: List<TillBill>): List<CompanyDiscountSpec> = bills.mapNotNull { b ->
    val kind = b.disc.kind ?: return@mapNotNull null
    CompanyDiscountSpec(
        legalEntityId = b.company.id,
        kind = kind,
        value = if (kind == "percent") b.disc.pct.toDouble() else centsToRupees(b.disc.amtCents),
        reason = b.disc.reason.trim().takeIf { it.isNotEmpty() },
    )
}

/**
 * The id a company's bill will carry once a two-company sale is charged — the first company's
 * bill keeps the draft's id; every other company's is md5(draft || ':' || company) read as a
 * uuid (public.checkout_document_ids). Named up front so an owner's approval can be pinned to
 * that bill before it exists, exactly as the one-company till pins it to its draft.
 */
fun checkoutBillId(draftId: String, companyId: String, first: Boolean): String {
    if (first) return draftId
    val h = MessageDigest.getInstance("MD5").digest("$draftId:$companyId".toByteArray())
        .joinToString("") { "%02x".format(it) }
    return "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}"
}
