package mu.carfection.pos.feature.quote

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.KindFilter
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.ui.FlowState
import mu.carfection.pos.ui.FlowStepUi
import mu.carfection.pos.ui.FlowStrip
import mu.carfection.pos.ui.withCurrent
import mu.carfection.pos.ui.FilledInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.window.Dialog
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.grossCents
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
fun QuoteScreen(onGoIntake: () -> Unit, onViewJob: () -> Unit, onGoCheckout: () -> Unit, viewModel: QuoteViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(s.mode) { if (s.mode == QuoteMode.LIST) viewModel.loadQuotes() } // refresh list on entry / when returning from builder
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (s.mode == QuoteMode.LIST) QuoteList(s, viewModel, onGoIntake) else QuoteBuilder(s, viewModel, onViewJob, onGoCheckout)
    }
    // A deposit was agreed → after signing, go STRAIGHT to Checkout to collect it: the
    // CollectBus request is already latched, so the pad opens on the deposit figure. Leaving
    // the operator on the quote (or making them find a button) is the illogical flow the owner
    // hit. The signed quotation can still be sent later from the quote list.
    LaunchedEffect(s.createdJobId, s.depositPending) {
        if (s.createdJobId != null && s.depositPending) { viewModel.clearToast(); onGoCheckout() }
    }
    // Shown right after accepting (createdJobId) AND on demand for any saved quote (sendOpen),
    // so a lost WhatsApp or an "email it too" does not require re-accepting the quote.
    if (!s.depositPending && (s.createdJobId != null || s.sendOpen)) run {
        val jobId = s.createdJobId
        // Accepted, no deposit → offer to send the signed quotation PDF right away (the server
        // renders + delivers it; WhatsApp needs the Meta connection, email the
        // Cloudflare enable — both fail with a clear message until then).
        var email by remember(s.customerEmail) { mutableStateOf(s.customerEmail ?: "") }
        var phone by remember(s.customerPhone) { mutableStateOf(s.customerPhone ?: "") }
        var note by remember { mutableStateOf(SEND_NOTE_PRESETS.first().second) }
        Dialog(onDismissRequest = { viewModel.clearToast(); if (jobId != null) viewModel.back() else viewModel.closeSend() }) {
            Column(Modifier.width(470.dp).card().padding(26.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (jobId != null) "Quote accepted" else "Send quotation", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                Text(
                    if (jobId != null) "JOB-${jobId.take(4).uppercase()} created. Send the signed quotation to the customer:"
                    else "Send ${s.ref} to the customer — again if they have already had it:",
                    fontFamily = Barlow, fontSize = 13.sp, color = TextSecondary,
                )

                MiniLabel("MESSAGE")
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    SEND_NOTE_PRESETS.forEach { (label, text) ->
                        val on = note == text
                        Box(
                            Modifier.height(30.dp).background(if (on) Accent else Inset, RoundedCornerShape(9.dp)).clickable { note = text }.padding(horizontal = 11.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = if (on) AccentInk else TextSecondary) }
                    }
                }
                FilledInput(value = note, onValueChange = { note = it.take(300) }, placeholder = "Message to the customer…", modifier = Modifier.fillMaxWidth(), bg = Inset)

                MiniLabel("EMAIL")
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledInput(value = email, onValueChange = { email = it }, placeholder = "customer@email.com", modifier = Modifier.weight(1f), bg = Inset)
                    FillBtn(if (s.sendBusy) "…" else "Send", Modifier.width(96.dp), 48) { if (!s.sendBusy && email.isNotBlank()) viewModel.sendToCustomer("email", email, note) }
                }
                MiniLabel("WHATSAPP")
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledInput(value = phone, onValueChange = { phone = it }, placeholder = "+230 5XXX XXXX", modifier = Modifier.weight(1f), bg = Inset)
                    Box(Modifier.width(96.dp).height(48.dp).background(Color(0xFF25D366), RoundedCornerShape(13.dp)).clickable(enabled = !s.sendBusy && phone.isNotBlank()) { viewModel.sendToCustomer("whatsapp", phone, note) }, contentAlignment = Alignment.Center) {
                        Text(if (s.sendBusy) "…" else "Send", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Color(0xFF06231A))
                    }
                }

                s.sendDone?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Color(0xFF12A150)) }
                s.sendError?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = Color(0xFFD63B50)) }

                OutlineBtn("Done", Modifier.fillMaxWidth(), 48) { viewModel.clearToast(); viewModel.back() }
            }
        }
    }
    s.createdInvoiceRef?.let {
        // Dismiss = leave the builder (parity with the accept dialog) - staying on a
        // just-billed quote left Accept/Bill both tappable again.
        Dialog(onDismissRequest = { viewModel.clearToast(); viewModel.back() }) {
            Column(Modifier.width(380.dp).card().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Invoice issued", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                Text("$it — collect it in Checkout.", fontFamily = Barlow, fontSize = 13.sp, color = TextSecondary)
                FillBtn("Done", Modifier.fillMaxWidth()) { viewModel.clearToast(); viewModel.back() }
            }
        }
    }
    if (s.adhocOpen) AdhocDialog(viewModel, s.pricesInclVat)
    if (s.pickerOpen) QuoteCustomerPicker(s, viewModel)
    if (s.confirmDelete) DiscardDraftDialog(s, viewModel)
    if (s.datePickerOpen) StartDatePicker(s, viewModel)
    if (s.timePickerOpen) StartTimePicker(s, viewModel)
}

