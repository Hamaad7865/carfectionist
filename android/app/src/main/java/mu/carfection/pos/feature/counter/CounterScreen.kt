package mu.carfection.pos.feature.counter

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.R
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import androidx.compose.ui.platform.LocalConfiguration
import mu.carfection.pos.ui.COMPACT_BREAKPOINT_DP
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.Plate
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Tile
import mu.carfection.pos.ui.theme.Warning

@Composable
fun CounterScreen(
    onOpenTill: () -> Unit,
    viewModel: CounterViewModel = hiltViewModel(),
) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadLists() } // refresh outstanding/paid on entry
    LaunchedEffect(Unit) { viewModel.refreshTill() } // the till may have just been opened
    // The small drawer-tablet: start with the category rail tucked away — the grid and
    // the cart need the width more than the rail does. The « toggle still brings it back.
    val compactScreen = LocalConfiguration.current.screenWidthDp < COMPACT_BREAKPOINT_DP
    LaunchedEffect(Unit) { if (compactScreen && viewModel.state.value.railOpen) viewModel.toggleRail() }

    Column(Modifier.fillMaxSize().background(ScreenBg).padding(14.dp)) {
        // ── top bar (handoff: constant CHECKOUT title, caption swaps by mode) ─
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("CHECKOUT", color = TextPrimary, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
            Spacer(Modifier.width(12.dp))
            Text(
                if (s.mode == CheckoutMode.WALKIN) "Counter sale — add products, then record payment" else "Collect payment — job invoices & counter sales",
                color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp,
            )
            Spacer(Modifier.width(16.dp))
            val till = s.till
            Chip(
                text = if (till != null) "Till open · float ${formatMUR(mu.carfection.pos.core.money.rupeesToCents(till.openingFloat))}" else "Till closed — open it",
                color = if (till != null) Success else Warning,
                onClick = onOpenTill,
            )
        }
        Spacer(Modifier.height(12.dp))

        if (s.mode == CheckoutMode.LIST) CollectList(s, viewModel)
        else Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // ── vertical category rail (collapsible; scrolls independently) ──────
            // Wider + bolder than the designer's 190dp/12.5sp: the owner reads this rail
            // at arm's length across a counter, and the collapsible nav rail bought the
            // width back (Cashmag's list is the legibility benchmark here).
            if (s.railOpen) Column(
                Modifier.width(225.dp).fillMaxHeight()
                    .background(CardBg, RoundedCornerShape(14.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(14.dp)),
            ) {
                Row(
                    Modifier.fillMaxWidth().height(40.dp).clickable { viewModel.toggleRail() }.padding(start = 13.dp, end = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("CATEGORIES", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, modifier = Modifier.weight(1f))
                    Text("«", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                }
                FilledInput(
                    value = s.catQuery, onValueChange = viewModel::setCatQuery,
                    placeholder = "Search…",
                    modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    height = 38.dp, bg = InsetAlt, fontSize = 13.sp, leadingSearch = true,
                )
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    items(s.categories, key = { it }) { c ->
                        val on = c == s.tab
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 46.dp).height(IntrinsicSize.Min)
                                .background(if (on) AccentSoft else Color.Transparent)
                                .clickable { viewModel.setTab(c) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // active indicator — selection is never colour alone
                            Box(Modifier.width(3.dp).fillMaxHeight().background(if (on) Accent else Color.Transparent))
                            Text(
                                c, color = if (on) Accent else TextPrimary, fontFamily = Barlow,
                                fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 18.sp,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f).padding(start = 11.dp, top = 10.dp, bottom = 10.dp),
                            )
                            Text(
                                (s.catCounts[c] ?: 0).toString(), color = TextMuted, fontFamily = Mono, fontSize = 12.sp,
                                modifier = Modifier.padding(start = 6.dp, end = 11.dp),
                            )
                        }
                    }
                }
            }
            else Column(
                // collapsed: a slim strip — chevron to reopen + a dot when a filter is active
                Modifier.width(40.dp).fillMaxHeight()
                    .background(CardBg, RoundedCornerShape(14.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(14.dp))
                    .clickable { viewModel.toggleRail() },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("»", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.padding(top = 11.dp))
                if (s.tab != "All") Box(Modifier.padding(top = 10.dp).size(8.dp).background(Accent, CircleShape))
            }

            // ── products: search + ad-hoc + grid + cancel ────────────────────────
            Column(Modifier.weight(42f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledInput(
                        value = s.query, onValueChange = viewModel::setQuery,
                        placeholder = "Search or scan…",
                        modifier = Modifier.weight(1f), height = 52.dp, bg = CardBg, leadingSearch = true,
                    )
                    // always-visible ad-hoc entry (was buried at the end of the grid)
                    Row(
                        Modifier.height(52.dp).dashedBorder(Color(0x400F1A24), 11.dp).clickable { viewModel.openAdhoc() }.padding(horizontal = 13.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("+", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("Ad-hoc", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                }
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 140.dp),
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    items(s.products, key = { it.id }) { p ->
                        ProductTile(
                            p = p,
                            inCartQty = s.cart.firstOrNull { it.product.id == p.id }?.qty?.toInt(),
                            onHand = s.onHand[p.id],
                            inclVat = s.pricesInclVat,
                        ) { viewModel.add(p) }
                    }
                }
                Box(
                    Modifier.fillMaxWidth().height(46.dp)
                        .border(1.dp, Color(0x59D63A3A), RoundedCornerShape(12.dp))
                        .clickable { viewModel.backToList() },
                    contentAlignment = Alignment.Center,
                ) { Text("✕ Cancel counter sale", color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }
            }

            // ── right (54fr): the bill — header · lines · totals ──────────────
            Column(
                Modifier.weight(54f).fillMaxHeight()
                    .background(CardBg, RoundedCornerShape(16.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(16.dp)),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp),
                ) {
                    Text("NEW SALE", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 19.sp, letterSpacing = 1.2.sp)
                    Box(Modifier.height(25.dp).background(InsetAlt, RoundedCornerShape(13.dp)).padding(horizontal = 11.dp), contentAlignment = Alignment.Center) {
                        Text("UNPAID", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp)
                    }
                    Spacer(Modifier.weight(1f))
                    Text("Counter sale", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
                // customer (functional addition — needed for credit sales; optional otherwise)
                Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 10.dp)) {
                    FilledInput(
                        value = s.customerText, onValueChange = viewModel::setCustomerText,
                        placeholder = if (s.method == PayMethod.CREDIT) "Pick the customer (required for credit)" else "Customer (optional)",
                        modifier = Modifier.fillMaxWidth(), height = 40.dp, bg = Inset,
                    )
                    s.customerMatches.forEach { c ->
                        Text(
                            c.name, color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.fillMaxWidth().clickable { viewModel.pickCustomer(c) }.padding(horizontal = 10.dp, vertical = 8.dp),
                        )
                    }
                }
                LazyColumn(
                    Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 11.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    itemsIndexed(s.cart, key = { _, it -> it.product.id }) { i, l ->
                        Column(Modifier.fillMaxWidth().background(if (l.expanded) InsetAlt else Tile, RoundedCornerShape(11.dp)).border(1.dp, Color(0x0F0F1A24), RoundedCornerShape(11.dp))) {
                            Row(
                                Modifier.fillMaxWidth().clickable { viewModel.toggleLine(l.product.id) }.padding(horizontal = 11.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(l.product.name, color = TextPrimary, fontFamily = Barlow, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    val discountNote = when {
                                        l.discountMode == DiscountMode.PCT && l.discountPct > 0 -> "  ·  −${l.discountPct}%"
                                        l.discountMode == DiscountMode.AMT && l.discountAmtCents > 0 -> "  ·  −${formatMUR(l.discountAmtCents)}"
                                        else -> ""
                                    }
                                    Text(
                                        "${l.qty.toInt()} × ${formatMUR(if (s.pricesInclVat) grossCents(l.product.sellingPriceCents, l.product.vatRatePct) else l.product.sellingPriceCents)}" + discountNote +
                                            (if (l.isAdhoc) "  ·  ad-hoc" else ""),
                                        color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp,
                                    )
                                }
                                Text(formatMUR(if (s.pricesInclVat) s.rowGrossCents(i) else s.docTotals.lineExclCents[i]), color = TextPrimary, fontFamily = Mono, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                                Box(
                                    Modifier.size(36.dp).background(Color(0x1AD63A3A), RoundedCornerShape(9.dp)).clickable { viewModel.setQty(l.product.id, 0.0) },
                                    contentAlignment = Alignment.Center,
                                ) { Text("✕", color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
                            }
                            if (l.expanded) Row(
                                Modifier.fillMaxWidth().padding(start = 11.dp, end = 11.dp, bottom = 9.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                StepBtn("−") { viewModel.setQty(l.product.id, l.qty - 1) }
                                Text(l.qty.toInt().toString(), Modifier.width(30.dp), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary, maxLines = 1, textAlign = TextAlign.Center)
                                StepBtn("+") { viewModel.setQty(l.product.id, l.qty + 1) }
                                Box(Modifier.width(1.dp).height(24.dp).background(Color(0x1F101A24)))
                                ModeToggle(l.discountMode) { viewModel.setLineDiscountMode(l.product.id, it) }
                                if (l.discountMode == DiscountMode.PCT) {
                                    listOf(0, 5, 10, 15, 20).forEach { d ->
                                        val on = l.discountPct == d
                                        Box(
                                            Modifier.height(34.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(9.dp)).border(1.dp, if (on) AccentLine else Color(0x17101A24), RoundedCornerShape(9.dp)).clickable { viewModel.setDiscount(l.product.id, d) }.padding(horizontal = 10.dp),
                                            contentAlignment = Alignment.Center,
                                        ) { Text(if (d == 0) "0%" else "$d%", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = if (on) Accent else TextSecondary) }
                                    }
                                } else {
                                    FilledInput(
                                        value = l.discountAmtText, onValueChange = { viewModel.setLineDiscountAmt(l.product.id, it) },
                                        placeholder = "0.00", modifier = Modifier.width(120.dp), height = 34.dp, radius = 9.dp, bg = CardBg, fontSize = 13.sp,
                                    )
                                    Text("off", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp)
                                }
                                Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    if (s.cart.isEmpty()) item(key = "empty") {
                        Text("Tap products to build the sale.", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 20.dp))
                    }
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
                Column(Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // Quoting gross: the subtotal is the lines at shelf price — summed from the very
                    // rows listed above, so the two can't drift — and VAT below reads "of which" so
                    // it isn't mistaken for a second charge.
                    TotalRow("Subtotal", formatMUR(if (s.pricesInclVat) s.grossSubtotalCents else s.preBasketSubtotalCents), TextSecondary)
                    // basket discount — % or Rs off the whole sale, saved as explicit discount lines
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Discount", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp)
                        ModeToggle(s.basketMode, h = 30.dp) { viewModel.setBasketMode(it) }
                        FilledInput(
                            value = s.basketText, onValueChange = viewModel::setBasketText,
                            placeholder = if (s.basketMode == DiscountMode.PCT) "0" else "0.00",
                            modifier = Modifier.width(96.dp), height = 30.dp, radius = 8.dp, bg = Inset, fontSize = 13.sp,
                        )
                        Spacer(Modifier.weight(1f))
                        // On a gross screen, show what actually came off the bill (Subtotal − TOTAL),
                        // not the net discount line — otherwise the three rows don't add up.
                        val shownDisc = if (s.pricesInclVat) s.basketAppliedGrossCents else s.basketAppliedCents
                        if (shownDisc > 0) Text("−" + formatMUR(shownDisc), color = Success, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
                    }
                    TotalRow(if (s.pricesInclVat) "of which VAT 15%" else "VAT 15%", formatMUR(s.totals.vatCents), TextSecondary)
                    TotalRow("TOTAL", formatMUR(s.totals.totalCents), TextPrimary, big = true)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                        Text("BALANCE DUE", color = Warning, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                        Text(formatMUR(s.totals.totalCents), color = Warning, fontFamily = Condensed, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                    }
                    s.error?.takeUnless { s.padOpen }?.let { Text(it, color = Danger, fontSize = 12.sp) }
                    Box(
                        Modifier.fillMaxWidth().height(56.dp)
                            .background(if (s.cart.isEmpty()) InsetAlt else Accent, RoundedCornerShape(14.dp))
                            .clickable(enabled = s.cart.isNotEmpty()) { viewModel.openPad() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Record payment", color = if (s.cart.isEmpty()) TextMuted else AccentInk, fontSize = 16.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }

    if (s.padOpen) PaymentPad(s, viewModel)
    if (s.adhocOpen) AdhocDialog(viewModel, s.pricesInclVat)
    s.oversell?.let { o ->
        val oh = s.onHand[o.product.id] ?: 0
        Dialog(onDismissRequest = viewModel::dismissOversell) {
            Column(
                Modifier.widthIn(max = 460.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Selling into negative stock", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                val opening = when {
                    oh > 0 -> "only $oh on hand"
                    oh == 0 -> "no stock on hand"
                    else -> "no stock on hand (already at $oh)"
                }
                Text(
                    "${o.product.name} has $opening. Selling ${o.targetQty.toInt()} will leave stock at ${oh - o.targetQty.toInt()}. Do you wish to continue?",
                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, lineHeight = 19.sp, color = TextSecondary,
                )
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Box(
                        Modifier.weight(1f).height(52.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { viewModel.dismissOversell() },
                        contentAlignment = Alignment.Center,
                    ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                    Box(
                        Modifier.weight(1.4f).height(52.dp).background(Warning, RoundedCornerShape(13.dp)).clickable { viewModel.confirmOversell() },
                        contentAlignment = Alignment.Center,
                    ) { Text("Sell anyway", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Color.White) }
                }
            }
        }
    }
    s.done?.let {
        SaleDone(
            result = it, receipt = s.receipt,
            methodLabel = s.method.label,
            customerLabel = s.customerText.trim().ifBlank { "Walk-in" },
            canVoid = viewModel.canManage,
            onPrint = viewModel::reprint, onVoid = viewModel::voidCompletedSale,
            onNewSale = viewModel::startNextSale, onDone = viewModel::backToList,
        )
    }
    s.paymentAction?.let { p ->
        PaymentActionDialog(p, s.paidToday.mapNotNull { it.reversesPaymentId }.toSet(), viewModel)
    }
    if (s.historyOpen) HistoryDialog(s, viewModel)
    s.viewDoc?.let { doc -> ViewReceiptDialog(doc, onPrint = viewModel::printViewDoc, onClose = viewModel::closeViewDoc) }
    s.notice?.let { Notice(it, onGone = viewModel::clearNotice) }
}

@Composable
private fun StepBtn(t: String, onClick: () -> Unit) =
    Box(Modifier.size(40.dp).background(InsetAlt, RoundedCornerShape(10.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary)
    }

/** Mini % / Rs switch used by both the line editor and the basket discount row. */
@Composable
private fun ModeToggle(mode: DiscountMode, h: Dp = 34.dp, onPick: (DiscountMode) -> Unit) {
    Row(Modifier.height(h).background(InsetAlt, RoundedCornerShape(9.dp)).border(1.dp, Color(0x17101A24), RoundedCornerShape(9.dp))) {
        listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, label) ->
            val on = mode == m
            Box(
                Modifier.fillMaxHeight().background(if (on) AccentSoft else Color.Transparent, RoundedCornerShape(9.dp)).clickable { onPick(m) }.padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = if (on) Accent else TextSecondary) }
        }
    }
}

/**
 * Handoff product tile: name · stock line · price, with a round top-right badge.
 * Badge shows the in-cart count (accent) once tapped — but flips to the red
 * shortfall (e.g. "−3") the moment the cart would oversell, so ringing up an
 * out-of-stock item is never quietly blue. Untapped: the true on-hand when low
 * (warning), red at zero or below (negatives shown as-is, matching the Stock tab).
 */
@Composable
private fun ProductTile(p: mu.carfection.pos.core.database.ProductEntity, inCartQty: Int?, onHand: Int?, inclVat: Boolean, onAdd: () -> Unit) {
    Box(Modifier.background(Tile, RoundedCornerShape(13.dp)).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onAdd)) {
        // 112dp fits the worst case — a 2-line name + stock line + price (with their
        // natural line heights) — without clipping; the Spacer absorbs the slack on
        // 1-line names so those tiles read the same as before.
        Column(Modifier.fillMaxWidth().height(112.dp).padding(horizontal = 13.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                // Reference photo — so a similarly-named part can be told apart at a glance.
                // In-flow, not overlaid, so it only ever costs space on the products that have one.
                p.photoUrl?.let { url ->
                    coil.compose.AsyncImage(
                        model = url, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                        modifier = Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)),
                    )
                }
                Text(
                    p.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 17.5.sp,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 20.dp).weight(1f),
                )
            }
            Spacer(Modifier.weight(1f))
            val oh = (onHand ?: 0).coerceAtLeast(0) // oversold rows read as empty, not "-1"
            val lowAt = p.effectiveLowStock // per-product threshold: blank = 10, capped at 20
            val (meta, metaC) = when {
                !p.isStocked -> (if (p.kind == "service") "Service" else "—") to TextMuted
                oh == 0 -> "Out of stock" to Danger
                oh < lowAt -> "Stock $oh · low" to Warning
                else -> "Stock $oh" to TextMuted
            }
            Text(meta, color = metaC, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, maxLines = 1)
            // Shelf price when the shop quotes gross — the stored figure stays net.
            Text(formatMUR(if (inclVat) grossCents(p.sellingPriceCents, p.vatRatePct) else p.sellingPriceCents), color = TextSecondary, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, maxLines = 1)
        }
        val ohRaw = onHand ?: 0
        val short = if (p.isStocked && inCartQty != null) ohRaw - inCartQty else 0
        val badge: Pair<String, Color>? = when {
            inCartQty != null && inCartQty > 0 && short < 0 -> "−${-short}" to Danger
            inCartQty != null && inCartQty > 0 -> inCartQty.toString() to Accent
            p.isStocked && ohRaw < 0 -> "−${-ohRaw}" to Danger
            p.isStocked && ohRaw == 0 -> "0" to Danger
            p.isStocked && ohRaw < p.effectiveLowStock -> ohRaw.toString() to Warning
            else -> null
        }
        badge?.let { (txt, bg) ->
            Box(
                Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp)
                    .defaultMinSize(minWidth = 23.dp).height(23.dp)
                    .background(bg, RoundedCornerShape(12.dp)).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Text(txt, color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp) }
        }
    }
}

/** Dashed rounded outline (Compose has no dashed border modifier). */
private fun Modifier.dashedBorder(color: Color, radius: Dp, stroke: Dp = 1.5.dp) = this.drawBehind {
    val sw = stroke.toPx(); val r = radius.toPx()
    drawRoundRect(
        color = color, topLeft = Offset(sw / 2, sw / 2), size = Size(size.width - sw, size.height - sw),
        cornerRadius = CornerRadius(r, r), style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(sw * 5, sw * 4))),
    )
}

/** Type a one-off line: description + VAT-exclusive unit price (saves with product_id = null). */
@Composable
private fun AdhocDialog(vm: CounterViewModel, inclVat: Boolean) {
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    val cents = parseMoneyToCents(price)
    val ok = name.isNotBlank() && cents != null && cents > 0
    Dialog(onDismissRequest = vm::closeAdhoc) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Ad-hoc line", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
            Text("A one-off service or product, priced by hand.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
            Text("DESCRIPTION", color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
            FilledInput(value = name, onValueChange = { name = it }, placeholder = "e.g. Headlight restoration", modifier = Modifier.fillMaxWidth(), bg = Inset)
            Text(if (inclVat) "UNIT PRICE (Rs, incl. VAT)" else "UNIT PRICE (Rs, excl. VAT)", color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
            FilledInput(value = price, onValueChange = { p -> price = p.filter { it.isDigit() || it == '.' } }, placeholder = "0.00", modifier = Modifier.fillMaxWidth(), bg = Inset)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(52.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { vm.closeAdhoc() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                Box(
                    Modifier.weight(1.4f).height(52.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = ok) { vm.addAdhoc(name, cents ?: 0) },
                    contentAlignment = Alignment.Center,
                ) { Text("Add line", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (ok) AccentInk else TextMuted) }
            }
        }
    }
}

// ─── Collect list: TO COLLECT (outstanding invoices) + PAID TODAY ─────────────
@Composable
private fun CollectList(s: CounterUiState, vm: CounterViewModel) {
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // left: new walk-in + TO COLLECT
        Column(
            Modifier.weight(1.15f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp))
                .border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(12.dp),
        ) {
            Box(
                Modifier.fillMaxWidth().height(58.dp)
                    .background(AccentSoft, RoundedCornerShape(14.dp))
                    .border(1.5.dp, AccentLine, RoundedCornerShape(14.dp))
                    .clickable { vm.startWalkIn() },
                contentAlignment = Alignment.Center,
            ) { Text("＋  New counter sale — walk-in", color = Accent, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(12.dp))
            Text("TO COLLECT", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp)
            Spacer(Modifier.height(8.dp))
            if (s.bills.isEmpty()) {
                Text(if (s.listBusy) "Loading…" else "Nothing awaiting payment.", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 18.dp))
            } else LazyColumn(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                items(s.bills, key = { it.id }) { b ->
                    // HALF_UP via rupeesToCents, not truncation — a Rs .13 balance must not
                    // read as .12 a cent below what the pad actually collects (audit #12).
                    val remaining = mu.carfection.pos.core.money.rupeesToCents(b.totalIncl) - mu.carfection.pos.core.money.rupeesToCents(b.amountPaid)
                    val partly = b.status == "partly_paid"
                    Row(
                        Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(12.dp))
                            .border(1.dp, Hairline, RoundedCornerShape(12.dp))
                            .clickable { vm.collectOn(b) }.padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(b.number ?: "Invoice", color = TextMuted, fontFamily = Mono, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                            Text(b.customers?.name ?: "—", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(formatMUR(remaining), color = TextPrimary, fontFamily = Mono, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            Box(Modifier.background(if (partly) AccentSoft else InsetAlt, RoundedCornerShape(9.dp)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                                Text(if (partly) "PART-PAID" else "UNPAID", color = if (partly) Accent else TextSecondary, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                            }
                        }
                    }
                }
            }
        }
        // right: PAID TODAY
        Column(
            Modifier.weight(0.85f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp))
                .border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("PAID TODAY", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp, modifier = Modifier.weight(1f))
                Text(
                    "Scan / history →", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp,
                    modifier = Modifier.clickable { vm.openHistory() }.padding(horizontal = 4.dp, vertical = 2.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            if (s.paidToday.isEmpty()) {
                Text("No payments yet today.", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 18.dp))
            } else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                // Reversed pairs are collapsed away upstream (loadLists) — every
                // row here is money that actually stands.
                items(s.paidToday) { p ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                            .clickable(enabled = vm.canManage) { vm.openPaymentAction(p) }
                            .padding(vertical = 6.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Check, null, tint = Success, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(p.documents?.number ?: "—", color = TextMuted, fontFamily = Mono, fontSize = 11.sp)
                        Spacer(Modifier.width(8.dp))
                        Text(p.documents?.customers?.name ?: "—", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(formatMUR(mu.carfection.pos.core.money.rupeesToCents(p.amount)), color = TextPrimary, fontFamily = Mono, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun Chip(text: String, color: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .background(InsetAlt, RoundedCornerShape(19.dp))
            .border(1.dp, Hairline, RoundedCornerShape(19.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun Stepper(qty: Int, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(28.dp).background(InsetAlt, RoundedCornerShape(7.dp)).clickable(onClick = onMinus), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Remove, null, tint = TextPrimary, modifier = Modifier.size(14.dp))
        }
        Text(qty.toString(), color = TextPrimary, fontFamily = Mono, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp), textAlign = TextAlign.Center)
        Box(Modifier.size(28.dp).background(InsetAlt, RoundedCornerShape(7.dp)).clickable(onClick = onPlus), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Add, null, tint = TextPrimary, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun TotalRow(label: String, value: String, color: Color, big: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = color, fontSize = if (big) 15.sp else 13.sp, fontWeight = if (big) FontWeight.Bold else FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            color = if (big) TextPrimary else color,
            fontFamily = if (big) Condensed else Mono,
            fontSize = if (big) 24.sp else 13.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

// ─── The fast payment pad (light "Record payment" modal, per handoff) ─────────
// Opens pre-filled: Cash + exact amount (tender mirrors the total → change 0 and
// already valid). Exact cash = 2 taps. Cash w/ change = 3 (chip → Record).

/**
 * The full-screen payment step — the owner's Cashmag "Payment" screen, rebuilt: the bill
 * on the left, the big means-of-payment tiles in the middle, and the total/balance plus
 * the selected method's entry detail on the right. Every behaviour of the old popup pad is
 * carried over (tender/change + numpad, part payments, on-account credit, card/Juice/bank
 * references, the internal note, the till gate, and the owner's void-invoice path).
 */
@Composable
private fun PaymentPad(s: CounterUiState, vm: CounterViewModel) {
    Dialog(onDismissRequest = vm::closePad, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Box(Modifier.fillMaxSize().background(ScreenBg)) {
            // Extra bottom gap so the three cards' rounded corners clear the screen edge / gesture bar.
            Column(Modifier.fillMaxSize().navigationBarsPadding().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 26.dp)) {
                // top bar — bill identity + back
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        Modifier.height(42.dp).background(CardBg, RoundedCornerShape(12.dp)).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                            .clickable(onClick = vm::closePad).padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("←  Back", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                    Text("PAYMENT", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp)
                    s.collect?.let {
                        Text("${it.number ?: "Invoice"} · ${it.customers?.name ?: "—"}", color = TextMuted, fontFamily = Mono, fontSize = 14.sp)
                    } ?: Text("Counter sale", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    Spacer(Modifier.weight(1f))
                    // Split bill toggle — allocate the total across several methods.
                    Row(
                        Modifier.height(42.dp)
                            .background(if (s.splitMode) Accent else CardBg, RoundedCornerShape(21.dp))
                            .border(1.dp, if (s.splitMode) Accent else AccentLine, RoundedCornerShape(21.dp))
                            .clickable { vm.toggleSplit() }.padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("⑃", color = if (s.splitMode) AccentInk else Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(if (s.splitMode) "Split bill · on" else "Split bill", color = if (s.splitMode) AccentInk else Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }
                }
                Spacer(Modifier.height(12.dp))

                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // ── left: the bill ───────────────────────────────────────────────
                    val vehicle = s.collect?.vehicles
                    Column(
                        Modifier.weight(1.35f).fillMaxHeight()
                            .background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp))
                            .padding(22.dp),
                    ) {
                        // Studio identity + emblem (Cashmag prints the shop's name/address/logo atop the bill).
                        Row(verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f).padding(end = 10.dp)) {
                                Text(s.bizName.ifBlank { "CARFECTIONIST" }.uppercase(), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 25.sp, letterSpacing = 0.5.sp, lineHeight = 27.sp)
                                s.bizAddress?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                }
                            }
                            // Brand emblem — gold line-art on its black tile, as the asset is designed
                            // (mirrors the app header; a bare gold mark washes out on the white card).
                            Box(
                                Modifier.size(58.dp).background(Color(0xFF0B0D0F), RoundedCornerShape(14.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Image(
                                    painterResource(R.drawable.logo_carfectionist),
                                    contentDescription = null,
                                    modifier = Modifier.size(52.dp),
                                )
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                        // Bill reference + when it was rung, then the item count — the Cashmag panel.
                        // A discount line isn't an "item", so the count is the real product/service lines.
                        val itemCount = if (s.collect != null) s.collectLines.count { rupeesToCents(it.lineTotalExcl) + rupeesToCents(it.lineVat) >= 0 }
                            else s.cart.sumOf { if (it.qty % 1.0 == 0.0) it.qty.toInt() else 1 }
                        // A collect's lines arrive a beat after the pad opens — don't guess a count until then.
                        val showItemCount = s.collect == null || s.collectLines.isNotEmpty()
                        val stamp = remember(s.collect?.id) {
                            val fmt = java.time.format.DateTimeFormatter.ofPattern("dd-MM-yyyy · HH:mm")
                            s.collect?.issuedAt?.let {
                                runCatching { java.time.OffsetDateTime.parse(it).atZoneSameInstant(java.time.ZoneOffset.ofHours(4)).format(fmt) }.getOrNull()
                            } ?: java.time.LocalDateTime.now().format(fmt)
                        }
                        Text(
                            "${s.collect?.number ?: "New counter sale"}  ·  $stamp",
                            color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        )
                        if (showItemCount) Text("$itemCount item${if (itemCount == 1) "" else "s"}", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                        // Vehicle — for a job/service invoice, WHICH car we worked on.
                        if (vehicle != null && (!vehicle.plate.isNullOrBlank() || !vehicle.make.isNullOrBlank() || !vehicle.model.isNullOrBlank())) {
                            Spacer(Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                                vehicle.plate?.takeIf { it.isNotBlank() }?.let { plate ->
                                    Box(Modifier.background(Plate, RoundedCornerShape(6.dp)).padding(horizontal = 9.dp, vertical = 3.dp)) {
                                        Text(plate.uppercase(), color = Color(0xFF151208), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 1.sp)
                                    }
                                }
                                val desc = listOfNotNull(
                                    vehicle.make?.takeIf { it.isNotBlank() }?.replaceFirstChar { c -> c.uppercase() },
                                    vehicle.model?.takeIf { it.isNotBlank() },
                                ).joinToString(" ")
                                if (desc.isNotBlank()) Text(desc, color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
                        Spacer(Modifier.height(12.dp))
                        // line items: a walk-in cart carries its lines; a collect shows the invoice's REAL
                        // lines — what the client actually took (service/products), fetched when the pad opened.
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                            if (s.collect != null) {
                                if (s.collectLines.isNotEmpty()) {
                                    // Every line, discounts included, so what's shown reconciles with the total.
                                    s.collectLines.forEach { l ->
                                        val incl = rupeesToCents(l.lineTotalExcl) + rupeesToCents(l.lineVat)
                                        BillLine(if (l.qty % 1.0 == 0.0) l.qty.toInt().toString() else l.qty.toString(), l.title, incl)
                                    }
                                } else if (s.collectDetailFailed) {
                                    Box(Modifier.fillMaxWidth().clickable { vm.retryCollectDetail() }) {
                                        Text("Couldn't load items — tap to retry", color = Warning, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                    }
                                } else {
                                    Text("Retrieving items…", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                }
                                // Service performed — the job's checklist: what the client actually got done.
                                s.collectJob?.checklist?.filter { it.done }?.takeIf { it.isNotEmpty() }?.let { done ->
                                    Spacer(Modifier.height(6.dp))
                                    Text("SERVICE PERFORMED", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp)
                                    done.forEach { item ->
                                        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Text("✓", color = Success, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                            Text(item.label, color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 16.sp, modifier = Modifier.weight(1f))
                                        }
                                    }
                                }
                            } else {
                                s.cart.forEachIndexed { i, l ->
                                    // rowGrossCents, not the line at full price: this panel used to list
                                    // every line UNDISCOUNTED beside a discounted TOTAL underneath it, so
                                    // the bill the customer reads while paying didn't add up to what they
                                    // were being charged.
                                    BillLine(if (l.qty % 1.0 == 0.0) l.qty.toInt().toString() else l.qty.toString(), l.product.name, s.rowGrossCents(i))
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
                        Spacer(Modifier.height(12.dp))
                        // The invoice total is what the lines sum to. A collect may already carry a
                        // deposit, so show what's been paid and the balance actually being settled now.
                        val invoiceTotalCents = s.collect?.let { rupeesToCents(it.totalIncl) } ?: s.dueCents
                        val paidAlreadyCents = s.collect?.let { rupeesToCents(it.amountPaid) } ?: 0L
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("Total incl. tax", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                            Spacer(Modifier.weight(1f))
                            Text(formatMUR(invoiceTotalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp)
                        }
                        if (paidAlreadyCents > 0) {
                            Spacer(Modifier.height(8.dp))
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text("Already paid", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                Spacer(Modifier.weight(1f))
                                Text("− ${formatMUR(paidAlreadyCents)}", color = Success, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text("Balance due", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Spacer(Modifier.weight(1f))
                                Text(formatMUR(s.dueCents), color = Warning, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                            }
                        }
                        // internal note (walk-in only) tucked under the bill
                        if (s.collect == null) {
                            Spacer(Modifier.height(10.dp))
                            OutlinedTextField(
                                value = s.comment, onValueChange = vm::setComment,
                                placeholder = { Text("Internal note (optional)", color = TextMuted, fontSize = 12.sp) },
                                maxLines = 2, textStyle = LocalTextStyle.current.copy(fontSize = 12.sp),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }

                    if (s.splitMode) SplitAllocation(s, vm) else SingleMethodPay(s, vm)
                }
            }
        }
    }
}

/** Single-method payment: the means-of-payment tiles (middle); the totals, the chosen method's
 *  entry (Amount / Cash tendered) and its numpad + Record (right). The entry cards are kept compact
 *  so the keypad fits without scrolling — a scrolling keypad is a poor POS experience. */
@Composable
private fun RowScope.SingleMethodPay(s: CounterUiState, vm: CounterViewModel) {
    // ── middle: means of payment ──
    Column(
        Modifier.weight(1f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(18.dp),
    ) {
        Text("MEANS OF PAYMENT", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp)
        Spacer(Modifier.height(14.dp))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PayMethod.entries.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    row.forEach { m -> Box(Modifier.weight(1f)) { MethodTile(m, s.method == m) { vm.setMethod(m) } } }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
    // ── right: totals + entry (amount / cash tendered) + numpad + Record ──
    Column(
        Modifier.weight(1f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(18.dp),
    ) {
        TotalBalance(s.dueCents, s.balanceAfterCents)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PaymentEntryFields(s, vm)
            if (numPadVisible(s)) NumPad { vm.padKey(it) }
        }
        Spacer(Modifier.height(10.dp))
        s.error?.let { Text(it, color = Danger, fontSize = 13.sp); Spacer(Modifier.height(6.dp)) }
        if (s.cashNeedsTill) {
            Text("Open the till first — every payment lands on a service that gets counted.",
                color = Warning, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
            Spacer(Modifier.height(6.dp))
        }
        Box(
            Modifier.fillMaxWidth().height(56.dp).background(if (s.canRecord) Accent else InsetAlt, RoundedCornerShape(14.dp))
                .clickable(enabled = s.canRecord) { vm.confirm() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (s.busy) "Recording…"
                else if (s.method == PayMethod.CREDIT) "Put ${formatMUR(s.dueCents)} on account"
                else if (s.isPartPayment) "Take ${formatMUR(s.payCents)} — ${formatMUR(s.balanceAfterCents)} left"
                else "Record ${formatMUR(s.payCents)}",
                color = if (s.canRecord) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp,
            )
        }
        s.collect?.takeIf { it.status == "issued" && vm.canManage }?.let { bill ->
            var voidOpen by remember(bill.id) { mutableStateOf(false) }
            var voidWhy by remember(bill.id) { mutableStateOf("") }
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth().clickable { voidOpen = !voidOpen }, contentAlignment = Alignment.Center) {
                Text("Void this invoice", color = Danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            if (voidOpen) {
                OutlinedTextField(voidWhy, { voidWhy = it }, label = { Text("Reason for voiding (required)") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                Box(
                    Modifier.fillMaxWidth().height(44.dp).padding(top = 6.dp).background(if (voidWhy.isBlank()) InsetAlt else Danger, RoundedCornerShape(11.dp))
                        .clickable(enabled = voidWhy.isNotBlank()) { vm.voidInvoice(bill, voidWhy) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (voidWhy.isBlank()) "Enter the reason above first" else "Void ${bill.number ?: "this invoice"}",
                        color = if (voidWhy.isBlank()) TextMuted else Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/** Split bill: an allocation table — an amount per method — plus a numpad and Record. */
@Composable
private fun RowScope.SplitAllocation(s: CounterUiState, vm: CounterViewModel) {
    // ── middle: one row per method, with its allocated amount ──
    Column(
        Modifier.weight(1f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Text("HOW IS THE CUSTOMER PAYING?", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.2.sp)
        SPLIT_METHODS.forEach { m ->
            val focused = s.splitFocus == m
            val cents = s.splitCents(m)
            Row(
                Modifier.fillMaxWidth().height(60.dp)
                    .background(if (focused) methodHue(m).copy(alpha = 0.12f) else InsetAlt, RoundedCornerShape(13.dp))
                    .border(if (focused) 2.dp else 1.dp, if (focused) methodHue(m) else Hairline, RoundedCornerShape(13.dp))
                    .clickable { vm.setSplitFocus(m) }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(34.dp).background(methodHue(m), CircleShape), contentAlignment = Alignment.Center) {
                    Icon(methodIcon(m), m.label, tint = Color.White, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(12.dp))
                Text(m.label, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(Modifier.weight(1f))
                Text(
                    if (cents > 0) formatMUR(cents) else "—",
                    color = if (cents > 0) TextPrimary else TextMuted, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp,
                )
            }
        }
        Spacer(Modifier.weight(1f))
        Text("Credit can't be split — it's a receivable, not a tender.", color = TextMuted, fontFamily = Barlow, fontSize = 11.5.sp)
    }
    // ── right: totals + numpad (into the focused row) + Record ──
    Column(
        Modifier.weight(1f).fillMaxHeight().background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(18.dp),
    ) {
        TotalBalance(s.dueCents, s.splitBalanceCents.coerceAtLeast(0), overAllocated = s.splitBalanceCents < 0)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Editing", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Text(s.splitFocus.label, color = methodHue(s.splitFocus), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Spacer(Modifier.weight(1f))
            QuickChip("Rest") { vm.fillSplitRest() }
        }
        Spacer(Modifier.height(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Bottom) {
            NumPad { vm.splitPadKey(it) }
        }
        Spacer(Modifier.height(10.dp))
        s.error?.let { Text(it, color = Danger, fontSize = 13.sp); Spacer(Modifier.height(6.dp)) }
        if (s.cashNeedsTill) {
            Text("Open the till first — every payment lands on a service that gets counted.",
                color = Warning, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
            Spacer(Modifier.height(6.dp))
        } else if (s.splitBalanceCents != 0L && s.allocatedCents > 0) {
            Text(
                if (s.splitBalanceCents > 0) "Rs ${formatMUR(s.splitBalanceCents).removePrefix("Rs ")} still to allocate" else "Over-allocated — trim a row",
                color = Warning, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp,
            )
            Spacer(Modifier.height(6.dp))
        }
        Box(
            Modifier.fillMaxWidth().height(56.dp).background(if (s.splitCanRecord) Accent else InsetAlt, RoundedCornerShape(14.dp))
                .clickable(enabled = s.splitCanRecord) { vm.confirm() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (s.busy) "Recording…" else "Record ${formatMUR(s.dueCents)} split",
                color = if (s.splitCanRecord) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp,
            )
        }
    }
}

/** The Total / Balance header shared by the single and split payment panels. */
@Composable
private fun TotalBalance(totalCents: Long, balanceCents: Long, overAllocated: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Total", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
        Text(formatMUR(totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp)
    }
    Spacer(Modifier.height(6.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Balance", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
        Text(formatMUR(balanceCents), color = if (balanceCents > 0 || overAllocated) Warning else Success, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp)
    }
    Spacer(Modifier.height(12.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
    Spacer(Modifier.height(12.dp))
}

/** One line of the bill on the payment screen's left panel. */
@Composable
private fun BillLine(qty: String, name: String, inclCents: Long) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(qty, color = TextMuted, fontFamily = Mono, fontSize = 14.sp, modifier = Modifier.width(30.dp))
        Text(name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 20.sp, modifier = Modifier.weight(1f).padding(end = 10.dp))
        Text(formatMUR(inclCents), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** The brand hue for each means of payment (its tile + staged-tender accent). */
private fun methodHue(m: PayMethod): Color = when (m) {
    PayMethod.CASH -> Success
    PayMethod.CARD -> Accent
    PayMethod.JUICE -> Color(0xFFE8A400)
    PayMethod.BANK -> Color(0xFF3B5B8C)
    PayMethod.CREDIT -> Warning
}

/** A recognisable icon per method — no more anonymous "C" circles. */
private fun methodIcon(m: PayMethod): ImageVector = when (m) {
    PayMethod.CASH -> Icons.Filled.Payments          // banknotes
    PayMethod.CARD -> Icons.Filled.CreditCard        // bank card
    PayMethod.JUICE -> Icons.Filled.Smartphone       // MCB Juice — a phone wallet
    PayMethod.BANK -> Icons.Filled.AccountBalance     // bank transfer
    PayMethod.CREDIT -> Icons.Filled.Schedule         // on account — pay later
}

/** A big means-of-payment tile with an icon (Cashmag's payment grid). */
@Composable
private fun MethodTile(m: PayMethod, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val hue = methodHue(m)
    Column(
        Modifier.fillMaxWidth().height(104.dp)
            .background(if (selected) hue.copy(alpha = 0.14f) else InsetAlt, RoundedCornerShape(16.dp))
            .border(2.dp, if (selected) hue else Hairline, RoundedCornerShape(16.dp))
            .clickable(enabled = enabled, onClick = onClick).padding(10.dp)
            .alpha(if (enabled) 1f else 0.4f),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(46.dp).background(hue, CircleShape), contentAlignment = Alignment.Center) {
            Icon(methodIcon(m), m.label, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(m.label, color = if (selected) hue else TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

/** The entry detail for the currently-selected method — Amount / Cash tendered / ref / credit.
 *  Shown in the middle column under the method tiles; the numpad that feeds it lives in the right
 *  column (see [numPadVisible]). */
@Composable
private fun PaymentEntryFields(s: CounterUiState, vm: CounterViewModel) {
    // Only a COLLECT can take a partial (a deposit) in single-method mode; a walk-in pays in
    // full (splitting is a separate mode). Credit always settles the whole remainder.
    val amountEditable = s.collect != null && s.method != PayMethod.CREDIT
    val onAmount = amountEditable && (s.padField == PadField.AMOUNT || s.method != PayMethod.CASH)
    DisplayCard(
        if (s.method == PayMethod.CREDIT) "GOES ON ACCOUNT" else if (s.isPartPayment) "PAYING NOW" else "AMOUNT",
        formatMUR(if (s.method == PayMethod.CREDIT) s.dueCents else s.payCents),
        highlight = onAmount,
        onClick = if (amountEditable) ({ vm.focusPad(PadField.AMOUNT) }) else null,
    )
    if (amountEditable) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            QuickChip("Full") { vm.setPayCents(null) }
            s.depositChips.forEach { cents -> QuickChip(formatMUR(cents).removePrefix("Rs ").substringBefore(".")) { vm.setPayCents(cents) } }
        }
    }
    when (s.method) {
        PayMethod.CASH -> {
            DisplayCard("CASH TENDERED", formatMUR(s.effectiveTenderCents), highlight = !onAmount,
                onClick = if (amountEditable) ({ vm.focusPad(PadField.TENDER) }) else null)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QuickChip("Exact") { vm.setTenderCents(s.payCents) }
                s.quickTenders.forEach { cents -> QuickChip(formatMUR(cents).removePrefix("Rs ").substringBefore(".")) { vm.setTenderCents(cents) } }
            }
            Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Change", color = TextSecondary, fontSize = 13.sp)
                Spacer(Modifier.weight(1f))
                Text(formatMUR(s.changeCents), color = Success, fontFamily = Condensed, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        PayMethod.CREDIT -> {
            val bill = s.collect
            when {
                // A collect already knows who owes it (the invoice's customer).
                bill != null && bill.customers != null -> Text(
                    "On account for ${bill.customers.name} — ${formatMUR(s.dueCents)} stays owed on their statement. The car is handed over now.",
                    color = Warning, fontSize = 14.sp, lineHeight = 19.sp,
                )
                bill != null -> Text(
                    "This bill has no customer attached — credit needs someone to owe it.",
                    color = Warning, fontSize = 14.sp, lineHeight = 19.sp,
                )
                s.customerId != null -> Text(
                    "On account for ${s.customerText} — ${formatMUR(s.dueCents)} recorded as owed. The debt is tracked against them.",
                    color = Warning, fontSize = 14.sp, lineHeight = 19.sp,
                )
                // A walk-in credit with no customer yet — pick or CREATE one right here.
                else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Who owes it? Credit is tracked against a customer — pick one or create a new one.", color = TextMuted, fontSize = 13.sp, lineHeight = 18.sp)
                    OutlinedTextField(
                        value = s.customerText, onValueChange = vm::setCustomerText,
                        placeholder = { Text("Search or type a new customer name", color = TextMuted) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    s.customerMatches.forEach { c ->
                        Box(
                            Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(10.dp)).border(1.dp, Hairline, RoundedCornerShape(10.dp))
                                .clickable { vm.pickCustomer(c) }.padding(horizontal = 12.dp, vertical = 10.dp),
                        ) { Text(c.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
                    }
                    // No exact match on a typed name → offer to create that customer.
                    val typed = s.customerText.trim()
                    if (typed.isNotEmpty() && s.customerMatches.none { it.name.equals(typed, ignoreCase = true) }) {
                        Box(
                            Modifier.fillMaxWidth().height(46.dp).background(AccentSoft, RoundedCornerShape(11.dp)).border(1.dp, AccentLine, RoundedCornerShape(11.dp))
                                .clickable(enabled = !s.busy) { vm.createCustomer(typed) },
                            contentAlignment = Alignment.Center,
                        ) { Text(if (s.busy) "Creating…" else "+ Create \"$typed\"", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                    }
                }
            }
        }
        else -> {
            OutlinedTextField(
                value = s.refText, onValueChange = vm::setRef,
                placeholder = { Text(when (s.method) {
                    PayMethod.CARD -> "Terminal ref — e.g. T-88291"
                    PayMethod.JUICE -> "Juice ref — e.g. JU-55214"
                    else -> "Transfer ref — e.g. MCB-2214"
                }, color = TextMuted) },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Text("Run it on the terminal / app first — the POS records the reference.", color = TextMuted, fontSize = 12.sp)
        }
    }
}

/** Whether the chosen method needs the numpad (which lives in the right column, beside these
 *  fields). Cash always types a tender; card/juice/bank only when a collect takes a part-payment;
 *  credit types nothing. */
private fun numPadVisible(s: CounterUiState): Boolean = when (s.method) {
    PayMethod.CREDIT -> false
    PayMethod.CASH -> true
    else -> s.collect != null
}

/** The 3×4 numeric keypad shared by the cash and part-payment entry. */
@Composable
private fun NumPad(onKey: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(".", "0", "⌫")).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { k ->
                    Box(
                        Modifier.weight(1f).height(48.dp).background(InsetAlt, RoundedCornerShape(12.dp)).clickable { onKey(k) },
                        contentAlignment = Alignment.Center,
                    ) { Text(k, color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
                }
            }
        }
    }
}

// ─── Corrections: reverse a payment / issue a credit note (owner-manager) ─────
@Composable
private fun PaymentActionDialog(p: mu.carfection.pos.core.network.TodayPaymentDto, reversedIds: Set<String>, vm: CounterViewModel) {
    var reason by remember { mutableStateOf("") }
    val isReversalRow = p.reversesPaymentId != null
    val alreadyReversed = p.id in reversedIds
    Dialog(onDismissRequest = vm::closePaymentAction) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(22.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Correct this payment", color = TextPrimary, fontFamily = Condensed, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text("${p.documents?.number ?: "Invoice"} · ${p.documents?.customers?.name ?: "—"} · ${formatMUR(mu.carfection.pos.core.money.rupeesToCents(p.amount))}", color = TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(2.dp))
            when {
                isReversalRow -> Text("This entry IS a reversal — there's nothing further to undo on it.", color = TextMuted, fontSize = 13.sp)
                alreadyReversed -> Text("This payment has already been reversed.", color = TextMuted, fontSize = 13.sp)
                else -> {
                    ActionButton("Refund — issue credit note", "Reverses the whole invoice and restocks any products.", Accent, AccentInk) { vm.refundInvoice(p) }
                    // The owner reads this reason in the back office (Activity, Traceability,
                    // Cash Flow) — reversing without saying why is not allowed.
                    OutlinedTextField(
                        reason, { reason = it },
                        label = { Text("Reason for reversing (required)") },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    ActionButton(
                        "Reverse this payment only",
                        if (reason.isBlank()) "Enter the reason above first." else "Undoes just this payment; the invoice becomes unpaid again.",
                        InsetAlt, if (reason.isBlank()) TextMuted else TextPrimary,
                        enabled = reason.isNotBlank(),
                    ) { vm.reverseThisPayment(p, reason.trim()) }
                }
            }
            Box(
                Modifier.fillMaxWidth().height(48.dp).clickable(onClick = vm::closePaymentAction),
                contentAlignment = Alignment.Center,
            ) { Text("Cancel", color = TextSecondary, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
private fun ActionButton(title: String, sub: String, bg: Color, fg: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(bg, RoundedCornerShape(13.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 15.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(title, color = fg, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(sub, color = if (bg == Accent) AccentInk.copy(alpha = 0.85f) else TextMuted, fontSize = 11.5.sp, lineHeight = 15.sp)
    }
}

@Composable
private fun Notice(msg: String, onGone: () -> Unit) {
    androidx.compose.runtime.LaunchedEffect(msg) { kotlinx.coroutines.delay(2200); onGone() }
    Box(Modifier.fillMaxSize().padding(bottom = 26.dp), contentAlignment = Alignment.BottomCenter) {
        Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
            Text(msg, color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun DisplayCard(label: String, value: String, highlight: Boolean = false, onClick: (() -> Unit)? = null) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Inset, RoundedCornerShape(12.dp))
            .border(1.5.dp, if (highlight) AccentLine else Hairline, RoundedCornerShape(12.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        Text(value, color = TextPrimary, fontFamily = Condensed, fontSize = 19.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun QuickChip(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .height(36.dp)
            .background(InsetAlt, RoundedCornerShape(10.dp))
            .border(1.dp, Hairline, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = TextSecondary, fontFamily = Mono, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
}

// ─── Sales history: past sales + reprint ─────────────────────────────────────

@Composable
private fun HistoryDialog(s: CounterUiState, vm: CounterViewModel) {
    Dialog(onDismissRequest = vm::closeHistory, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.widthIn(max = 780.dp).fillMaxWidth(0.96f).heightIn(max = 640.dp)
                .background(CardBg, RoundedCornerShape(20.dp)).padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("SALES HISTORY", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.5.sp, color = TextPrimary)
                Text("tap a sale to view & reprint its receipt", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted, modifier = Modifier.weight(1f))
                Box(
                    Modifier.size(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp)).clickable { vm.closeHistory() },
                    contentAlignment = Alignment.Center,
                ) { Text("✕", color = TextSecondary, fontSize = 15.sp) }
            }
            Spacer(Modifier.height(12.dp))
            // Focused on open: a scanner is a keyboard, so the burst needs somewhere to land.
            // Without this the operator has to tap the field before scanning, which defeats
            // the point of holding a scanner in one hand and the receipt in the other.
            val scanFocus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { scanFocus.requestFocus() } }
            FilledInput(
                value = s.historyQuery, onValueChange = vm::setHistoryQuery,
                placeholder = "Scan a receipt, or search by number or customer…",
                modifier = Modifier.fillMaxWidth().focusRequester(scanFocus), height = 44.dp, bg = Inset, leadingSearch = true,
            )
            Spacer(Modifier.height(10.dp))
            val q = s.historyQuery.trim().lowercase()
            val rows = s.history.filter {
                q.isEmpty() || (it.number ?: "").lowercase().contains(q) || (it.customers?.name ?: "").lowercase().contains(q)
            }
            when {
                s.historyBusy -> Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) {
                    Text("Loading…", color = TextMuted, fontFamily = Barlow)
                }
                rows.isEmpty() -> Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) {
                    Text(if (q.isEmpty()) "No sales yet." else "Nothing matches \"$q\".", color = TextMuted, fontFamily = Barlow, fontSize = 13.sp)
                }
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(rows, key = { it.id }) { h ->
                        Row(
                            Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(12.dp))
                                .border(1.dp, Color(0x0F0F1A24), RoundedCornerShape(12.dp))
                                .clickable { vm.viewHistoryReceipt(h) }
                                .padding(horizontal = 13.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp),
                        ) {
                            Text(h.number ?: "—", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary, modifier = Modifier.width(88.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(h.customers?.name ?: "Walk-in", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(historyDate(h.issuedAt), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
                            }
                            HistoryStatusChip(h.status)
                            Text(formatMUR(mu.carfection.pos.core.money.rupeesToCents(h.totalIncl)), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary)
                        }
                    }
                }
            }
        }
    }
}

private fun historyDate(iso: String?): String = runCatching {
    java.time.OffsetDateTime.parse(iso!!)
        .atZoneSameInstant(java.time.ZoneOffset.ofHours(4))
        .format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy · HH:mm"))
}.getOrDefault(iso?.take(10) ?: "—")

@Composable
private fun HistoryStatusChip(status: String) {
    val (bg, fg, label) = when (status.lowercase()) {
        "paid" -> Triple(Color(0x261FA361), Success, "PAID")
        "partly_paid" -> Triple(Color(0x26C17A00), Warning, "PART-PAID")
        "voided" -> Triple(Color(0x1AD63A3A), Danger, "VOIDED")
        else -> Triple(InsetAlt, TextSecondary, "UNPAID")
    }
    Box(Modifier.height(24.dp).background(bg, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 0.5.sp, color = fg)
    }
}

@Composable
private fun ViewReceiptDialog(doc: mu.carfection.pos.core.hardware.ReceiptDoc, onPrint: () -> Unit, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ReceiptPaper(doc, Modifier.width(310.dp).heightIn(max = 520.dp).verticalScroll(rememberScrollState()))
            Row(Modifier.width(310.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(48.dp).background(CardBg, RoundedCornerShape(12.dp)).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) { Text("Close", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                Box(
                    Modifier.weight(1.4f).height(48.dp).background(Accent, RoundedCornerShape(12.dp)).clickable(onClick = onPrint),
                    contentAlignment = Alignment.Center,
                ) { Text("Print again", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, color = AccentInk) }
            }
        }
    }
}

// ─── Success ─────────────────────────────────────────────────────────────────

@Composable
private fun SaleDone(
    result: mu.carfection.pos.core.data.SaleResult,
    receipt: mu.carfection.pos.core.hardware.ReceiptDoc?,
    methodLabel: String,
    customerLabel: String,
    canVoid: Boolean,
    onPrint: () -> Unit,
    onVoid: (String?) -> Unit, // the typed reason; null where the books carry none (undo / credit note)
    onNewSale: () -> Unit,
    onDone: () -> Unit,
) {
    val receivedCents = result.totalCents + result.changeCents // what the customer handed over
    Dialog(onDismissRequest = {}, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Row(
            Modifier.widthIn(max = 960.dp).fillMaxWidth(0.97f).background(CardBg, RoundedCornerShape(22.dp)).padding(26.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            // ── left: sale complete + actions (scrolls on the small checkout tablet) ──
            Column(Modifier.weight(1.15f).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Sale complete", color = TextPrimary, fontFamily = Condensed, fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                        Text(
                            "Invoice ${result.number ?: "—"} · ${if (result.onAccount) "on account" else "paid in ${methodLabel.lowercase()}"}",
                            color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp,
                        )
                    }
                    Box(
                        Modifier.height(42.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = onDone).padding(horizontal = 15.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("←  Back to POS", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }
                }
                Spacer(Modifier.height(24.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Box(Modifier.size(8.dp).background(if (result.onAccount) Warning else Success, CircleShape))
                    Text(
                        if (result.onAccount) "RECORDED ON ACCOUNT" else "PAYMENT CONFIRMED",
                        color = if (result.onAccount) Warning else Success, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.2.sp,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(formatMUR(if (result.onAccount) result.totalCents else receivedCents), color = TextPrimary, fontFamily = Condensed, fontSize = 46.sp, fontWeight = FontWeight.Bold)
                Text(
                    // On a collect the debtor is the bill's customer, not the walk-in field.
                    if (result.onAccount) "owed by ${result.debtor ?: customerLabel} — shows on their statement" +
                        (if (result.fromCollect) " · car handed over" else "")
                    else "received from ${result.debtor ?: customerLabel} · change ${formatMUR(result.changeCents)}",
                    color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                )
                Spacer(Modifier.height(20.dp))
                // Reversing a payment or voiding a bill needs a WHY the owner can read in
                // the back office. The undo-handover and credit-note paths carry no reason
                // field in the books, so they confirm directly.
                var voidPromptOpen by remember { mutableStateOf(false) }
                var voidReason by remember { mutableStateOf("") }
                // A payment reversal (single OR split-collect) needs a typed reason; a void does too.
                val isSplitReverse = result.paymentIds.isNotEmpty() && result.fromCollect
                val voidNeedsReason = result.paymentId != null || isSplitReverse || (result.onAccount && !result.fromCollect)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // printed automatically at payment — this re-sends the same slip
                    Box(
                        Modifier.height(48.dp).background(Accent, RoundedCornerShape(12.dp)).clickable(onClick = onPrint).padding(horizontal = 20.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Print again", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp) }
                    if (canVoid) Box(
                        Modifier.height(48.dp).border(1.dp, Color(0x59D63A3A), RoundedCornerShape(12.dp))
                            .clickable { if (voidNeedsReason) voidPromptOpen = !voidPromptOpen else onVoid(null) }
                            .padding(horizontal = 18.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(when {
                        result.onAccount && result.fromCollect -> "Undo handover — job back to Ready"
                        result.onAccount -> "Void sale"
                        isSplitReverse -> "Reverse the split payment"
                        else -> "Void — refund & restock"
                    }, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
                }
                if (voidPromptOpen) {
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        voidReason, { voidReason = it },
                        label = { Text(if (result.paymentId != null) "Reason for reversing (required)" else "Reason for voiding (required)") },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Box(
                        Modifier.fillMaxWidth().height(46.dp)
                            .background(if (voidReason.isBlank()) InsetAlt else Danger, RoundedCornerShape(12.dp))
                            .clickable(enabled = voidReason.isNotBlank()) { onVoid(voidReason.trim()) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (voidReason.isBlank()) "Enter the reason above first" else "Confirm — this goes in the books",
                            color = if (voidReason.isBlank()) TextMuted else Color.White,
                            fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp,
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))
                // next sale, one tap away (mirrors the "new ticket ready" row)
                Row(
                    Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp)).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.size(38.dp).background(AccentSoft, CircleShape), contentAlignment = Alignment.Center) {
                        Text("+", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("New sale ready", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("Counter is clear — start the next customer", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp)
                    }
                    Box(
                        Modifier.height(40.dp).background(Accent, RoundedCornerShape(11.dp)).clickable(onClick = onNewSale).padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Start  →", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp) }
                }
            }
            // ── right: the slip exactly as it printed (styled paper, no stamps) ─
            Box(Modifier.weight(0.9f), contentAlignment = Alignment.TopCenter) {
                if (receipt != null) ReceiptPaper(
                    receipt,
                    Modifier.width(300.dp).heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                )
            }
        }
    }
}

private val PaperBg = Color(0xFFF7F5EF)          // warm receipt paper
private val PaperInk = Color(0xFF23201A)         // near-black print
private val PaperFaint = Color(0xFF8A8578)       // secondary print
private val PaperRule = Color(0x33231F17)        // dashed separators

/** Money as the slip prints it: "Rs 1,320.00". */
private fun rsSlip(cents: Long): String {
    val neg = cents < 0; val a = if (neg) -cents else cents
    val grouped = (a / 100).toString().reversed().chunked(3).joinToString(",").reversed()
    return (if (neg) "-" else "") + "Rs $grouped.${(a % 100).toString().padStart(2, '0')}"
}

/** Plain 2dp, NO thousands separator — the studio's slip reads "2233.00", not "Rs 2,233.00". */
private fun plainSlip(cents: Long): String {
    val neg = cents < 0; val a = if (neg) -cents else cents
    return (if (neg) "-" else "") + "${a / 100}.${(a % 100).toString().padStart(2, '0')}"
}

/** The on-screen paper slip — styled to the studio's retail receipt (no PAID stamp). */
@Composable
internal fun ReceiptPaper(d: mu.carfection.pos.core.hardware.ReceiptDoc, modifier: Modifier = Modifier) {
    Box(modifier) {
    Column(
        Modifier.fillMaxWidth().background(PaperBg, RoundedCornerShape(4.dp)).border(1.dp, Color(0x1A231F17), RoundedCornerShape(4.dp))
            .padding(horizontal = 22.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // header — the studio logo above the name, exactly as the printed slip
        d.biz.logoFile?.let { path ->
            coil.compose.AsyncImage(
                model = java.io.File(path),
                contentDescription = null,
                modifier = Modifier.fillMaxWidth().height(40.dp).padding(bottom = 6.dp),
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
            )
        }
        // The logo already carries the studio's name — printing it again duplicates it,
        // exactly as the paper slip does.
        if (d.biz.logoFile == null) {
            Text(d.biz.name.uppercase(), color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 0.5.sp, textAlign = TextAlign.Center)
        }
        // "Helvetia, 80840 Moka, MU" reads as two centred lines, as on the paper.
        d.biz.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
            val t = part.trim()
            if (t.isNotEmpty()) Text(t, color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, lineHeight = 13.sp, textAlign = TextAlign.Center)
        }

        DashRule()
        // ── the numbered sale block ─────────────────────────────────────────────
        d.ticketNo?.let {
            Text("No. $it", color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
        Text("NUM VAT INVOICE ${d.invoiceNo ?: "—"}", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, textAlign = TextAlign.Center)
        d.billNo?.let { Text("Bill $it", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, textAlign = TextAlign.Center) }
        Text(d.saleModeLabel, color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, textAlign = TextAlign.Center)
        Text(d.dateTime, color = PaperFaint, fontFamily = Mono, fontSize = 10.sp, textAlign = TextAlign.Center)
        // Who it was for — "Walk-in" when nobody was named, never blank.
        d.customer.takeIf { it.isNotBlank() }?.let {
            Text("Customer : $it", color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, textAlign = TextAlign.Center)
        }
        DashRule()
        // ── items: Qty | Designation | UP | Total ───────────────────────────────
        if (d.lines.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
                Text("Qty", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, modifier = Modifier.width(24.dp))
                Text("Designation", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, modifier = Modifier.weight(1f))
                Text("UP", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, textAlign = TextAlign.End, modifier = Modifier.width(52.dp))
                Text("Total", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, textAlign = TextAlign.End, modifier = Modifier.width(56.dp))
            }
            d.lines.forEach { l ->
                Row(Modifier.fillMaxWidth().padding(vertical = 1.dp), verticalAlignment = Alignment.Top) {
                    Text("${if (l.qty % 1.0 == 0.0) l.qty.toInt() else l.qty}", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.sp, modifier = Modifier.width(24.dp))
                    Text(l.title, color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, modifier = Modifier.weight(1f))
                    Text(plainSlip(l.unitInclCents), color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.sp, textAlign = TextAlign.End, modifier = Modifier.width(52.dp))
                    Text(plainSlip(l.inclCents), color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, textAlign = TextAlign.End, modifier = Modifier.width(56.dp))
                }
                // What this line saved — only when there was a saving.
                if (l.discountInclCents > 0) {
                    Text("Initial price : ${plainSlip(l.grossInclCents)}", color = PaperFaint, fontFamily = Mono, fontSize = 9.5.sp, modifier = Modifier.fillMaxWidth())
                    Text(
                        if (l.discountPct > 0) "Discount ${"%.1f".format(l.discountPct)}% / ${plainSlip(l.discountInclCents)}"
                        else "Discount : ${plainSlip(l.discountInclCents)}",
                        color = PaperFaint, fontFamily = Mono, fontSize = 9.5.sp, modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            DashRule()
            // ── totals: Subtotal is PRE-discount, so the saving is visible ───────
            SlipRow("    Subtotal :", plainSlip(d.subtotalCents))
            if (d.discountCents > 0) SlipRow("    Discount :", plainSlip(d.discountCents))
        }
        Text("Total: ${plainSlip(d.totalCents)}Rs", color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 5.dp))
        if (d.lines.isNotEmpty()) {
            Text("excl. VAT : ${plainSlip(d.totalCents - d.vatCents)}Rs", color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, textAlign = TextAlign.Center)
        }
        DashRule()
        // ── tenders ─────────────────────────────────────────────────────────────
        if (d.onAccount) Text("1   ON ACCOUNT : ${plainSlip(d.totalCents)}Rs", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, modifier = Modifier.fillMaxWidth())
        else if (d.payments.size > 1) {
            d.payments.forEach { p ->
                Text("1   ${p.method.uppercase()} ${p.dateTime} : ${plainSlip(p.amountCents)}Rs", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, modifier = Modifier.fillMaxWidth())
            }
        } else {
            Text("1   ${(d.payLabel ?: "PAID").uppercase()} : ${plainSlip(d.paidCents)}Rs", color = PaperInk, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, modifier = Modifier.fillMaxWidth())
            if (d.changeCents > 0) SlipRow("    Change :", plainSlip(d.changeCents))
        }
        // A deposit is only half a story without the half still to pay.
        if (d.balanceDueCents > 0) SlipRow("    BALANCE DUE :", plainSlip(d.balanceDueCents), strong = true)
        DashRule()
        // ── tax breakdown ───────────────────────────────────────────────────────
        if (d.lines.isNotEmpty()) {
            val groups = d.vatGroups.ifEmpty {
                listOf(mu.carfection.pos.core.hardware.ReceiptVatGroup(d.vatRatePct.toDouble(), d.totalCents - d.vatCents, d.vatCents))
            }
            groups.forEach { g ->
                Text("${g.label} : ${plainSlip(g.vatCents)}Rs", color = PaperInk, fontFamily = Mono, fontSize = 10.sp, modifier = Modifier.fillMaxWidth())
                Text("excl. VAT = ${plainSlip(g.baseCents)}Rs / Incl. tax = ${plainSlip(g.inclCents)}Rs", color = PaperFaint, fontFamily = Mono, fontSize = 9.5.sp, modifier = Modifier.fillMaxWidth())
            }
            DashRule()
        }
        // ── fiscal footer ───────────────────────────────────────────────────────
        Text(d.footer, color = PaperInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp, textAlign = TextAlign.Center)
        d.duplicataNo?.let {
            Text("Duplicata $it" + (d.duplicataAt?.let { at -> " - $at" } ?: ""), color = PaperFaint, fontFamily = Mono, fontSize = 9.5.sp, textAlign = TextAlign.Center)
        }
        d.terminalNo?.let { Text("Appareil $it", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, textAlign = TextAlign.Center) }
        d.biz.brn?.takeIf { it.isNotBlank() }?.let { Text("BRN : $it", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, textAlign = TextAlign.Center) }
        d.biz.vatNo?.takeIf { it.isNotBlank() }?.let { Text("VAT number : ${it.removePrefix("VAT").trim()}", color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, textAlign = TextAlign.Center) }
        Text(d.cashier, color = PaperFaint, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 10.dp))
        // barcode of the invoice number, captioned like the web card ("INV-0004 · 18072026")
        d.invoiceNo?.let { no ->
            Barcode128(no, Modifier.fillMaxWidth().height(44.dp))
            Text(d.codeLabel ?: no, color = PaperInk, fontFamily = Mono, fontSize = 10.sp, letterSpacing = 1.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
    // The web card's VOID stamp, same geometry — a dead invoice must read dead.
    if (d.voided) {
        Text(
            "VOID",
            color = Color(0xFFC8452F),
            fontFamily = Barlow,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 17.sp,
            letterSpacing = 2.sp,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 92.dp, end = 20.dp)
                .graphicsLayer { rotationZ = -13f; alpha = 0.82f }
                .border(2.5.dp, Color(0xFFC8452F), RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
    }
}

@Composable
private fun SlipRow(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, color = if (strong) PaperInk else PaperFaint, fontFamily = Barlow, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Medium, fontSize = 11.5.sp, modifier = Modifier.weight(1f))
        Text(value, color = PaperInk, fontFamily = Mono, fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal, fontSize = 11.sp)
    }
}

@Composable
private fun DashRule() {
    Canvas(Modifier.fillMaxWidth().height(1.dp).padding(vertical = 0.dp)) {
        val dash = 5f; val gap = 4f; var x = 0f
        while (x < size.width) { drawLine(PaperRule, Offset(x, 0f), Offset((x + dash).coerceAtMost(size.width), 0f), 1.5f); x += dash + gap }
    }
    Spacer(Modifier.height(7.dp))
}

/** Real Code128-B barcode of [data], drawn as bars (scannable; matches the till-slip look). */
@Composable
private fun Barcode128(data: String, modifier: Modifier = Modifier) {
    val widths = remember(data) { code128B(data) }
    Canvas(modifier) {
        val unit = size.width / widths.sum().toFloat()
        var x = 0f; var dark = true
        widths.forEach { w ->
            val bw = w * unit
            if (dark) drawRect(PaperInk, Offset(x, 0f), androidx.compose.ui.geometry.Size(bw, size.height))
            x += bw; dark = !dark
        }
    }
}

/** Code128-B bar/space widths (module counts) for an ASCII string. */
private fun code128B(input: String): List<Int> {
    val values = ArrayList<Int>()
    values += 104 // Start B
    var sum = 104; var pos = 1
    input.forEach { c ->
        val v = (c.code - 32).coerceIn(0, 94)
        values += v; sum += v * pos; pos++
    }
    values += sum % 103 // checksum
    values += 106 // stop
    val out = ArrayList<Int>()
    values.forEach { v -> CODE128_PATTERNS[v].forEach { out += it - '0' } }
    return out
}

/** Canonical Code128 module-width patterns, index 0..106 (Start B = 104, Stop = 106). */
private val CODE128_PATTERNS = listOf(
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
)
