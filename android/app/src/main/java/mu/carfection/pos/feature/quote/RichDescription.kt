package mu.carfection.pos.feature.quote

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import mu.carfection.pos.core.rich.RichBlock
import mu.carfection.pos.core.rich.RichDoc
import mu.carfection.pos.core.rich.RichRun
import mu.carfection.pos.core.rich.isBulletsOnly
import mu.carfection.pos.core.rich.parseRichDoc
import mu.carfection.pos.core.rich.richDocToBullets
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextSecondary

/**
 * A line's rich description, on the tablet.
 *
 * The tablet RENDERS everything the back office can write — marks, numbered lists,
 * tables — even though it only AUTHORS bullets. That asymmetry is deliberate: a
 * quote is drafted at a desk and adjusted at reception, and reception must be able
 * to read what it is adjusting.
 *
 * The same tree drives the printed A4 (apps/web/src/lib/rich/render.tsx). Keep the
 * two looking like each other: a bullet here and a dash there is a lie told to
 * whoever typed it.
 */

private fun runs(runs: List<RichRun>): AnnotatedString = buildAnnotatedString {
    runs.forEach { r ->
        val style = SpanStyle(
            fontWeight = if (r.bold) FontWeight.Bold else null,
            fontStyle = if (r.italic) FontStyle.Italic else null,
            textDecoration = when {
                r.strike && r.href != null -> TextDecoration.combine(listOf(TextDecoration.LineThrough, TextDecoration.Underline))
                r.strike -> TextDecoration.LineThrough
                r.href != null -> TextDecoration.Underline
                else -> null
            },
        )
        withStyle(style) { append(r.text) }
    }
}

@Composable
private fun Line(text: AnnotatedString, modifier: Modifier = Modifier) {
    Text(text, modifier, fontFamily = Barlow, fontSize = 12.sp, color = TextSecondary, lineHeight = 17.sp)
}

@Composable
private fun Bulleted(items: List<List<RichRun>>, marker: (Int) -> String) {
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        items.forEachIndexed { i, item ->
            Row {
                Text(
                    marker(i),
                    Modifier.width(if (items.size > 9) 22.dp else 14.dp),
                    fontFamily = Barlow, fontSize = 12.sp, color = TextSecondary, lineHeight = 17.sp,
                )
                Line(runs(item))
            }
        }
    }
}

@Composable
fun RichDescription(doc: RichDoc?, modifier: Modifier = Modifier) {
    val blocks = doc?.blocks.orEmpty()
    if (blocks.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        blocks.forEach { block ->
            when (block) {
                is RichBlock.Paragraph -> Line(runs(block.runs))
                is RichBlock.BulletList -> Bulleted(block.items) { "•" }
                is RichBlock.OrderedList -> Bulleted(block.items) { "${it + 1}." }
                is RichBlock.Table -> Column(
                    Modifier.border(1.dp, Hairline, RoundedCornerShape(6.dp)).padding(1.dp),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    block.rows.forEachIndexed { r, row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                            row.forEach { cell ->
                                Column(
                                    Modifier
                                        .weight(1f)
                                        .background(if (r == 0) Color(0x0A101A24) else Color.Transparent)
                                        .padding(horizontal = 6.dp, vertical = 3.dp),
                                ) { Line(runs(cell)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The description block inside an expanded line.
 *
 * Bullets are editable here. Anything richer — a table, a numbered list, bold text —
 * is shown but NOT editable, because rewriting it as bullet rows would silently
 * destroy what the back office wrote. `isBulletsOnly` decides, and the operator is
 * told why rather than left wondering where the editor went.
 */
@Composable
fun LineDescription(line: QuoteLine, index: Int, vm: QuoteViewModel) {
    val doc = parseRichDoc(line.richJson)
    val editable = isBulletsOnly(doc)

    /**
     * The rows being edited are LOCAL state, not a projection of the saved document.
     *
     * They cannot be derived from it: bulletsToRichDoc drops blank bullets on purpose —
     * a saved description should not carry empty ones — so a row the operator has not
     * typed into yet would never survive the round trip. Deriving them meant "+ Add a
     * line" did nothing at all, and clearing a bullet made its row vanish under the
     * cursor. Blank rows live here; only the non-blank ones reach the document.
     *
     * Seeded per line, and re-seeded whenever the panel is collapsed and reopened,
     * which is also how an edit made elsewhere gets picked up.
     */
    var rows by remember(index) { mutableStateOf(richDocToBullets(doc).ifEmpty { listOf("") }) }
    fun apply(next: List<String>) {
        rows = next.ifEmpty { listOf("") }
        vm.setLineBullets(index, next)
    }
    val bullets = rows

    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            "WHAT THIS INCLUDES",
            fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp,
            letterSpacing = 1.1.sp, color = TextMuted,
        )

        if (!editable) {
            RichDescription(doc)
            Text(
                "Formatted in the back office — open it there to change it.",
                fontFamily = Barlow, fontSize = 11.sp, color = TextMuted,
            )
            return@Column
        }

        bullets.forEachIndexed { b, text ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("•", fontFamily = Barlow, fontSize = 14.sp, color = TextMuted)
                FilledInput(
                    value = text,
                    onValueChange = { v -> apply(bullets.toMutableList().also { it[b] = v }) },
                    placeholder = "e.g. Full Vehicle decontamination",
                    modifier = Modifier.weight(1f), height = 40.dp, radius = 10.dp,
                    bg = CardBg, fontFamily = Barlow, fontSize = 13.sp,
                )
                Box(
                    Modifier.size(40.dp).background(Inset, RoundedCornerShape(10.dp))
                        .clickable { apply(bullets.toMutableList().also { it.removeAt(b) }) },
                    contentAlignment = Alignment.Center,
                ) { Text("✕", color = TextMuted, fontFamily = Barlow, fontSize = 14.sp) }
            }
        }

        Box(
            Modifier.background(Inset, RoundedCornerShape(10.dp))
                .clickable { apply(bullets + "") }
                .padding(horizontal = 14.dp, vertical = 9.dp),
        ) {
            Text("+ Add a line", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = TextSecondary)
        }
    }
}