@Composable
private fun AdhocDialog(vm: QuoteViewModel, inclVat: Boolean) {
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    val cents = parseMoneyToCents(price)
    Dialog(onDismissRequest = vm::closeAdhoc) {
        Column(Modifier.width(440.dp).card().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Ad-hoc line", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
            Text("A one-off service or product, priced by hand.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
            MiniLabel("DESCRIPTION")
            FilledInput(value = name, onValueChange = { name = it }, placeholder = "e.g. Headlight restoration", modifier = Modifier.fillMaxWidth(), bg = Inset)
            MiniLabel(if (inclVat) "UNIT PRICE (Rs, incl. VAT)" else "UNIT PRICE (Rs, excl. VAT)")
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
    val shown = vm.filteredQuotes(s)
    val retired = vm.retiredCount(s)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        FilledInput(
            value = s.listQuery, onValueChange = vm::setListQuery,
            placeholder = "Search a quote — customer, plate or number…",
            modifier = Modifier.weight(1f), height = 44.dp, bg = CardBg, leadingSearch = true,
        )
        if (s.listQuery.isBlank() && retired > 0) {
            Text(
                "$retired delivered — search to find them",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted,
            )
        }
        // Quotes no longer have to start at reception: plenty are raised over the phone, or
        // for a customer who is not leaving the car today.
        Box(
            Modifier.height(44.dp).background(Accent, RoundedCornerShape(12.dp))
                .clickable { vm.newQuote() }.padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center,
        ) { Text("+ New quote", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = AccentInk) }
    }
    if (s.loading) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = TextMuted) }
    } else if (s.error != null && s.quotes.isEmpty()) {
        // A failed load must never read as "no quotes" — that's how a broken list hides.
        Column(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Spacer(Modifier.weight(1f))
            Text("Couldn’t load the quotes.", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Danger)
            Text(s.error, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
            OutlineBtn("Try again", h = 44) { vm.loadQuotes() }
            Spacer(Modifier.weight(1f))
        }
    } else if (shown.isEmpty()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text(
                if (s.listQuery.isNotBlank()) "No quote matches “${s.listQuery}”."
                else if (s.quotes.isNotEmpty()) "Every quote is delivered — search to find one."
                else "No quotes yet — start one from Intake, or tap New quote.",
                color = TextMuted, fontFamily = Barlow, fontSize = 14.sp,
            )
        }
    } else {
        LazyVerticalGrid(columns = GridCells.Fixed(3), horizontalArrangement = Arrangement.spacedBy(11.dp), verticalArrangement = Arrangement.spacedBy(11.dp), modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(shown, key = { it.id }) { q ->
                Column(Modifier.card(15).clickable { vm.openQuote(q) }.padding(horizontal = 15.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(q.number ?: "Draft", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextSecondary)
                        Spacer(Modifier.weight(1f))
                        StatusChip(q.status)
                        if (q.invoices.any { it.docType == "invoice" && it.status != "void" }) StatusChip("billed")
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
private fun ColumnScope.QuoteBuilder(s: QuoteState, vm: QuoteViewModel, onViewJob: () -> Unit, onGoCheckout: () -> Unit) {
    // The client's signature strokes, in pad-local pixels. Hoisted to the builder because the
    // pad lives in the middle of the card and the "Create job" button is pinned to its foot —
    // they have to share it. Cleared whenever the accept panel opens or the quote changes, so
    // one client's signature can never be submitted for the next.
    val strokes = remember(s.quoteId, s.acceptOpen) { mutableStateListOf<List<Offset>>() }
    var padSize by remember { mutableStateOf(IntSize.Zero) }
    val strokePx = with(LocalDensity.current) { 4.dp.toPx() }
    val signed = strokes.any { it.size > 1 }
    // Accepting is two steps on the tablet: step 0 sets up the job (technician, booking,
    // estimate, deposit); step 1 is the signature alone, given the whole panel so a finger
    // has room. Reset whenever the panel opens or the quote changes.
    var acceptStep by remember(s.quoteId, s.acceptOpen) { mutableStateOf(0) }

    // header
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(12.dp)).clickable { vm.back() }, contentAlignment = Alignment.Center) { Text("←", fontFamily = Barlow, fontSize = 18.sp, color = TextSecondary) }
        Text(s.ref.uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
        StatusChip(s.status)
        // Re-send: reachable for any SAVED quote, not only in the moment after accepting.
        if (s.quoteId != null) {
            Box(
                Modifier.height(34.dp).background(AccentSoft, RoundedCornerShape(10.dp))
                    .border(1.dp, AccentLine, RoundedCornerShape(10.dp))
                    .clickable { vm.openSend() }.padding(horizontal = 13.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Send", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Accent) }
        }
        Spacer(Modifier.weight(1f))
        Text(s.who, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextSecondary)
        s.vehPlate?.let { Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) { Text(it, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Color(0xFF151208)) } }
        if (s.veh.isNotBlank()) Text(s.veh, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted)
        // Only while it is a DRAFT. Once a quote is issued it is a document the customer has
        // been shown, so neither who it is for nor its existence is ours to change quietly.
        if (s.status == "draft") {
            Box(
                Modifier.height(38.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(11.dp))
                    .clickable { vm.changeCustomer() }.padding(horizontal = 13.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Change customer", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary) }
            Box(
                Modifier.height(38.dp).border(1.dp, Color(0x33D63B50), RoundedCornerShape(11.dp))
                    .clickable { vm.askDelete() }.padding(horizontal = 13.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Discard", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Danger) }
        }
    }

    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // LEFT 53 — category rail + search + product grid (the same catalogue Checkout browses,
        // so it gets the same rail: 795 products under 40-odd categories are not browsable as chips)
        // A quote the customer has already been shown — or signed — is not a shopping
        // screen. Showing 795 tappable products that silently do nothing is worse than
        // showing none, so the picker gives way to the one thing left to do: revise it.
        if (!vm.editable(s)) LockedQuotePanel(s, vm) else {
        CategoryRail(s, vm)
        Column(Modifier.weight(53f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // The ad-hoc tile lives at the end of the grid — past hundreds of products, so it
            // may as well not exist. This button is the way in: a typed one-off line, always
            // one tap away.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                FilledInput(
                    value = s.query, onValueChange = vm::setQuery,
                    placeholder = "Search products or scan a barcode…",
                    modifier = Modifier.weight(1f), height = 44.dp, bg = CardBg, leadingSearch = true,
                )
                Box(
                    Modifier.height(44.dp).background(AccentSoft, RoundedCornerShape(12.dp))
                        .border(1.5.dp, AccentLine, RoundedCornerShape(12.dp))
                        .clickable { vm.openAdhoc() }.padding(horizontal = 15.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+ Ad-hoc line", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Accent)
                }
            }
            LazyVerticalGrid(columns = GridCells.Fixed(2), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.fillMaxSize()) {
                items(vm.filteredProducts(s), key = { it.id }) { p ->
                    val count = s.lines.firstOrNull { it.productId == p.id }?.qty
                    Box(Modifier.height(96.dp).background(Tile, RoundedCornerShape(13.dp)).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { vm.addProduct(p) }.padding(horizontal = 13.dp, vertical = 10.dp)) {
                        // fillMaxHeight so the weight actually distributes — without it a 2-line
                        // name overflowed the tile and clipped the price off the bottom.
                        Column(Modifier.fillMaxHeight()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                                // Reference photo, in-flow like the counter's tile — costs space
                                // only on the products that actually have one.
                                p.photoUrl?.let { url ->
                                    coil.compose.AsyncImage(
                                        model = url, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                                        modifier = Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)),
                                    )
                                }
                                Text(p.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, lineHeight = 18.sp, color = TextPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 20.dp).weight(1f))
                            }
                            Spacer(Modifier.weight(1f))
                            Text(formatMUR(if (s.pricesInclVat) grossCents(p.sellingPriceCents, p.vatRatePct) else p.sellingPriceCents), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextSecondary)
                        }
                        if (count != null) Box(Modifier.align(Alignment.TopEnd).size(23.dp).background(Accent, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { Text(count.toString(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = AccentInk) }
                    }
                }
                item {
                    Column(Modifier.height(96.dp).fillMaxWidth().dashedBorder(Color(0x40101A24), 13.dp).clickable { vm.openAdhoc() }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text("+", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = TextSecondary)
                        Spacer(Modifier.height(6.dp))
                        Text("Ad-hoc line — typed", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, letterSpacing = 0.4.sp, color = TextSecondary)
                    }
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
            // Accepting takes over this middle region rather than growing the footer — that is
            // what used to push the buttons off the bottom of the screen. The signature pad then
            // sizes itself to whatever room is left, so it can never be clipped either.
            if (s.acceptOpen) {
                AcceptBody(s, vm, strokes, { padSize = it }, strokePx, acceptStep, Modifier.weight(1f))
            } else
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                if (s.lines.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("No lines yet", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextMuted)
                        Text("Tap services and products on the left", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                    }
                }
                s.lines.forEachIndexed { i, l ->
                    // The line at shelf price when the shop quotes gross (its own VAT rate).
                    val lineTotal = (vm.totals(s).lineExclCents.getOrNull(i) ?: 0L)
                        .let { net -> if (s.pricesInclVat) grossCents(net, l.vatRate) else net }
                    val discNote = when {
                        l.discountMode == DiscountMode.PCT && l.discountPct > 0 -> "  ·  −${l.discountPct}%"
                        l.discountMode == DiscountMode.AMT && l.discountAmtCents > 0 -> "  ·  −${formatMUR(l.discountAmtCents)}"
                        else -> ""
                    }
                    Column(Modifier.fillMaxWidth().background(if (l.expanded) InsetAlt else Color(0xFFF1F4F7), RoundedCornerShape(12.dp)).border(1.dp, Color(0x12101A24), RoundedCornerShape(12.dp))) {
                        Row(Modifier.fillMaxWidth().clickable(enabled = vm.editable(s)) { vm.toggleLine(i) }.padding(horizontal = 13.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(l.title, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("×${l.qty}$discNote", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                            }
                            Text(formatMUR(lineTotal), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary)
                        }
                        if (l.expanded) Column(Modifier.fillMaxWidth().padding(start = 13.dp, end = 13.dp, bottom = 11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            // qty · unit price · remove
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StepBtn("−") { vm.setQty(i, l.qty - 1) }
                                Text(l.qty.toString(), Modifier.width(30.dp), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary, maxLines = 1)
                                StepBtn("+") { vm.setQty(i, l.qty + 1) }
                                Box(Modifier.width(1.dp).height(24.dp).background(Color(0x1F101A24)))
                                Text("Rs", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextMuted)
                                FilledInput(
                                    value = l.priceText, onValueChange = { vm.setPrice(i, it) },
                                    placeholder = "0.00", modifier = Modifier.weight(1f), height = 40.dp,
                                    radius = 10.dp, bg = CardBg, fontFamily = Mono, fontSize = 13.5.sp,
                                )
                                Box(Modifier.size(40.dp).background(Color(0x1FD63A3A), RoundedCornerShape(10.dp)).clickable { vm.removeLine(i) }, contentAlignment = Alignment.Center) { Text("✕", color = Danger, fontFamily = Barlow, fontSize = 15.sp) }
                            }
                            // discount: % presets or a typed Rs amount (VAT-inclusive, like the DB)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, lb) ->
                                    val on = l.discountMode == m
                                    Box(Modifier.height(34.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(9.dp)).border(1.dp, if (on) AccentLine else Color(0x17101A24), RoundedCornerShape(9.dp)).clickable { vm.setLineDiscMode(i, m) }.padding(horizontal = 11.dp), contentAlignment = Alignment.Center) {
                                        Text(lb, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = if (on) Accent else TextSecondary)
                                    }
                                }
                                Box(Modifier.width(1.dp).height(24.dp).background(Color(0x1F101A24)))
                                if (l.discountMode == DiscountMode.PCT) {
                                    listOf(0, 5, 10, 15, 20).forEach { d ->
                                        val on = l.discountPct == d
                                        Box(Modifier.height(34.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(9.dp)).border(1.dp, if (on) AccentLine else Color(0x17101A24), RoundedCornerShape(9.dp)).clickable { vm.setDiscount(i, d) }.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                                            Text(if (d == 0) "0%" else "$d%", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = if (on) Accent else TextSecondary)
                                        }
                                    }
                                    Spacer(Modifier.weight(1f))
                                } else {
                                    FilledInput(
                                        value = l.discountAmtText, onValueChange = { vm.setLineDiscAmt(i, it) },
                                        placeholder = "Rs off (incl. VAT)", modifier = Modifier.weight(1f), height = 40.dp,
                                        radius = 10.dp, bg = CardBg, fontFamily = Mono, fontSize = 13.5.sp,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            // totals footer
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val t = vm.totals(s)
                val gross = vm.grossCents(s)
                // Quoting gross: state the subtotal and the line discounts at shelf price too,
                // each line at its own VAT rate, so the column the customer reads adds up.
                // Grossed on the LINE total (qty × unit), not per unit then multiplied: rounding VAT
                // per unit and multiplying differs by a cent from rounding it once on the line, and
                // that cent surfaced as a phantom "Line discounts −Rs 0.01" row on any qty ≥ 2 quote
                // that had no discount at all. This also matches the row printed for each line.
                val subtotalShown = if (s.pricesInclVat) s.lines.sumOf { grossCents(it.qty * it.unitCents, it.vatRate) } else gross
                val afterLineDisc = s.lines.mapIndexed { i, l -> grossCents(t.lineExclCents.getOrElse(i) { 0L }, l.vatRate) }.sum()
                val lineDisc = if (s.pricesInclVat) subtotalShown - afterLineDisc else gross - t.lineExclCents.sum()
                TotalLine("Subtotal", formatMUR(subtotalShown), TextSecondary)
                if (lineDisc > 0) TotalLine("Line discounts", "−" + formatMUR(lineDisc), Success)
                // basket (order-level) discount — % of the total, or Rs off (VAT-inclusive).
                // Once the quote has left draft this is only a figure to read: controls that
                // accept a tap and then quietly ignore it are worse than no controls at all.
                if (!vm.editable(s)) {
                    if (t.orderDiscountInclCents > 0) {
                        TotalLine("Basket discount", "−" + formatMUR(t.orderDiscountInclCents), Success)
                    }
                } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("Basket discount", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary)
                    listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, lb) ->
                        val on = s.basketMode == m
                        Box(Modifier.height(30.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(8.dp)).border(1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(8.dp)).clickable { vm.setBasketMode(m) }.padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                            Text(lb, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, color = if (on) Accent else TextSecondary)
                        }
                    }
                    FilledInput(
                        value = s.basketText, onValueChange = vm::setBasketText,
                        placeholder = "0", modifier = Modifier.width(90.dp), height = 30.dp,
                        radius = 8.dp, bg = InsetAlt, fontFamily = Mono, fontSize = 12.5.sp,
                    )
                    Spacer(Modifier.weight(1f))
                    if (t.orderDiscountInclCents > 0) Text("−" + formatMUR(t.orderDiscountInclCents), fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = Success)
                }
                TotalLine(if (s.pricesInclVat) "of which VAT 15%" else "VAT 15%", formatMUR(t.vatCents), TextSecondary)
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.Bottom) {
                    Text("TOTAL", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp, color = TextPrimary)
                    Spacer(Modifier.weight(1f))
                    Text(formatMUR(t.totalCents), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Accent)
                }
                // The car's journey — same five steps as the back office. Hidden while the
                // client is signing: it is decorative at that moment, and the ~90dp it eats
                // is the difference between a cramped signature strip and a real pad.
                if (!s.acceptOpen) FlowStrip(
                    listOf(
                        FlowStepUi("Intake", if (s.hasIntake) FlowState.DONE else FlowState.TODO, if (s.hasIntake) "recorded" else "walk-in"),
                        FlowStepUi("Quote", FlowState.DONE, s.ref),
                        FlowStepUi(
                            "Signed",
                            when {
                                s.status == "declined" -> FlowState.DECLINED
                                s.signed || s.status == "accepted" || s.jobId != null -> FlowState.DONE
                                else -> FlowState.TODO
                            },
                            if (s.signed) "client signed" else if (s.jobId != null) "accepted" else null,
                        ),
                        FlowStepUi("Job", if (s.jobId != null) FlowState.DONE else FlowState.TODO, s.jobId?.let { "on the board" }),
                        FlowStepUi("Invoice", if (s.createdInvoiceRef != null || s.billed) FlowState.DONE else FlowState.TODO, s.createdInvoiceRef ?: if (s.billed) "issued" else null),
                    ).withCurrent(),
                )
                s.error?.let { Text(it, color = Danger, fontSize = 12.sp) }
                when {
                    // Already converted: a quote maps to exactly one job, so don't offer to make
                    // another — just open the one it produced.
                    s.jobId != null -> {
                        // The customer is standing there with their wallet out — take them to the
                        // money before anything else. The pad is already waiting on their bill.
                        if (s.depositPending) {
                            Box(Modifier.fillMaxWidth().height(52.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { onGoCheckout() }, contentAlignment = Alignment.Center) {
                                Text("Collect the deposit →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
                            }
                            Text(
                                "The bill is waiting in Checkout with ${formatMUR(s.depositCents)} dialled in. Nothing has been taken yet.",
                                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, lineHeight = 15.sp, color = TextMuted,
                            )
                            Box(Modifier.fillMaxWidth().height(46.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.viewJob(); onViewJob() }, contentAlignment = Alignment.Center) {
                                Text("View job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent)
                            }
                        } else {
                            Box(Modifier.fillMaxWidth().height(52.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { vm.viewJob(); onViewJob() }, contentAlignment = Alignment.Center) {
                                Text("View job →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
                            }
                            Text("This quote has been accepted — JOB-${s.jobId.take(4).uppercase()} is on the board.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                        }
                    }
                    // Signed, but the work never started — the customer took the price away
                    // and has now come back. Raise the job from the quote they actually signed,
                    // rather than re-keying it as a new one.
                    s.status == "accepted" && s.jobId == null -> {
                        Box(
                            Modifier.fillMaxWidth().height(52.dp)
                                .background(if (s.busy) InsetAlt else Accent, RoundedCornerShape(13.dp))
                                .clickable(enabled = !s.busy) { vm.createJobFromQuote() },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (s.busy) "Creating…" else "Create job →",
                                fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                color = if (s.busy) TextMuted else AccentInk,
                            )
                        }
                        Text(
                            "Signed and agreed. Put the car on the board whenever they bring it in.",
                            fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted,
                        )
                        // …and if they never do. Voided, not erased: the quote has a number and
                        // a signature, so what was agreed stays on the record.
                        Box(
                            Modifier.fillMaxWidth().height(44.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                                .clickable(enabled = !s.busy) { vm.askDelete() },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("Customer never came back", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = Danger)
                        }
                    }
                    s.billed -> {
                        Box(Modifier.fillMaxWidth().height(52.dp).background(InsetAlt, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                            Text("Billed — collect it in Checkout", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextSecondary)
                        }
                        Text("This quote already has an invoice — accepting or re-billing it here is disabled.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                    }
                    !s.acceptOpen -> {
                        Row(Modifier.padding(top = 7.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            OutlineBtn(if (s.busy) "Saving…" else if (s.savedRef != null) "Saved ✓" else "Save draft", Modifier.weight(1f), 52) { if (!s.busy) vm.saveDraft() }
                            Box(Modifier.weight(1.6f).height(52.dp).background(if (s.lines.isNotEmpty()) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = s.lines.isNotEmpty()) { vm.openAccept() }, contentAlignment = Alignment.Center) {
                                Text(if (s.startJobNow) "Accept → create job" else "Accept — save for later", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (s.lines.isNotEmpty()) AccentInk else TextMuted)
                            }
                        }
                        Box(Modifier.fillMaxWidth().height(38.dp).clickable(enabled = s.lines.isNotEmpty() && !s.busy) { vm.convertToInvoice() }, contentAlignment = Alignment.Center) {
                            Text(if (s.busy) "Working…" else "Bill now — create invoice", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (s.lines.isNotEmpty()) Accent else TextMuted)
                        }
                    }
                    // Pinned to the foot of the card. Step 0 sets up the job and hands off to the
                    // signature; step 1 is the signing itself. Back on step 1 returns to setup,
                    // not out of the whole flow — the setup is easy to lose by accident otherwise.
                    else -> Row(Modifier.padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        if (acceptStep == 0) {
                            OutlineBtn("Back", Modifier.weight(1f), 52) { if (!s.busy) vm.closeAccept() }
                            Box(
                                Modifier.weight(1.6f).height(52.dp)
                                    .background(if (s.busy) InsetAlt else Accent, RoundedCornerShape(13.dp))
                                    .clickable(enabled = !s.busy) { acceptStep = 1 },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "Continue to signature →",
                                    fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                    color = if (s.busy) TextMuted else AccentInk,
                                )
                            }
                        } else {
                            OutlineBtn("Back", Modifier.weight(1f), 52) { if (!s.busy) acceptStep = 0 }
                            Box(
                                Modifier.weight(1.6f).height(52.dp)
                                    .background(if (s.busy || !signed) InsetAlt else Accent, RoundedCornerShape(13.dp))
                                    .clickable(enabled = !s.busy && signed) {
                                        vm.create(strokesToPng(strokes.toList(), padSize.width, padSize.height, strokePx))
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (s.busy) "Creating…" else if (!signed) "Sign to create job" else "Create job",
                                    fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                    color = if (s.busy || !signed) TextMuted else AccentInk,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Everything the client has to see before they sign: who will do the work, when the car is
 * booked in, and the pad itself. It OWNS the middle of the card ([modifier] carries a
 * weight), so the pad grows into whatever room is left and the buttons below it stay put.
 */
@Composable
private fun AcceptBody(
    s: QuoteState,
    vm: QuoteViewModel,
    strokes: androidx.compose.runtime.snapshots.SnapshotStateList<List<Offset>>,
    onPadSize: (IntSize) -> Unit,
    strokePx: Float,
    step: Int,
    modifier: Modifier = Modifier,
) {
    val signed = strokes.any { it.size > 1 }
    if (step == 1) { SignStep(s, vm, strokes, onPadSize, strokePx, signed, modifier); return }
    Column(modifier.fillMaxWidth()) {
        // Step 0 — set up the job. Scrolls, so adding rows (Takes about, Deposit) can never
        // crowd the panel; signing is a screen of its own now, reached with "Continue".
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
        // The first decision, because it governs everything under it: is the car here?
        // A quote signed today for work booked next month must not put a card on the board.
        Row(
            Modifier.fillMaxWidth().height(58.dp)
                .background(if (s.startJobNow) AccentSoft else Color(0xFFF6F8FA), RoundedCornerShape(14.dp))
                .border(if (s.startJobNow) 1.5.dp else 1.dp, if (s.startJobNow) AccentLine else Hairline, RoundedCornerShape(14.dp))
                .clickable { vm.setStartJobNow(!s.startJobNow) }
                .padding(horizontal = 15.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Box(
                Modifier.size(26.dp)
                    .background(if (s.startJobNow) Accent else Color.Transparent, RoundedCornerShape(7.dp))
                    .border(2.dp, if (s.startJobNow) Accent else Hairline, RoundedCornerShape(7.dp)),
                contentAlignment = Alignment.Center,
            ) { if (s.startJobNow) Text("✓", color = AccentInk, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            Column(Modifier.weight(1f)) {
                Text("Start the work now", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary)
                Text(
                    if (s.startJobNow) "The car goes on the jobs board"
                    else "Signed only — open it and press Create job when they bring the car in",
                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted,
                )
            }
        }

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
        MiniLabel("BOOKED IN FOR")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
            val scheduled = s.startAt != null
            PickerChip("📅  " + vm.startDateLabel(s), scheduled, Modifier.weight(1f)) { vm.openDatePicker() }
            PickerChip("🕐  " + vm.startTimeLabel(s), scheduled, Modifier.weight(1f)) { vm.openTimePicker() }
            Box(
                Modifier.height(38.dp)
                    .background(if (scheduled) InsetAlt else AccentSoft, RoundedCornerShape(19.dp))
                    .border(if (scheduled) 1.dp else 1.5.dp, if (scheduled) Hairline else AccentLine, RoundedCornerShape(19.dp))
                    .clickable { vm.startNow() }.padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Now", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (scheduled) TextSecondary else Accent)
            }
        }

        // Captured here because this is the moment the work is agreed — and it is the only
        // thing that can answer "when will my car be ready?". Optional: an unestimated job
        // simply shows no ETA rather than a made-up one.
        MiniLabel("TAKES ABOUT")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            EstStepper("Days", vm.estimateDays(s), onMinus = { vm.bumpEstimateDays(s, -1) }, onPlus = { vm.bumpEstimateDays(s, +1) })
            EstStepper("Hours", vm.estimateHours(s), onMinus = { vm.bumpEstimateHours(s, -1) }, onPlus = { vm.bumpEstimateHours(s, +1) })
            Spacer(Modifier.weight(1f))
            if (s.estimateMinutes != null) {
                Text(QuoteViewModel.estimateLabel(s.estimateMinutes!!), fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Accent)
                Text("Clear", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextSecondary, modifier = Modifier.clickable { vm.pickEstimate(null) }.padding(start = 8.dp))
            }
        }

        // Money on signing. Raising the bill is what gives the deposit something to land in —
        // which also fixes the price, so the panel says so rather than letting the shop find
        // out when a revision is refused.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MiniLabel("DEPOSIT ON SIGNING")
            Spacer(Modifier.weight(1f))
            // % chips or a typed Rs amount — the shop asks for both.
            listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, lb) ->
                val on = s.depositMode == m
                Box(
                    Modifier.height(28.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(8.dp))
                        .border(1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(8.dp))
                        .clickable { vm.setDepositMode(m) }.padding(horizontal = 11.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(lb, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, color = if (on) Accent else TextSecondary) }
            }
        }
        if (s.depositMode == DiscountMode.PCT) {
            Row(Modifier.fillMaxWidth().horizontalScrollRow(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                val chosen = vm.depositPct(s)
                Box(
                    Modifier.height(38.dp)
                        .background(if (s.depositCents <= 0L) AccentSoft else Color(0xFFF6F8FA), RoundedCornerShape(19.dp))
                        .border(if (s.depositCents <= 0L) 1.5.dp else 1.dp, if (s.depositCents <= 0L) AccentLine else Hairline, RoundedCornerShape(19.dp))
                        .clickable { vm.pickDepositPct(null) }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("None", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (s.depositCents <= 0L) Accent else TextSecondary)
                }
                QuoteViewModel.DEPOSIT_CHOICES.forEach { pct ->
                    val on = chosen == pct
                    Box(
                        Modifier.height(38.dp)
                            .background(if (on) AccentSoft else Color(0xFFF6F8FA), RoundedCornerShape(19.dp))
                            .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(19.dp))
                            .clickable { vm.pickDepositPct(if (on) null else pct) }.padding(horizontal = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("$pct%", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (on) Accent else TextSecondary)
                    }
                }
                if (s.depositCents > 0) {
                    Spacer(Modifier.weight(1f))
                    Text(formatMUR(s.depositCents), fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Accent)
                }
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledInput(
                    value = s.depositAmtText, onValueChange = vm::setDepositAmtText,
                    placeholder = "Deposit amount (Rs)", modifier = Modifier.weight(1f), height = 40.dp,
                    radius = 12.dp, bg = InsetAlt, fontFamily = Mono, fontSize = 14.sp,
                )
                if (s.depositCents > 0) Text(formatMUR(s.depositCents), fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Accent)
            }
        }
        if (s.depositCents > 0) {
            Text(
                "The bill is raised now so the deposit has something to pay into — which fixes this price. " +
                    "Changing it later needs a credit note, not a revision.",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, lineHeight = 15.sp, color = TextMuted,
            )
        }
        } // ── end of the setup column ──
    }
}

/**
 * Step 1 of accepting — the signature, on a screen of its own. With nothing competing for the
 * panel the pad fills it, so there is real room to sign with a finger. A short recap sits above
 * so the client sees exactly what they're agreeing to before they put pen to glass.
 */
@Composable
private fun SignStep(
    s: QuoteState,
    vm: QuoteViewModel,
    strokes: androidx.compose.runtime.snapshots.SnapshotStateList<List<Offset>>,
    onPadSize: (IntSize) -> Unit,
    strokePx: Float,
    signed: Boolean,
    modifier: Modifier = Modifier,
) {
    val techName = s.technicians.firstOrNull { it.id == s.techId }?.displayName?.replace(Regex("\\s*\\(.*\\)$"), "")
    Column(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // A one-glance recap of the setup they're signing off on.
        Column(
            Modifier.fillMaxWidth().background(InsetAlt, RoundedCornerShape(12.dp)).padding(horizontal = 13.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            RecapRow("Technician", techName ?: "Assign later")
            RecapRow("Booked in", vm.startDateLabel(s) + " · " + vm.startTimeLabel(s))
            if (s.estimateMinutes != null) RecapRow("Ready in about", QuoteViewModel.estimateLabel(s.estimateMinutes!!))
            if (s.depositCents > 0) RecapRow("Deposit on signing", formatMUR(s.depositCents))
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            MiniLabel("CLIENT SIGNATURE")
            Spacer(Modifier.weight(1f))
            if (signed) Text("Clear", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = Accent, modifier = Modifier.clickable { strokes.clear() }.padding(horizontal = 4.dp))
        }
        // The pad takes all the room that's left, and CLIPS: a signature that runs past the edge
        // stops at the edge instead of being drawn across the card. Points are clamped to the
        // pad's bounds too, so the PNG that gets stored is exactly what the client saw.
        Box(
            Modifier.fillMaxWidth().weight(1f).heightIn(min = 200.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.White)
                .border(1.dp, Hairline, RoundedCornerShape(12.dp))
                .onSizeChanged(onPadSize)
                .pointerInput(Unit) {
                    fun clamp(p: Offset) = Offset(
                        p.x.coerceIn(0f, size.width.toFloat()),
                        p.y.coerceIn(0f, size.height.toFloat()),
                    )
                    detectDragGestures(
                        onDragStart = { pos -> strokes.add(listOf(clamp(pos))) },
                        onDrag = { change, _ ->
                            change.consume()
                            if (strokes.isNotEmpty()) strokes[strokes.lastIndex] = strokes.last() + clamp(change.position)
                        },
                    )
                },
        ) {
            if (!signed) Text(
                "Client signs here to accept this quotation",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted,
                modifier = Modifier.align(Alignment.Center),
            )
            Canvas(Modifier.fillMaxSize()) {
                strokes.forEach { pts ->
                    if (pts.size > 1) {
                        val path = androidx.compose.ui.graphics.Path().apply {
                            moveTo(pts[0].x, pts[0].y)
                            for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
                        }
                        drawPath(path, Color(0xFF101A24), style = Stroke(width = strokePx, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        }
    }
}

@Composable private fun RecapRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        Spacer(Modifier.weight(1f))
        Text(value, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Days / hours estimate stepper: [−] value [+] with a caption. Reuses the shared StepBtn. */
@Composable
private fun EstStepper(caption: String, value: Int, onMinus: () -> Unit, onPlus: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(caption, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 0.8.sp, color = TextMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            StepBtn("−") { onMinus() }
            Box(Modifier.width(46.dp).height(40.dp), contentAlignment = Alignment.Center) {
                Text(value.toString(), fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = TextPrimary)
            }
            StepBtn("+") { onPlus() }
        }
    }
}

/**
 * What stands where the product picker was, once a quote has left draft. It says plainly
 * that the quote is closed, why, and what to do instead — a screen that simply ignored
 * taps would leave the operator poking at products, wondering what was broken.
 */
@Composable
private fun RowScope.LockedQuotePanel(s: QuoteState, vm: QuoteViewModel) {
    val accepted = s.status == "accepted" || s.signed
    Column(
        Modifier.weight(53f).fillMaxHeight().card(14).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.weight(1f))
        Text(
            if (accepted) "This quote has been signed" else "This quote has been sent",
            fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = TextPrimary,
        )
        Text(
            if (accepted)
                "The customer agreed to these prices, so they stay exactly as they agreed them. " +
                    "To change anything, start a revision — a new quote carrying these lines, with this one kept as the record."
            else
                "The customer has been shown these prices. To change anything, start a revision — " +
                    "a new quote carrying these lines, with this one kept as the record.",
            fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 14.5.sp, lineHeight = 21.sp, color = TextMuted,
        )
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier.height(52.dp).background(if (s.busy) InsetAlt else Accent, RoundedCornerShape(13.dp))
                .clickable(enabled = !s.busy) { vm.reviseQuote() }
                .padding(horizontal = 26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (s.busy) "Working…" else "Revise this quote →",
                fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                color = if (s.busy) TextSecondary else AccentInk,
            )
        }
        Spacer(Modifier.weight(1f))
    }
}

/** The catalogue's categories, with their own search — lifted from Checkout so the two
 *  screens browse the same catalogue the same way. */
@Composable
private fun CategoryRail(s: QuoteState, vm: QuoteViewModel) {
    val counts = vm.catCounts(s)
    Column(Modifier.width(210.dp).fillMaxHeight().card(14)) {
        // Products / Services toggle (mirrors the web builder). A detailing quote usually
        // starts with the WORK, so services are one tap away, not buried in the categories.
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            KindFilter.entries.forEach { k ->
                val on = s.kindFilter == k
                Box(
                    Modifier.weight(1f).height(34.dp)
                        .background(if (on) Accent else InsetAlt, RoundedCornerShape(9.dp))
                        .clickable { vm.setKindFilter(k) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(k.label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp,
                        color = if (on) AccentInk else TextSecondary, maxLines = 1)
                }
            }
        }
        Row(Modifier.fillMaxWidth().height(32.dp).padding(start = 13.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("CATEGORIES", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp)
        }
        FilledInput(
            value = s.catQuery, onValueChange = vm::setCatQuery,
            placeholder = "Search…",
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
            height = 38.dp, bg = InsetAlt, fontSize = 13.sp, leadingSearch = true,
        )
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            items(vm.tabs(s), key = { it }) { c ->
                val on = c == s.tab
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 46.dp).height(IntrinsicSize.Min)
                        .background(if (on) AccentSoft else Color.Transparent)
                        .clickable { vm.setTab(c) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // selection is never colour alone
                    Box(Modifier.width(3.dp).fillMaxHeight().background(if (on) Accent else Color.Transparent))
                    Text(
                        c, color = if (on) Accent else TextPrimary, fontFamily = Barlow,
                        fontWeight = FontWeight.Bold, fontSize = 14.5.sp, lineHeight = 17.sp,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(start = 10.dp, top = 9.dp, bottom = 9.dp),
                    )
                    Text(
                        (counts[c] ?: 0).toString(), color = TextMuted, fontFamily = Mono, fontSize = 11.5.sp,
                        modifier = Modifier.padding(start = 5.dp, end = 10.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PickerChip(label: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) = Box(
    modifier.height(38.dp)
        .background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(19.dp))
        .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(19.dp))
        .clickable(onClick = onClick).padding(horizontal = 14.dp),
    contentAlignment = Alignment.Center,
) {
    Text(label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (on) Accent else TextPrimary, maxLines = 1)
}

/** Pick the day the car comes in. The Material picker speaks midnight-UTC millis. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StartDatePicker(s: QuoteState, vm: QuoteViewModel) {
    val st = rememberDatePickerState(initialSelectedDateMillis = s.startAt ?: System.currentTimeMillis())
    DatePickerDialog(
        onDismissRequest = vm::closePickers,
        confirmButton = {
            Text(
                "Set date", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent,
                modifier = Modifier.clickable { st.selectedDateMillis?.let { vm.pickDate(it) } ?: vm.closePickers() }.padding(14.dp),
            )
        },
        dismissButton = {
            Text(
                "Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary,
                modifier = Modifier.clickable { vm.closePickers() }.padding(14.dp),
            )
        },
    ) { DatePicker(state = st) }
}

/** Pick the hour the car comes in — the clock face, not a fixed list of slots. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StartTimePicker(s: QuoteState, vm: QuoteViewModel) {
    val now = java.time.LocalTime.now()
    val at = s.startAt?.let { java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalTime() } ?: now
    val st = rememberTimePickerState(initialHour = at.hour, initialMinute = at.minute, is24Hour = true)
    Dialog(onDismissRequest = vm::closePickers) {
        Column(Modifier.card().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Start time", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, color = TextPrimary)
            TimePicker(state = st)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                OutlineBtn("Cancel", Modifier.weight(1f), 48) { vm.closePickers() }
                FillBtn("Set time", Modifier.weight(1f), 48) { vm.pickTime(st.hour, st.minute) }
            }
        }
    }
}

/** Render the signature strokes to a white-background PNG at the pad's own pixel size. */
private fun strokesToPng(strokes: List<List<Offset>>, w: Int, h: Int, strokePx: Float): ByteArray {
    val bmp = android.graphics.Bitmap.createBitmap(w.coerceAtLeast(1), h.coerceAtLeast(1), android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bmp)
    canvas.drawColor(android.graphics.Color.WHITE)
    val paint = android.graphics.Paint().apply {
        color = android.graphics.Color.rgb(16, 26, 36)
        strokeWidth = strokePx
        style = android.graphics.Paint.Style.STROKE
        strokeCap = android.graphics.Paint.Cap.ROUND
        strokeJoin = android.graphics.Paint.Join.ROUND
        isAntiAlias = true
    }
    strokes.forEach { pts ->
        if (pts.size > 1) {
            val p = android.graphics.Path()
            p.moveTo(pts[0].x, pts[0].y)
            for (i in 1 until pts.size) p.lineTo(pts[i].x, pts[i].y)
            canvas.drawPath(p, paint)
        }
    }
    val out = java.io.ByteArrayOutputStream()
    bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
    bmp.recycle()
    return out.toByteArray()
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
        "billed" -> Triple(AccentSoft, Accent, "BILLED")
        "declined", "expired" -> Triple(Color(0x1FD63A3A), Danger, status.uppercase())
        else -> Triple(InsetAlt, TextSecondary, "DRAFT")
    }
    Box(Modifier.height(24.dp).background(bg, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.5.sp, color = fg)
    }
}

@Composable private fun Modifier.horizontalScrollRow(): Modifier = this.horizontalScroll(rememberScrollState())

// Message presets for the post-accept send dialog — pick one, then edit freely.
private val SEND_NOTE_PRESETS = listOf(
    "Thank you" to "Thank you for your business.",
    "As discussed" to "As discussed — please review and let us know if you have any questions.",
    "Reminder" to "A gentle reminder regarding this document. We remain at your service.",
)


/**
 * Who is this quote for? Shown when a quote is started from the list rather than from
 * reception, where intake has already established the customer and the car.
 *
 * The car is OPTIONAL: a price for "a full detail on a Hilux" is a real quote before anyone
 * has taken a registration, and forcing a vehicle here would push staff into inventing one
 * (which is how a job ended up against a car plated "NIL").
 */
@Composable
private fun QuoteCustomerPicker(s: QuoteState, vm: QuoteViewModel) {
    Dialog(onDismissRequest = { if (s.customerId != null) vm.closePicker() else vm.back() }) {
        Column(
            Modifier.width(560.dp).heightIn(max = 620.dp)
                .background(CardBg, RoundedCornerShape(18.dp)).border(1.dp, Hairline, RoundedCornerShape(18.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (s.customerId == null) "WHO IS THIS QUOTE FOR?" else "WHICH CAR?",
                fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.2.sp, color = TextPrimary,
            )

            if (s.customerId == null) {
                FilledInput(
                    value = s.pickQuery, onValueChange = vm::setPickQuery,
                    placeholder = "Search name, phone or plate…",
                    modifier = Modifier.fillMaxWidth(), height = 48.dp, bg = Inset, leadingSearch = true,
                )
                if (s.pickSearching) Text("Searching…", fontFamily = Barlow, fontSize = 12.sp, color = TextMuted)
                if (s.pickQuery.isNotBlank() && s.pickResults.isEmpty() && !s.pickSearching) {
                    Text(
                        "Nobody found.",
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted,
                    )
                }
                // Quoting over the phone is exactly when the customer is NOT on file yet, so
                // sending staff to Intake to create one and come back is the wrong answer.
                if (s.newCustOpen) {
                    Column(
                        Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp))
                            .border(1.dp, Hairline, RoundedCornerShape(12.dp)).padding(13.dp),
                        verticalArrangement = Arrangement.spacedBy(9.dp),
                    ) {
                        Text("NEW CUSTOMER", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp, color = TextMuted)
                        FilledInput(s.newCustName, vm::setNewCustName, "Full name", Modifier.fillMaxWidth(), height = 46.dp, bg = CardBg)
                        FilledInput(s.newCustPhone, vm::setNewCustPhone, "Phone — prefills the WhatsApp quote", Modifier.fillMaxWidth(), height = 46.dp, bg = CardBg)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(
                                Modifier.weight(1f).height(44.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp))
                                    .clickable { vm.toggleNewCust(false) },
                                contentAlignment = Alignment.Center,
                            ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextSecondary) }
                            val canSave = s.newCustName.isNotBlank() && !s.busy
                            Box(
                                Modifier.weight(1.4f).height(44.dp)
                                    .background(if (canSave) Accent else InsetAlt, RoundedCornerShape(11.dp))
                                    .clickable(enabled = canSave) { vm.saveNewCustomer() },
                                contentAlignment = Alignment.Center,
                            ) { Text(if (s.busy) "Saving…" else "Add customer", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = if (canSave) AccentInk else TextMuted) }
                        }
                        s.error?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = Danger) }
                    }
                } else {
                    Box(
                        Modifier.fillMaxWidth().height(46.dp).border(1.5.dp, AccentLine, RoundedCornerShape(12.dp))
                            .clickable { vm.toggleNewCust(true) },
                        contentAlignment = Alignment.Center,
                    ) { Text("+ New customer", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent) }
                }
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(s.pickResults, key = { it.id }) { c ->
                        Row(
                            Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(11.dp))
                                .border(1.dp, Hairline, RoundedCornerShape(11.dp))
                                .clickable { vm.pickQuoteCustomer(c) }.padding(horizontal = 13.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(c.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                // The phone is what tells two identical names apart. Four
                                // "Lucas Lutchmoodoo" records exist, two of them with no car,
                                // and picking the wrong one is how a job lands on the wrong record.
                                Text(c.phone ?: "no phone on file", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                            }
                        }
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text(s.who, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    // Back to the customer list — picking the wrong one of several same-named
                    // records should not mean cancelling out of the whole dialog.
                    Box(
                        Modifier.height(36.dp).border(1.dp, Hairline, RoundedCornerShape(10.dp))
                            .clickable { vm.clearPickedCustomer() }.padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Change", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextSecondary) }
                }
                if (s.pickVehicles.isEmpty() && !s.newVehOpen) {
                    Text(
                        "No car on this customer yet.",
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted,
                    )
                }
                // A customer created a moment ago has no car by definition, and a quote for a
                // car nobody has registered is how a placeholder plate gets invented.
                if (s.newVehOpen) {
                    Column(
                        Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp))
                            .border(1.dp, Hairline, RoundedCornerShape(12.dp)).padding(13.dp),
                        verticalArrangement = Arrangement.spacedBy(9.dp),
                    ) {
                        Text("NEW CAR", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp, color = TextMuted)
                        FilledInput(s.newVehPlate, vm::setNewVehPlate, "Plate — e.g. 2211 MR 23", Modifier.fillMaxWidth(), height = 46.dp, bg = CardBg)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledInput(s.newVehMake, vm::setNewVehMake, "Make", Modifier.weight(1f), height = 46.dp, bg = CardBg)
                            FilledInput(s.newVehModel, vm::setNewVehModel, "Model", Modifier.weight(1f), height = 46.dp, bg = CardBg)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(
                                Modifier.weight(1f).height(44.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp))
                                    .clickable { vm.toggleNewVeh(false) },
                                contentAlignment = Alignment.Center,
                            ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextSecondary) }
                            val canSave = s.newVehPlate.isNotBlank() && !s.busy
                            Box(
                                Modifier.weight(1.4f).height(44.dp)
                                    .background(if (canSave) Accent else InsetAlt, RoundedCornerShape(11.dp))
                                    .clickable(enabled = canSave) { vm.saveNewVehicle() },
                                contentAlignment = Alignment.Center,
                            ) { Text(if (s.busy) "Saving…" else "Add car", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = if (canSave) AccentInk else TextMuted) }
                        }
                        s.error?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = Danger) }
                    }
                } else {
                    Box(
                        Modifier.fillMaxWidth().height(46.dp).border(1.5.dp, AccentLine, RoundedCornerShape(12.dp))
                            .clickable { vm.toggleNewVeh(true) },
                        contentAlignment = Alignment.Center,
                    ) { Text("+ Add car", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent) }
                }
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(s.pickVehicles, key = { it.id }) { v ->
                        Row(
                            Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(11.dp))
                                .border(1.dp, Hairline, RoundedCornerShape(11.dp))
                                .clickable { vm.pickQuoteVehicle(v) }.padding(horizontal = 13.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 8.dp, vertical = 3.dp)) {
                                Text(v.plate, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Color(0xFF151208))
                            }
                            Spacer(Modifier.width(10.dp))
                            Text(
                                listOfNotNull(v.make, v.model, v.colour).joinToString(" "),
                                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = TextSecondary,
                            )
                        }
                    }
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(46.dp).dashedBorder(Color(0x40101A24), 11.dp)
                                .clickable { vm.pickQuoteVehicle(null) },
                            contentAlignment = Alignment.Center,
                        ) { Text("No car yet — quote anyway", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextSecondary) }
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(48.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp))
                        .clickable { if (s.customerId != null) vm.closePicker() else vm.back() },
                    contentAlignment = Alignment.Center,
                ) { Text(if (s.customerId != null) "Skip" else "Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
            }
        }
    }
}

/**
 * Discarding is destructive and irreversible, so it is never one tap — and it names what is
 * about to go, because "are you sure?" on its own tells nobody anything.
 */
@Composable
private fun DiscardDraftDialog(s: QuoteState, vm: QuoteViewModel) {
    Dialog(onDismissRequest = vm::cancelDelete) {
        Column(
            Modifier.width(460.dp).background(CardBg, RoundedCornerShape(18.dp))
                .border(1.dp, Hairline, RoundedCornerShape(18.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val isDraft = s.status == "draft"
            Text(
                if (isDraft) "DISCARD THIS DRAFT?" else "CUSTOMER NEVER CAME BACK?",
                fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp, color = TextPrimary,
            )
            Text(
                buildString {
                    if (isDraft) {
                        append("The draft for ")
                        append(s.who.ifBlank { "this customer" })
                        s.vehPlate?.let { append(" ($it)") }
                        append(" and its ")
                        append(s.lines.size)
                        append(if (s.lines.size == 1) " line" else " lines")
                        append(" will be deleted. This cannot be undone.")
                    } else {
                        // Not "deleted": it was signed, so what was agreed stays on the record.
                        append(s.ref)
                        append(" for ")
                        append(s.who.ifBlank { "this customer" })
                        s.vehPlate?.let { append(" ($it)") }
                        append(" will be marked void and drop off the quotes list. ")
                        append("It stays on the record as what was agreed, and no job is created.")
                    }
                },
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, lineHeight = 18.sp, color = TextSecondary,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { vm.cancelDelete() },
                    contentAlignment = Alignment.Center,
                ) { Text("Keep it", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                Box(
                    Modifier.weight(1.2f).height(50.dp).background(Danger, RoundedCornerShape(13.dp))
                        .clickable(enabled = !s.busy) { if (isDraft) vm.deleteDraft() else vm.voidThisQuote() },
                    contentAlignment = Alignment.Center,
                ) { Text(if (s.busy) "Working…" else if (isDraft) "Discard" else "Mark void", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Color.White) }
            }
        }
    }
}
