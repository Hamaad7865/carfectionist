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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import mu.carfection.pos.ui.theme.Amber
import mu.carfection.pos.ui.theme.Gold
import mu.carfection.pos.ui.theme.Ink
import mu.carfection.pos.ui.theme.Line
import mu.carfection.pos.ui.theme.Mint
import mu.carfection.pos.ui.theme.Rose
import mu.carfection.pos.ui.theme.Surface1
import mu.carfection.pos.ui.theme.Surface2
import mu.carfection.pos.ui.theme.TextHi
import mu.carfection.pos.ui.theme.TextLow
import mu.carfection.pos.ui.theme.TextMid

@Composable
fun CounterScreen(
    onOpenTill: () -> Unit,
    viewModel: CounterViewModel = hiltViewModel(),
) {
    val s by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize().background(Ink).padding(14.dp)) {
        // ── top bar ──────────────────────────────────────────────────────────
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("COUNTER SALE", color = TextHi, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp)
            Spacer(Modifier.width(16.dp))
            val till = s.till
            Chip(
                text = if (till != null) "Till open · float ${formatMUR((till.openingFloat * 100).toLong())}" else "Till closed — open it",
                color = if (till != null) Mint else Amber,
                onClick = onOpenTill,
            )
            Spacer(Modifier.weight(1f))
            Chip(text = "Sign out", color = TextLow, onClick = { viewModel.signOut() })
        }
        Spacer(Modifier.height(12.dp))

        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // ── left: search + product grid ──────────────────────────────────
            Column(Modifier.weight(1.15f).fillMaxHeight().background(Surface1, RoundedCornerShape(16.dp)).padding(12.dp)) {
                OutlinedTextField(
                    value = s.query,
                    onValueChange = viewModel::setQuery,
                    placeholder = { Text("Search products or scan a barcode…", color = TextLow) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = TextLow) },
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
                                .background(Surface2, RoundedCornerShape(12.dp))
                                .border(1.dp, if (inCart != null) Gold else Line, RoundedCornerShape(12.dp))
                                .clickable { viewModel.add(p) }
                                .padding(10.dp)
                                .height(84.dp),
                        ) {
                            Row {
                                Text(p.kind.uppercase(), color = TextLow, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                Spacer(Modifier.weight(1f))
                                if (inCart != null) Box(
                                    Modifier.size(20.dp).background(Gold, CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) { Text(inCart.toInt().toString(), color = Ink, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                            }
                            Text(p.name, color = TextHi, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.weight(1f))
                            Text(formatMUR(p.sellingPriceCents), color = Gold, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                        }
                    }
                }
            }

            // ── right: customer + cart + totals + charge ─────────────────────
            Column(Modifier.weight(0.85f).fillMaxHeight().background(Surface1, RoundedCornerShape(16.dp)).padding(12.dp)) {
                OutlinedTextField(
                    value = s.customerText,
                    onValueChange = viewModel::setCustomerText,
                    placeholder = { Text(if (s.method == PayMethod.CREDIT) "Pick the customer (required for credit)" else "Customer (optional)", color = TextLow) },
                    singleLine = true,
                    trailingIcon = { if (s.customerId != null) Icon(Icons.Default.Check, null, tint = Mint) },
                    modifier = Modifier.fillMaxWidth(),
                )
                s.customerMatches.forEach { c ->
                    Text(
                        c.name,
                        color = TextHi,
                        fontSize = 14.sp,
                        modifier = Modifier.fillMaxWidth().clickable { viewModel.pickCustomer(c) }.padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))

                LazyColumn(Modifier.weight(1f)) {
                    items(s.cart, key = { it.product.id }) { l ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(l.product.name, color = TextHi, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(formatMUR(l.product.sellingPriceCents) + " each", color = TextLow, fontSize = 11.sp)
                            }
                            Stepper(l.qty.toInt(), onMinus = { viewModel.setQty(l.product.id, l.qty - 1) }, onPlus = { viewModel.setQty(l.product.id, l.qty + 1) })
                            Spacer(Modifier.width(8.dp))
                            Text(
                                formatMUR((l.product.sellingPriceCents * l.qty).toLong()),
                                color = TextHi, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(92.dp), textAlign = TextAlign.End,
                            )
                            Icon(
                                Icons.Default.Close, null, tint = TextLow,
                                modifier = Modifier.padding(start = 6.dp).size(18.dp).clickable { viewModel.setQty(l.product.id, 0.0) },
                            )
                        }
                    }
                }
                if (s.cart.isEmpty()) Text("Tap products to build the sale.", color = TextLow, fontSize = 13.sp, modifier = Modifier.padding(vertical = 20.dp))

                // totals
                TotalRow("Subtotal", formatMUR(s.totals.subtotalCents), TextMid)
                TotalRow("VAT", formatMUR(s.totals.vatCents), TextMid)
                TotalRow("TOTAL", formatMUR(s.totals.totalCents), TextHi, big = true)
                s.error?.takeUnless { s.padOpen }?.let { Text(it, color = Rose, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .background(if (s.cart.isEmpty()) Surface2 else Gold, RoundedCornerShape(14.dp))
                        .clickable(enabled = s.cart.isNotEmpty()) { viewModel.openPad() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Charge ${formatMUR(s.totals.totalCents)}",
                        color = if (s.cart.isEmpty()) TextLow else Ink,
                        fontSize = 17.sp, fontWeight = FontWeight.ExtraBold,
                    )
                }
            }
        }
    }

    if (s.padOpen) PaymentPad(s, viewModel)
    s.done?.let { SaleDone(it, onNewSale = viewModel::newSale) }
}

