package mu.carfection.pos.feature.counter

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.money.formatMUR
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

    Column(Modifier.fillMaxSize().background(ScreenBg).padding(14.dp)) {
        // ── top bar ──────────────────────────────────────────────────────────
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (s.mode == CheckoutMode.WALKIN) {
                Box(
                    Modifier.size(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp)).clickable { viewModel.backToList() },
                    contentAlignment = Alignment.Center,
                ) { Text("←", color = TextSecondary, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(12.dp))
            }
            Text(if (s.mode == CheckoutMode.WALKIN) "New counter sale" else "Checkout", color = TextPrimary, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
            Spacer(Modifier.width(16.dp))
            val till = s.till
            Chip(
                text = if (till != null) "Till open · float ${formatMUR((till.openingFloat * 100).toLong())}" else "Till closed — open it",
                color = if (till != null) Success else Warning,
                onClick = onOpenTill,
            )
        }
        Spacer(Modifier.height(12.dp))

        if (s.mode == CheckoutMode.LIST) CollectList(s, viewModel)
        else Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // ── left: search + product grid ──────────────────────────────────
            Column(
                Modifier.weight(1.15f).fillMaxHeight()
                    .background(CardBg, RoundedCornerShape(16.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(16.dp))
                    .padding(12.dp),
            ) {
                OutlinedTextField(
                    value = s.query,
                    onValueChange = viewModel::setQuery,
                    placeholder = { Text("Search products or scan a barcode…", color = TextMuted) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = TextMuted) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 150.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(s.products, key = { it.id }) { p ->
                        val inCart = s.cart.firstOrNull { it.product.id == p.id }?.qty
                        Column(
                            Modifier
                                .background(Tile, RoundedCornerShape(12.dp))
                                .border(1.dp, if (inCart != null) AccentLine else Hairline, RoundedCornerShape(12.dp))
                                .clickable { viewModel.add(p) }
                                .padding(10.dp)
                                .height(84.dp),
                        ) {
                            Row {
                                Text(p.kind.uppercase(), color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                Spacer(Modifier.weight(1f))
                                if (inCart != null) Box(
                                    Modifier.size(20.dp).background(Accent, CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) { Text(inCart.toInt().toString(), color = AccentInk, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                            }
                            Text(p.name, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.weight(1f))
                            Text(formatMUR(p.sellingPriceCents), color = TextPrimary, fontFamily = Mono, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // ── right: customer + cart + totals + charge ─────────────────────
            Column(
                Modifier.weight(0.85f).fillMaxHeight()
                    .background(CardBg, RoundedCornerShape(16.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(16.dp))
                    .padding(12.dp),
            ) {
                OutlinedTextField(
                    value = s.customerText,
                    onValueChange = viewModel::setCustomerText,
                    placeholder = { Text(if (s.method == PayMethod.CREDIT) "Pick the customer (required for credit)" else "Customer (optional)", color = TextMuted) },
                    singleLine = true,
                    trailingIcon = { if (s.customerId != null) Icon(Icons.Default.Check, null, tint = Success) },
                    modifier = Modifier.fillMaxWidth(),
                )
                s.customerMatches.forEach { c ->
                    Text(
                        c.name,
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.fillMaxWidth().clickable { viewModel.pickCustomer(c) }.padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))

                LazyColumn(Modifier.weight(1f)) {
                    items(s.cart, key = { it.product.id }) { l ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(l.product.name, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(formatMUR(l.product.sellingPriceCents) + " each", color = TextMuted, fontFamily = Mono, fontSize = 11.sp)
                            }
                            Stepper(l.qty.toInt(), onMinus = { viewModel.setQty(l.product.id, l.qty - 1) }, onPlus = { viewModel.setQty(l.product.id, l.qty + 1) })
                            Spacer(Modifier.width(8.dp))
                            Text(
                                formatMUR((l.product.sellingPriceCents * l.qty).toLong()),
                                color = TextPrimary, fontFamily = Mono, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(92.dp), textAlign = TextAlign.End,
                            )
                            Icon(
                                Icons.Default.Close, null, tint = TextMuted,
                                modifier = Modifier.padding(start = 6.dp).size(18.dp).clickable { viewModel.setQty(l.product.id, 0.0) },
                            )
                        }
                    }
                }
                if (s.cart.isEmpty()) Text("Tap products to build the sale.", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 20.dp))

                // totals
                TotalRow("Subtotal", formatMUR(s.totals.subtotalCents), TextSecondary)
                TotalRow("VAT 15%", formatMUR(s.totals.vatCents), TextSecondary)
                TotalRow("TOTAL", formatMUR(s.totals.totalCents), TextPrimary, big = true)
                s.error?.takeUnless { s.padOpen }?.let { Text(it, color = Danger, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .background(if (s.cart.isEmpty()) InsetAlt else Accent, RoundedCornerShape(14.dp))
                        .clickable(enabled = s.cart.isNotEmpty()) { viewModel.openPad() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Record payment · ${formatMUR(s.totals.totalCents)}",
                        color = if (s.cart.isEmpty()) TextMuted else AccentInk,
                        fontSize = 16.5.sp, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }

    if (s.padOpen) PaymentPad(s, viewModel)
    s.done?.let { SaleDone(it, onDone = viewModel::backToList) }
    s.paymentAction?.let { PaymentActionDialog(it, viewModel) }
    s.notice?.let { Notice(it, onGone = viewModel::clearNotice) }
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
                    val remaining = ((b.totalIncl - b.amountPaid) * 100).toLong()
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
            Text("PAID TODAY", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp)
            Spacer(Modifier.height(8.dp))
            if (s.paidToday.isEmpty()) {
                Text("No payments yet today.", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 18.dp))
            } else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
                        Text(formatMUR((p.amount * 100).toLong()), color = TextPrimary, fontFamily = Mono, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
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

@Composable
private fun PaymentPad(s: CounterUiState, vm: CounterViewModel) {
    Dialog(onDismissRequest = vm::closePad, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .width(640.dp)
                .background(CardBg, RoundedCornerShape(22.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Record payment", color = TextPrimary, fontFamily = Condensed, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                s.collect?.let {
                    Spacer(Modifier.width(10.dp))
                    Text("${it.number ?: "Invoice"} · ${it.customers?.name ?: ""}", color = TextMuted, fontFamily = Mono, fontSize = 13.sp)
                }
                Spacer(Modifier.weight(1f))
                Text("Due ${formatMUR(s.dueCents)}", color = Warning, fontFamily = Mono, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }

            // method chips (credit is walk-in only — you can't put an existing invoice on account)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                (if (s.collect != null) PayMethod.entries.filter { it != PayMethod.CREDIT } else PayMethod.entries).forEach { m ->
                    val sel = s.method == m
                    Box(
                        Modifier
                            .weight(1f)
                            .height(46.dp)
                            .background(if (sel) AccentSoft else InsetAlt, RoundedCornerShape(12.dp))
                            .border(1.5.dp, if (sel) AccentLine else Hairline, RoundedCornerShape(12.dp))
                            .clickable { vm.setMethod(m) },
                        contentAlignment = Alignment.Center,
                    ) { Text(m.label, color = if (sel) Accent else TextSecondary, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                // left: amount / tender / change or ref
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DisplayCard("AMOUNT", formatMUR(s.dueCents))
                    when (s.method) {
                        PayMethod.CASH -> {
                            DisplayCard("CASH TENDERED", formatMUR(s.effectiveTenderCents), highlight = true)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                QuickChip("Exact") { vm.setTenderCents(s.totals.totalCents) }
                                s.quickTenders.forEach { cents ->
                                    QuickChip(formatMUR(cents).removePrefix("Rs ").substringBefore(".")) { vm.setTenderCents(cents) }
                                }
                            }
                            Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("Change", color = TextSecondary, fontSize = 14.sp)
                                Spacer(Modifier.weight(1f))
                                Text(formatMUR(s.changeCents), color = Success, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        PayMethod.CREDIT -> {
                            Text(
                                if (s.customerId != null) "On account for ${s.customerText} — ${formatMUR(s.dueCents)} recorded as owed."
                                else "Pick an existing customer on the sale screen first — the amount owed is tracked against them.",
                                color = Warning, fontSize = 13.sp, lineHeight = 18.sp,
                            )
                        }
                        else -> {
                            OutlinedTextField(
                                value = s.refText,
                                onValueChange = vm::setRef,
                                placeholder = { Text(when (s.method) {
                                    PayMethod.CARD -> "Terminal ref — e.g. T-88291"
                                    PayMethod.JUICE -> "Juice ref — e.g. JU-55214"
                                    else -> "Transfer ref — e.g. MCB-2214"
                                }, color = TextMuted) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text("Run it on the terminal / app first — the POS records the reference.", color = TextMuted, fontSize = 12.sp)
                        }
                    }
                }
                // right: numpad (cash only)
                if (s.method == PayMethod.CASH) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(".", "0", "⌫")).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                row.forEach { k ->
                                    Box(
                                        Modifier
                                            .weight(1f)
                                            .height(54.dp)
                                            .background(InsetAlt, RoundedCornerShape(12.dp))
                                            .clickable { vm.padKey(k) },
                                        contentAlignment = Alignment.Center,
                                    ) { Text(k, color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
                                }
                            }
                        }
                    }
                }
            }

            s.error?.let { Text(it, color = Danger, fontSize = 13.sp) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.weight(1f).height(54.dp).background(InsetAlt, RoundedCornerShape(13.dp)).clickable(onClick = vm::closePad),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Box(
                    Modifier
                        .weight(2f)
                        .height(54.dp)
                        .background(if (s.canRecord) Accent else InsetAlt, RoundedCornerShape(13.dp))
                        .clickable(enabled = s.canRecord) { vm.confirm() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (s.busy) "Recording…" else if (s.method == PayMethod.CREDIT) "Put ${formatMUR(s.dueCents)} on account" else "Record ${formatMUR(s.dueCents)}",
                        color = if (s.canRecord) AccentInk else TextMuted, fontSize = 15.5.sp, fontWeight = FontWeight.Bold,
                    )
                }
            }
            // owner/manager: void an unpaid invoice instead of collecting
            s.collect?.takeIf { it.status == "issued" && vm.canManage }?.let { bill ->
                Box(Modifier.fillMaxWidth().clickable { vm.voidInvoice(bill) }.padding(top = 2.dp), contentAlignment = Alignment.Center) {
                    Text("Void this invoice", color = Danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

// ─── Corrections: reverse a payment / issue a credit note (owner-manager) ─────
@Composable
private fun PaymentActionDialog(p: mu.carfection.pos.core.network.TodayPaymentDto, vm: CounterViewModel) {
    Dialog(onDismissRequest = vm::closePaymentAction) {
        Column(
            Modifier.width(440.dp).background(CardBg, RoundedCornerShape(22.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Correct this payment", color = TextPrimary, fontFamily = Condensed, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text("${p.documents?.number ?: "Invoice"} · ${p.documents?.customers?.name ?: "—"} · ${formatMUR((p.amount * 100).toLong())}", color = TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(2.dp))
            ActionButton("Refund — issue credit note", "Reverses the whole invoice and restocks any products.", Accent, AccentInk) { vm.refundInvoice(p) }
            ActionButton("Reverse this payment only", "Undoes just this payment; the invoice becomes unpaid again.", InsetAlt, TextPrimary) { vm.reverseThisPayment(p) }
            Box(
                Modifier.fillMaxWidth().height(48.dp).clickable(onClick = vm::closePaymentAction),
                contentAlignment = Alignment.Center,
            ) { Text("Cancel", color = TextSecondary, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
private fun ActionButton(title: String, sub: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(bg, RoundedCornerShape(13.dp)).clickable(onClick = onClick).padding(horizontal = 15.dp, vertical = 12.dp),
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
private fun DisplayCard(label: String, value: String, highlight: Boolean = false) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Inset, RoundedCornerShape(12.dp))
            .border(1.5.dp, if (highlight) AccentLine else Hairline, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        Text(value, color = TextPrimary, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold)
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

// ─── Success ─────────────────────────────────────────────────────────────────

@Composable
private fun SaleDone(result: mu.carfection.pos.core.data.SaleResult, onDone: () -> Unit) {
    Dialog(onDismissRequest = {}) {
        Column(
            Modifier.width(400.dp).background(CardBg, RoundedCornerShape(22.dp)).padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(56.dp).background(Success.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Check, null, tint = Success, modifier = Modifier.size(30.dp))
            }
            Text(if (result.onAccount) "Recorded on account" else "Paid in full", color = TextPrimary, fontFamily = Condensed, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(result.number ?: "Invoice", color = TextSecondary, fontFamily = Mono, fontSize = 13.sp)
            Text(formatMUR(result.totalCents), color = TextPrimary, fontFamily = Condensed, fontSize = 36.sp, fontWeight = FontWeight.Bold)
            if (result.onAccount) {
                Text("${formatMUR(result.totalCents)} owed — shows on the customer's statement", color = Warning, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            } else if (result.changeCents > 0) {
                Text("CHANGE ${formatMUR(result.changeCents)}", color = Success, fontFamily = Condensed, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(6.dp))
            Box(
                Modifier.fillMaxWidth().height(52.dp).background(Accent, RoundedCornerShape(13.dp)).clickable(onClick = onDone),
                contentAlignment = Alignment.Center,
            ) { Text("Done", color = AccentInk, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
        }
    }
}
