package mu.carfection.pos.feature.quote

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.ui.FilledInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.window.Dialog
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.Plate
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Tile

private fun Modifier.card(radius: Int = 16) = this.background(CardBg, RoundedCornerShape(radius.dp)).border(1.dp, Hairline, RoundedCornerShape(radius.dp))

private fun Modifier.dashedBorder(color: Color, radius: Dp, stroke: Dp = 1.5.dp) = this.drawBehind {
    val sw = stroke.toPx(); val r = radius.toPx()
    drawRoundRect(color = color, topLeft = Offset(sw / 2, sw / 2), size = Size(size.width - sw, size.height - sw), cornerRadius = CornerRadius(r, r), style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(sw * 5, sw * 4))))
}

@Composable
fun QuoteScreen(onGoIntake: () -> Unit, onViewJob: () -> Unit, viewModel: QuoteViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(s.mode) { if (s.mode == QuoteMode.LIST) viewModel.loadQuotes() } // refresh list on entry / when returning from builder
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (s.mode == QuoteMode.LIST) QuoteList(s, viewModel, onGoIntake) else QuoteBuilder(s, viewModel, onViewJob)
    }
    s.createdJobId?.let {
        Dialog(onDismissRequest = viewModel::clearToast) {
            Column(Modifier.width(380.dp).card().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Quote accepted", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                Text("JOB-${it.take(4).uppercase()} created.", fontFamily = Barlow, fontSize = 13.sp, color = TextSecondary)
                FillBtn("Done", Modifier.fillMaxWidth()) { viewModel.clearToast(); viewModel.back() }
            }
        }
    }
    s.createdInvoiceRef?.let {
        Dialog(onDismissRequest = viewModel::clearToast) {
            Column(Modifier.width(380.dp).card().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Invoice issued", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                Text("$it — collect it in Checkout.", fontFamily = Barlow, fontSize = 13.sp, color = TextSecondary)
                FillBtn("Done", Modifier.fillMaxWidth()) { viewModel.clearToast(); viewModel.back() }
            }
        }
    }
    if (s.adhocOpen) AdhocDialog(viewModel)
}

@Composable
private fun AdhocDialog(vm: QuoteViewModel) {
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    val cents = parseMoneyToCents(price)
    Dialog(onDismissRequest = vm::closeAdhoc) {
        Column(Modifier.width(440.dp).card().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Ad-hoc line", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
            Text("A one-off service or product, priced by hand.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
            MiniLabel("DESCRIPTION")
            FilledInput(value = name, onValueChange = { name = it }, placeholder = "e.g. Headlight restoration", modifier = Modifier.fillMaxWidth(), bg = Inset)
            MiniLabel("UNIT PRICE (Rs, excl. VAT)")
            FilledInput(value = price, onValueChange = { p -> price = p.filter { it.isDigit() || it == '.' } }, placeholder = "0.00", modifier = Modifier.fillMaxWidth(), bg = Inset)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                OutlineBtn("Cancel", Modifier.weight(1f), 52) { vm.closeAdhoc() }
                Box(Modifier.weight(1.4f).height(52.dp).background(if (name.isNotBlank() && cents != null && cents > 0) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = name.isNotBlank() && cents != null && cents > 0) { vm.addAdhoc(name, cents ?: 0) }, contentAlignment = Alignment.Center) {
                    Text("Add line", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (name.isNotBlank() && cents != null && cents > 0) AccentInk else TextMuted)
                }
            }
        }
    }
}

