package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.money.DocDiscountTotals
import mu.carfection.pos.core.money.DocLineIn
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.network.CompanyDto

/*
 * A two-company shop (tyre centre): a quote whose lines are sold by different issuing companies
 * goes out as ONE QUOTE PER COMPANY, each numbered in its own company's series.
 *
 * The split itself is the database's (app.split_by_company, reached through issue_checkout — the
 * web's issueAcrossCompanies runs it for every send, the tablet's included). This file only
 * mirrors its grouping so the quote screen can SHOW the parts before they are numbered. It is the
 * tablet twin of apps/web/src/lib/documents/company-split.ts; CompanySplitTest holds the same
 * fixture as that file's test and scripts/_verify-quote-split.mjs, so the three cannot drift.
 */

/** Display name: the trading name, else the legal name. */
fun companyLabel(c: CompanyDto): String = c.tradingName?.trim()?.takeIf { it.isNotEmpty() } ?: c.legalName

/** Companies in the order the database numbers a split in (sort_order, then id). */
fun orderCompanies(companies: List<CompanyDto>): List<CompanyDto> =
    companies.sortedWith(compareBy({ it.sortOrder }, { it.id }))

fun defaultCompanyId(companies: List<CompanyDto>): String? = companies.firstOrNull { it.isDefault }?.id

/**
 * Which company sells this line. Mirrors app.lines_stamp_entity:
 *  - a catalogue line → its product's company; a product with no company → the default company;
 *  - a hand-typed line → THE DRAFT'S company as stored when it is saved ([draftCompanyId]), else
 *    the default. A draft takes its lines' company whenever they all share one
 *    (app.draft_follows_lines), so the screen passes the company its last save returned.
 */
fun lineCompanyId(
    productId: String?,
    productCompany: Map<String, String?>,
    companies: List<CompanyDto>,
    draftCompanyId: String? = null,
): String? {
    val fallback = defaultCompanyId(companies)
    if (productId == null) return draftCompanyId?.takeIf { id -> companies.any { it.id == id } } ?: fallback
    val own = productCompany[productId]
    return own?.takeIf { id -> companies.any { it.id == id } } ?: fallback
}

/** One company's own discount on its quote: percent 0..100, or cents off the VAT-inclusive total. */
data class CompanyDiscount(val kind: String, val value: Double)

/** One company's quote of a split: which of the quote's lines it holds, and what it comes to. */
data class CompanyPart(
    val company: CompanyDto,
    /** Its place in the shop's company order — picks its colour. */
    val index: Int,
    val lineIndexes: List<Int>,
    val totals: DocDiscountTotals,
)

/**
 * The quotes this one becomes, one per company that sells something on it, in company order.
 * One part (or none) means nothing is split: it stays one quote, exactly as today.
 * A non-VAT company charges no VAT on any line (lines_stamp_entity forces vat_rate 0).
 */
fun splitByCompany(
    lines: List<DocLineIn>,
    companyOf: (Int) -> String?,
    companies: List<CompanyDto>,
    discounts: Map<String, CompanyDiscount> = emptyMap(),
): List<CompanyPart> {
    val fallback = defaultCompanyId(companies)
    val byCompany = LinkedHashMap<String, MutableList<Int>>()
    lines.indices.forEach { i ->
        val id = companyOf(i) ?: fallback ?: return@forEach
        byCompany.getOrPut(id) { mutableListOf() }.add(i)
    }
    return orderCompanies(companies).mapIndexedNotNull { index, company ->
        val own = byCompany[company.id] ?: return@mapIndexedNotNull null
        val priced = own.map { i -> if (company.vatRegistered) lines[i] else lines[i].copy(vatRatePct = 0.0) }
        val d = discounts[company.id]?.takeIf { it.value > 0 && (it.kind == "percent" || it.kind == "amount") }
        CompanyPart(
            company = company,
            index = index,
            lineIndexes = own,
            totals = computeDocTotals(
                priced,
                orderKind = d?.kind,
                orderPct = if (d?.kind == "percent") d.value else 0.0,
                orderAmtInclCents = if (d?.kind == "amount") d.value.toLong() else 0L,
            ),
        )
    }
}

fun combinedTotalCents(parts: List<CompanyPart>): Long = parts.sumOf { it.totals.totalCents }