@Composable
private fun Chip(text: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Box(
        Modifier
            .background(Surface2, RoundedCornerShape(19.dp))
            .border(1.dp, Line, RoundedCornerShape(19.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun Stepper(qty: Int, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(28.dp).background(Surface2, RoundedCornerShape(7.dp)).clickable(onClick = onMinus), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Remove, null, tint = TextHi, modifier = Modifier.size(14.dp))
        }
        Text(qty.toString(), color = TextHi, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp), textAlign = TextAlign.Center)
        Box(Modifier.size(28.dp).background(Surface2, RoundedCornerShape(7.dp)).clickable(onClick = onPlus), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Add, null, tint = TextHi, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun TotalRow(label: String, value: String, color: androidx.compose.ui.graphics.Color, big: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, color = color, fontSize = if (big) 16.sp else 13.sp, fontWeight = if (big) FontWeight.ExtraBold else FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(value, color = if (big) Gold else color, fontSize = if (big) 18.sp else 13.sp, fontWeight = FontWeight.ExtraBold)
    }
}

// ─── The fast payment pad ─────────────────────────────────────────────────────
// Opens pre-filled: Cash + exact amount (tender mirrors the total → change 0 and
// already valid). Exact cash = 2 taps. Cash w/ change = 3 (chip → Record).

@Composable
private fun PaymentPad(s: CounterUiState, vm: CounterViewModel) {
    Dialog(onDismissRequest = vm::closePad, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .width(640.dp)
                .background(Surface1, RoundedCornerShape(22.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("TAKE PAYMENT", color = TextHi, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.5.sp)
                Spacer(Modifier.weight(1f))
                Text("Due ${formatMUR(s.totals.totalCents)}", color = Amber, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }

            // method chips
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                PayMethod.entries.forEach { m ->
                    val sel = s.method == m
                    Box(
                        Modifier
                            .weight(1f)
                            .height(46.dp)
                            .background(if (sel) Gold.copy(alpha = 0.15f) else Surface2, RoundedCornerShape(12.dp))
                            .border(1.5.dp, if (sel) Gold else Line, RoundedCornerShape(12.dp))
                            .clickable { vm.setMethod(m) },
                        contentAlignment = Alignment.Center,
                    ) { Text(m.label, color = if (sel) Gold else TextMid, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                // left: amount / tender / change or ref
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DisplayCard("AMOUNT", formatMUR(s.totals.totalCents))
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
                                Text("Change", color = TextMid, fontSize = 14.sp)
                                Spacer(Modifier.weight(1f))
                                Text(formatMUR(s.changeCents), color = Mint, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                            }
                        }
                        PayMethod.CREDIT -> {
                            Text(
                                if (s.customerId != null) "On account for ${s.customerText} — ${formatMUR(s.totals.totalCents)} recorded as owed."
                                else "Pick an existing customer on the sale screen first — the amount owed is tracked against them.",
                                color = Amber, fontSize = 13.sp, lineHeight = 18.sp,
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
                                }, color = TextLow) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text("Run it on the terminal / app first — the POS records the reference.", color = TextLow, fontSize = 12.sp)
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
                                            .background(Surface2, RoundedCornerShape(12.dp))
                                            .clickable { vm.padKey(k) },
                                        contentAlignment = Alignment.Center,
                                    ) { Text(k, color = TextHi, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
                                }
                            }
                        }
                    }
                }
            }

            s.error?.let { Text(it, color = Rose, fontSize = 13.sp) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.weight(1f).height(54.dp).background(Surface2, RoundedCornerShape(13.dp)).clickable(onClick = vm::closePad),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextMid, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Box(
                    Modifier
                        .weight(2f)
                        .height(54.dp)
                        .background(if (s.canRecord) Gold else Surface2, RoundedCornerShape(13.dp))
                        .clickable(enabled = s.canRecord) { vm.record() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (s.busy) "Recording…" else if (s.method == PayMethod.CREDIT) "Put ${formatMUR(s.totals.totalCents)} on account" else "Record ${formatMUR(s.totals.totalCents)}",
                        color = if (s.canRecord) Ink else TextLow, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold,
                    )
                }
            }
        }
    }
}

@Composable
private fun DisplayCard(label: String, value: String, highlight: Boolean = false) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Surface2, RoundedCornerShape(12.dp))
            .border(1.5.dp, if (highlight) Gold.copy(alpha = 0.65f) else Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = TextLow, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        Text(value, color = TextHi, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun QuickChip(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .height(36.dp)
            .background(Surface2, RoundedCornerShape(10.dp))
            .border(1.dp, Line, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = TextHi, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
}

// ─── Success ─────────────────────────────────────────────────────────────────

@Composable
private fun SaleDone(result: mu.carfection.pos.core.data.SaleResult, onNewSale: () -> Unit) {
    Dialog(onDismissRequest = {}) {
        Column(
            Modifier.width(400.dp).background(Surface1, RoundedCornerShape(22.dp)).padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(56.dp).background(Mint.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Check, null, tint = Mint, modifier = Modifier.size(30.dp))
            }
            Text(if (result.onAccount) "Recorded on account" else "Sale complete", color = TextHi, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            Text(result.number ?: "Invoice", color = TextMid, fontSize = 13.sp)
            Text(formatMUR(result.totalCents), color = TextHi, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
            if (result.onAccount) {
                Text("${formatMUR(result.totalCents)} owed — shows on the customer's statement", color = Amber, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            } else if (result.changeCents > 0) {
                Text("CHANGE ${formatMUR(result.changeCents)}", color = Mint, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(Modifier.height(6.dp))
            Box(
                Modifier.fillMaxWidth().height(52.dp).background(Gold, RoundedCornerShape(13.dp)).clickable(onClick = onNewSale),
                contentAlignment = Alignment.Center,
            ) { Text("New sale", color = Ink, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold) }
        }
    }
}