// ── LIST ──────────────────────────────────────────────────────────────────────
@Composable
private fun ColumnScope.QuoteList(s: QuoteState, vm: QuoteViewModel, onGoIntake: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("QUOTATIONS", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
        Text("Tap a quote to edit — start new quotes from Intake", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        Spacer(Modifier.weight(1f))
        OutlineBtn("+ New intake", h = 44) { onGoIntake() }
    }
    if (s.loading) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = TextMuted) }
    } else if (s.quotes.isEmpty()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("No quotes yet — start one from Intake.", color = TextMuted, fontFamily = Barlow, fontSize = 14.sp) }
    } else {
        LazyVerticalGrid(columns = GridCells.Fixed(3), horizontalArrangement = Arrangement.spacedBy(11.dp), verticalArrangement = Arrangement.spacedBy(11.dp), modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(s.quotes, key = { it.id }) { q ->
                Column(Modifier.card(15).clickable { vm.openQuote(q) }.padding(horizontal = 15.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(q.number ?: "Draft", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextSecondary)
                        Spacer(Modifier.weight(1f))
                        StatusChip(q.status)
                    }
                    Text(q.customers?.name ?: "—", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(q.vehicles?.plate, listOfNotNull(q.vehicles?.make, q.vehicles?.model).joinToString(" ").ifBlank { null }).joinToString(" · ").ifBlank { "—" }, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                        Text(formatMUR(mu.carfection.pos.core.money.rupeesToCents(q.totalIncl)), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary)
                        Spacer(Modifier.weight(1f))
                        Text(q.updatedAt?.take(10) ?: "", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
                    }
                }
            }
        }
    }
}

