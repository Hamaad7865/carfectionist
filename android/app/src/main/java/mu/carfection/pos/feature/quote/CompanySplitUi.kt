package mu.carfection.pos.feature.quote

import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.ui.theme.Success
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary

/*
 * The quote screen's side of the per-company split (tyre centre): each company's quote as its
 * own block — who issues it, its lines, subtotal, VAT (or "VAT exempt") and total — and what
 * the customer pays in all. Same content and colours as the back office's CompanySplitPanel /
 * QuoteGroupCards (index 0 amber, index 1 blue).
 */

/** One company's colours, by its place in the shop's company order. */
private data class CompanyColours(val accent: Color, val soft: Color, val tint: Color, val border: Color, val ink: Color)

private val COMPANY_COLOURS = listOf(
    CompanyColours(Color(0xFFF5A623), Color(0xFFFFF2DB), Color(0xFFFFFBF2), Color(0xFFF7E2B8), Color(0xFF9A6200)),
    CompanyColours(Color(0xFF2B8CFF), Color(0xFFE6F1FF), Color(0xFFF5F9FF), Color(0xFFCFE2FF), Color(0xFF1E6FE0)),
    CompanyColours(Color(0xFF0DA77C), Color(0xFFDDF5EC), Color(0xFFF3FBF8), Color(0xFFBDE8D8), Color(0xFF07745A)),
    CompanyColours(Color(0xFF8B5CF6), Color(0xFFEFE8FE), Color(0xFFF8F5FF), Color(0xFFDCCFFC), Color(0xFF6236D9)),
)

private fun companyColours(index: Int) = COMPANY_COLOURS[index.coerceAtLeast(0) % COMPANY_COLOURS.size]

/** The small coloured mark beside a line, saying which company sells it. */
@Composable
internal fun CompanyMark(part: CompanyPart?) {
    if (part == null) return
    val c = companyColours(part.index)
    Box(Modifier.height(20.dp).background(c.soft, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        Text(companyLabel(part.company), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Replaces the single quote's footer while the lines span companies: a block per company and
 * the combined total. A bill discount cannot cover two companies, so none is offered here —
 * the back office sets each company's own discount.
 */
@Composable
internal fun CompanySplitTotals(s: QuoteState, parts: List<CompanyPart>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (s.status == "draft" || s.amending) "Goes out as ${parts.size} quotes, one per company" else "${parts.size} quotes, one per company",
            fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextPrimary,
        )
        // Takes whatever height the card has left; a longer quote scrolls inside it, so
        // "Customer pays in all" and the Accept / Save buttons never get pushed off the card.
        Column(
            Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // While signing, the pad needs the room: one line per company, not the full blocks.
            if (s.acceptOpen) parts.forEach { part ->
                val c = companyColours(part.index)
                Row(
                    Modifier.fillMaxWidth().background(c.tint, RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(part.company.legalName, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextPrimary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(formatMUR(part.totals.totalCents), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.ink)
                }
            } else parts.forEach { part -> CompanyBlock(s, part) }
        }
        Row(
            Modifier.fillMaxWidth().background(AccentSoft, RoundedCornerShape(12.dp)).border(1.dp, AccentLine, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text("CUSTOMER PAYS IN ALL", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp, color = TextSecondary)
            Spacer(Modifier.weight(1f))
            Text(formatMUR(combinedTotalCents(parts)), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Accent)
        }
        if ((s.status == "draft" || s.amending) && !s.acceptOpen) {
            Text(
                "No discount on the whole bill while it spans two companies — set each company's own discount in the back office.",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted,
            )
        }
    }
}

@Composable
private fun CompanyBlock(s: QuoteState, part: CompanyPart) {
    val c = companyColours(part.index)
    val t = part.totals
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier.fillMaxWidth().background(c.tint, shape).border(1.dp, c.border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(26.dp).background(c.soft, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Text(companyLabel(part.company).trim().take(1).uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.ink)
            }
            Column(Modifier.weight(1f)) {
                Text(part.company.legalName, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (part.company.vatRegistered) "VAT registered" else "not VAT registered", fontFamily = Mono, fontSize = 10.sp, color = TextMuted)
            }
        }
        part.lineIndexes.forEachIndexed { k, i ->
            val line = s.lines.getOrNull(i) ?: return@forEachIndexed
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(line.title, fontFamily = Barlow, fontSize = 12.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("${line.qty}", fontFamily = Mono, fontSize = 11.5.sp, color = TextMuted, modifier = Modifier.width(26.dp))
                Text(formatMUR(t.lineExclCents[k] + t.lineVatCents[k]), fontFamily = Mono, fontSize = 12.sp, color = TextPrimary)
            }
            // The line total above is already after its discount; say so, or the price looks wrong.
            val discount = when {
                line.discountMode == DiscountMode.PCT && line.discountPct > 0 -> "${line.discountPct}% discount"
                line.discountMode == DiscountMode.AMT && line.discountAmtCents > 0 -> "${formatMUR(line.discountAmtCents)} discount"
                else -> null
            }
            if (discount != null) {
                Text("  − $discount", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, color = Success)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        SplitRow("Subtotal", formatMUR(t.subtotalCents), TextSecondary)
        if (part.company.vatRegistered) SplitRow("VAT", formatMUR(t.vatCents), TextSecondary)
        else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("VAT", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
            Spacer(Modifier.weight(1f))
            Box(
                Modifier.height(28.dp).background(InsetAlt, RoundedCornerShape(9.dp)).padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "VAT exempt",
                    fontFamily = Barlow,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 11.sp,
                    lineHeight = 13.sp,
                    textAlign = TextAlign.Center,
                    color = TextSecondary,
                    maxLines = 1,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text("Total", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextPrimary)
            Spacer(Modifier.weight(1f))
            Text(formatMUR(t.totalCents), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 19.sp, color = c.ink)
        }
    }
}

@Composable
private fun SplitRow(label: String, value: String, color: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = color)
        Spacer(Modifier.weight(1f))
        Text(value, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = color)
    }
}

/**
 * An issued quote that is one of a visit's per-company quotes: the others, one tap away, so
 * the operator can see both before resending (a send from here goes to every one of them).
 */
@Composable
internal fun VisitSiblings(s: QuoteState, onOpen: (mu.carfection.pos.core.network.QuoteRowDto) -> Unit) {
    val group = s.checkoutGroupId ?: return
    val visit = s.quotes.filter { it.checkoutGroupId == group }
    if (visit.size < 2) return
    val order = orderCompanies(s.companies)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("THIS VISIT · ${visit.size} QUOTES, ONE PER COMPANY", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.2.sp, color = TextMuted)
        visit.sortedBy { q -> order.indexOfFirst { it.id == q.legalEntityId }.let { if (it < 0) Int.MAX_VALUE else it } }.forEach { q ->
            val index = order.indexOfFirst { it.id == q.legalEntityId }
            val c = companyColours(index)
            val company = order.getOrNull(index)
            val current = q.id == s.quoteId
            val shape = RoundedCornerShape(10.dp)
            Row(
                Modifier.fillMaxWidth().background(c.tint, shape).border(if (current) 2.dp else 1.dp, if (current) c.accent else c.border, shape)
                    .clickable(enabled = !current) { onOpen(q) }.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(q.number ?: "Draft", fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = c.ink)
                Text(company?.let(::companyLabel) ?: "", fontFamily = Barlow, fontSize = 12.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(if (current) "open" else "open →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, color = if (current) TextMuted else c.ink)
            }
        }
    }
}