// ── BUILDER ───────────────────────────────────────────────────────────────────
@Composable
private fun ColumnScope.QuoteBuilder(s: QuoteState, vm: QuoteViewModel, onViewJob: () -> Unit) {
    // header
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(12.dp)).clickable { vm.back() }, contentAlignment = Alignment.Center) { Text("←", fontFamily = Barlow, fontSize = 18.sp, color = TextSecondary) }
        Text(s.ref.uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
        StatusChip(s.status)
        Spacer(Modifier.weight(1f))
        Text(s.who, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextSecondary)
        s.vehPlate?.let { Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) { Text(it, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Color(0xFF151208)) } }
        if (s.veh.isNotBlank()) Text(s.veh, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted)
    }

    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // LEFT 53 — tabs + product grid
        Column(Modifier.weight(53f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth().horizontalScrollRow(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                vm.tabs(s).forEach { t ->
                    val sel = t == s.tab
                    Box(Modifier.height(38.dp).background(if (sel) AccentSoft else InsetAlt, RoundedCornerShape(19.dp)).border(if (sel) 1.5.dp else 1.dp, if (sel) AccentLine else Hairline, RoundedCornerShape(19.dp)).clickable { vm.setTab(t) }.padding(horizontal = 15.dp), contentAlignment = Alignment.Center) {
                        Text(t, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (sel) Accent else TextSecondary)
                    }
                }
            }
            LazyVerticalGrid(columns = GridCells.Fixed(2), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.fillMaxSize()) {
                items(vm.filteredProducts(s), key = { it.id }) { p ->
                    val count = s.lines.firstOrNull { it.productId == p.id }?.qty
                    Box(Modifier.height(84.dp).background(Tile, RoundedCornerShape(13.dp)).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { vm.addProduct(p) }.padding(horizontal = 13.dp, vertical = 12.dp)) {
                        Column {
                            Text(p.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, lineHeight = 18.sp, color = TextPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 20.dp))
                            Spacer(Modifier.weight(1f))
                            Text(formatMUR(p.sellingPriceCents), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextSecondary)
                        }
                        if (count != null) Box(Modifier.align(Alignment.TopEnd).size(23.dp).background(Accent, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { Text(count.toString(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = AccentInk) }
                    }
                }
                item {
                    Column(Modifier.height(84.dp).fillMaxWidth().dashedBorder(Color(0x40101A24), 13.dp).clickable { vm.openAdhoc() }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text("+", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = TextSecondary)
                        Spacer(Modifier.height(6.dp))
                        Text("Ad-hoc line — typed", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, letterSpacing = 0.4.sp, color = TextSecondary)
                    }
                }
            }
        }
        // RIGHT 47 — quote lines
        Column(Modifier.weight(47f).fillMaxHeight().card()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("QUOTE LINES", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.6.sp, color = TextMuted)
                Spacer(Modifier.weight(1f))
                Text("${s.lines.size} line${if (s.lines.size == 1) "" else "s"}", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextSecondary)
            }
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                if (s.lines.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("No lines yet", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextMuted)
                        Text("Tap services and products on the left", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                    }
                }
                s.lines.forEachIndexed { i, l ->
                    val lineTotal = vm.totals(s).lines.getOrNull(i)?.exclCents ?: 0L
                    Column(Modifier.fillMaxWidth().background(if (l.expanded) InsetAlt else Color(0xFFF1F4F7), RoundedCornerShape(12.dp)).border(1.dp, Color(0x12101A24), RoundedCornerShape(12.dp))) {
                        Row(Modifier.fillMaxWidth().clickable { vm.toggleLine(i) }.padding(horizontal = 13.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(l.title, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("×${l.qty}" + if (l.discountPct > 0) "  ·  −${l.discountPct}%" else "", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                            }
                            Text(formatMUR(lineTotal), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary)
                        }
                        if (l.expanded) Row(Modifier.fillMaxWidth().padding(start = 13.dp, end = 13.dp, bottom = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StepBtn("−") { vm.setQty(i, l.qty - 1) }
                            Text(l.qty.toString(), Modifier.width(30.dp), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary, maxLines = 1)
                            StepBtn("+") { vm.setQty(i, l.qty + 1) }
                            Box(Modifier.width(1.dp).height(24.dp).background(Color(0x1F101A24)))
                            listOf(0, 5, 10, 15, 20).forEach { d ->
                                val on = l.discountPct == d
                                Box(Modifier.height(34.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(9.dp)).border(1.dp, if (on) AccentLine else Color(0x17101A24), RoundedCornerShape(9.dp)).clickable { vm.setDiscount(i, d) }.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                                    Text(if (d == 0) "0%" else "$d%", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = if (on) Accent else TextSecondary)
                                }
                            }
                            Spacer(Modifier.weight(1f))
                            Box(Modifier.size(40.dp).background(Color(0x1FD63A3A), RoundedCornerShape(10.dp)).clickable { vm.removeLine(i) }, contentAlignment = Alignment.Center) { Text("✕", color = Danger, fontFamily = Barlow, fontSize = 15.sp) }
                        }
                    }
                }
            }
            // totals footer
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val t = vm.totals(s)
                val gross = vm.grossCents(s)
                val disc = gross - t.subtotalCents
                TotalLine("Subtotal", formatMUR(gross), TextSecondary)
                if (disc > 0) TotalLine("Line discounts", "−" + formatMUR(disc), Success)
                TotalLine("VAT 15%", formatMUR(t.vatCents), TextSecondary)
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.Bottom) {
                    Text("TOTAL", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp, color = TextPrimary)
                    Spacer(Modifier.weight(1f))
                    Text(formatMUR(t.totalCents), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Accent)
                }
                s.error?.let { Text(it, color = Danger, fontSize = 12.sp) }
                when {
                    // Already converted: a quote maps to exactly one job, so don't offer to make
                    // another — just open the one it produced.
                    s.jobId != null -> {
                        Box(Modifier.fillMaxWidth().height(52.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { vm.viewJob(); onViewJob() }, contentAlignment = Alignment.Center) {
                            Text("View job →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
                        }
                        Text("This quote has been accepted — JOB-${s.jobId.take(4).uppercase()} is on the board.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                    }
                    !s.acceptOpen -> {
                        Row(Modifier.padding(top = 7.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            OutlineBtn(if (s.busy) "Saving…" else if (s.savedRef != null) "Saved ✓" else "Save draft", Modifier.weight(1f), 52) { if (!s.busy) vm.saveDraft() }
                            Box(Modifier.weight(1.6f).height(52.dp).background(if (s.lines.isNotEmpty()) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = s.lines.isNotEmpty()) { vm.openAccept() }, contentAlignment = Alignment.Center) {
                                Text("Accept → create job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (s.lines.isNotEmpty()) AccentInk else TextMuted)
                            }
                        }
                        Box(Modifier.fillMaxWidth().height(38.dp).clickable(enabled = s.lines.isNotEmpty() && !s.busy) { vm.convertToInvoice() }, contentAlignment = Alignment.Center) {
                            Text(if (s.busy) "Working…" else "Bill now — create invoice", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (s.lines.isNotEmpty()) Accent else TextMuted)
                        }
                    }
                    else -> AcceptPanel(s, vm)
                }
            }
        }
    }
}

@Composable
private fun AcceptPanel(s: QuoteState, vm: QuoteViewModel) {
    Column(Modifier.padding(top = 7.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MiniLabel("ASSIGN TECHNICIAN")
        if (s.technicians.isEmpty()) Text("No active technicians — assign later from the job.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        Row(Modifier.fillMaxWidth().horizontalScrollRow(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            s.technicians.forEach { u ->
                val on = u.id == s.techId
                Row(Modifier.height(42.dp).background(if (on) AccentSoft else Color(0xFFF6F8FA), RoundedCornerShape(21.dp)).border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(21.dp)).clickable { vm.pickTech(u.id) }.padding(start = 6.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(30.dp).background(Accent, CircleShape), contentAlignment = Alignment.Center) { Text(u.displayName.take(1).uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = AccentInk) }
                    Text(u.displayName.replace(Regex("\\s*\\(.*\\)$"), ""), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary)
                }
            }
        }
        MiniLabel("START")
        Row(Modifier.fillMaxWidth().horizontalScrollRow(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            QUOTE_TIMES.forEach { tm ->
                val on = tm == s.time
                Box(Modifier.height(38.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(19.dp)).border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(19.dp)).clickable { vm.pickTime(tm) }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text(tm, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (on) Accent else TextPrimary)
                }
            }
        }
        Row(Modifier.padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            OutlineBtn("Back", Modifier.weight(1f), 52) { if (!s.busy) vm.closeAccept() }
            Box(Modifier.weight(1.6f).height(52.dp).background(if (s.busy) InsetAlt else Accent, RoundedCornerShape(13.dp)).clickable(enabled = !s.busy) { vm.create() }, contentAlignment = Alignment.Center) {
                Text(if (s.busy) "Creating…" else "Create job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (s.busy) TextMuted else AccentInk)
            }
        }
    }
}

// ── shared bits (local to quote) ──────────────────────────────────────────────
@Composable private fun TotalLine(label: String, value: String, color: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = color)
        Spacer(Modifier.weight(1f))
        Text(value, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = color)
    }
}
@Composable private fun MiniLabel(t: String) = Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.4.sp, color = TextMuted)
@Composable private fun StepBtn(t: String, onClick: () -> Unit) = Box(Modifier.size(40.dp).background(InsetAlt, RoundedCornerShape(10.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) { Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary) }
@Composable private fun OutlineBtn(text: String, modifier: Modifier = Modifier, h: Int = 44, onClick: () -> Unit) = Box(modifier.height(h.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(if (h >= 50) 13.dp else 12.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
@Composable private fun FillBtn(text: String, modifier: Modifier = Modifier, h: Int = 46, onClick: () -> Unit) = Box(modifier.height(h.dp).background(Accent, RoundedCornerShape(13.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk) }

@Composable private fun StatusChip(status: String) {
    val (bg, fg, label) = when (status.lowercase()) {
        "accepted" -> Triple(Color(0x261FA361), Success, "ACCEPTED")
        "issued" -> Triple(AccentSoft, Accent, "SENT")
        "declined", "expired" -> Triple(Color(0x1FD63A3A), Danger, status.uppercase())
        else -> Triple(InsetAlt, TextSecondary, "DRAFT")
    }
    Box(Modifier.height(24.dp).background(bg, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.5.sp, color = fg)
    }
}

@Composable private fun Modifier.horizontalScrollRow(): Modifier = this.horizontalScroll(rememberScrollState())
