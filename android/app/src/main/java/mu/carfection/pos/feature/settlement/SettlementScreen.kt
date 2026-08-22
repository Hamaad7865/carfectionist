package mu.carfection.pos.feature.settlement

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.pointsValueCents
import mu.carfection.pos.feature.counter.ReceiptPaper
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Tile

@Composable
fun SettlementScreen(onBack: () -> Unit, viewModel: SettlementViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    val pointValueRupees by viewModel.pointValueRupees.collectAsState()
    val pointsEnabled by viewModel.pointsEnabled.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() } // refresh every time Settlement is (re)opened

    Column(Modifier.fillMaxSize().background(ScreenBg).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.height(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp))
                    .clickable {
                        when {
                            s.completedReceipts.isNotEmpty() -> viewModel.dismissReceipts()
                            s.openCustomerId != null -> viewModel.closeCustomer()
                            else -> onBack()
                        }
                    }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) { Text("←  Back", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("SETTLE ACCOUNT", color = TextPrimary, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                Text(
                    if (s.openCustomerId == null) "Pick a customer who owes the shop" else "Choose invoices, then take one payment",
                    color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp,
                )
            }
        }
        Spacer(Modifier.height(14.dp))

        when {
            s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent) }
            s.error != null -> Text(s.error ?: "", color = Danger, fontFamily = Barlow, modifier = Modifier.padding(16.dp))
            s.openCustomerId == null -> CustomerBalanceList(customerBalances(settleableInvoices(s.invoices)), onPick = viewModel::openCustomer)
            else -> SettleInvoicesPanel(
                invoices = settleableInvoices(s.invoices).filter { it.customerId == s.openCustomerId },
                state = s, pointValueRupees = pointValueRupees, pointsEnabled = pointsEnabled, vm = viewModel,
            )
        }
    }

    // A floating dialog over whatever's underneath — same pattern as CounterScreen's
    // Sale-complete dialog, dimmed scrim included — not inline content replacing the screen.
    if (s.completedReceipts.isNotEmpty()) SettlementCompleteDialog(s, viewModel)
}

private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val text = if (parts.size > 1) "${parts[0].first()}${parts[1].first()}" else name.take(2)
    return text.uppercase()
}

@Composable
private fun CustomerBalanceList(balances: List<CustomerBalance>, onPick: (String) -> Unit) {
    if (balances.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No customer owes anything right now.", color = TextMuted, fontFamily = Barlow, fontSize = 13.5.sp)
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(balances, key = { it.customerId }) { b ->
            Row(
                Modifier.fillMaxWidth()
                    .background(CardBg, RoundedCornerShape(14.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(14.dp))
                    .clickable { onPick(b.customerId) }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(42.dp).background(AccentSoft, CircleShape), contentAlignment = Alignment.Center) {
                    Text(initials(b.customerName), color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(b.customerName, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp)
                    Text("Owes the shop", color = TextMuted, fontFamily = Barlow, fontSize = 11.5.sp)
                }
                Text(formatMUR(b.outstandingCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Spacer(Modifier.width(10.dp))
                Box(Modifier.height(34.dp).background(Accent, RoundedCornerShape(9.dp)).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text("Settle", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                }
            }
        }
    }
}

@Composable
private fun MethodChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .background(if (selected) Accent else InsetAlt, RoundedCornerShape(10.dp))
            .border(1.dp, if (selected) Accent else Hairline, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) { Text(label, color = if (selected) AccentInk else TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
}

@Composable
private fun SettleInvoicesPanel(
    invoices: List<SettleableInvoice>,
    state: SettlementState,
    pointValueRupees: Double,
    pointsEnabled: Boolean,
    vm: SettlementViewModel,
) {
    val selected = invoices.filter { it.id in state.checked }
    val totalDueCents = selected.sumOf { it.outstandingCents }
    val pointsCapCents = if (pointsEnabled && selected.isNotEmpty())
        minOf(totalDueCents, pointsValueCents(selected.first().customerPointsBalance, pointValueRupees))
    else 0L
    val pointsAppliedCents = if (state.pointsApplied) (parseMoneyToCents(state.pointsText) ?: 0L).coerceIn(0, pointsCapCents) else 0L
    val methodDueCents = (totalDueCents - pointsAppliedCents).coerceAtLeast(0)
    val tenderedCents = parseMoneyToCents(state.tenderedText)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // ── invoice list ──
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("${invoices.size} OPEN INVOICE${if (invoices.size == 1) "" else "S"}", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
            Text("Select all", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, modifier = Modifier.clickable(onClick = vm::selectAll))
        }
        Column(
            Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp)),
        ) {
            invoices.forEachIndexed { i, inv ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
                val checked = inv.id in state.checked
                Row(
                    Modifier.fillMaxWidth().clickable { vm.toggleInvoice(inv.id) }.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(22.dp).background(if (checked) Accent else Color.Transparent, RoundedCornerShape(6.dp))
                            .border(1.5.dp, if (checked) Accent else Hairline, RoundedCornerShape(6.dp)),
                        contentAlignment = Alignment.Center,
                    ) { if (checked) Text("✓", color = AccentInk, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(inv.number ?: "—", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
                        Text(inv.issueDate ?: "—", color = TextMuted, fontFamily = Barlow, fontSize = 11.sp)
                    }
                    Text(formatMUR(inv.outstandingCents), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                }
            }
        }

        if (selected.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp)).padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Total due", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(formatMUR(totalDueCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp)
            }

            if (pointsCapCents > 0) {
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth()
                        .background(if (state.pointsApplied) AccentSoft else InsetAlt, RoundedCornerShape(12.dp))
                        .border(1.dp, if (state.pointsApplied) Accent else Hairline, RoundedCornerShape(12.dp))
                        .clickable(onClick = vm::togglePoints)
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (state.pointsApplied) "${formatMUR(pointsAppliedCents)} in points off this settlement" else "Apply loyalty points",
                            color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        )
                        Text(
                            if (state.pointsApplied) "Tap to remove" else "Worth up to ${formatMUR(pointsCapCents)}",
                            color = TextMuted, fontFamily = Barlow, fontSize = 11.5.sp,
                        )
                    }
                    Text(if (state.pointsApplied) "APPLIED" else "APPLY", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.8.sp)
                }
                if (state.pointsApplied) {
                    Spacer(Modifier.height(8.dp))
                    FilledInput(value = state.pointsText, onValueChange = vm::setPointsText, placeholder = "Points to use (Rs)", modifier = Modifier.fillMaxWidth(), bg = InsetAlt)
                }
            }

            Spacer(Modifier.height(14.dp))
            Text("METHOD", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK).forEach { m ->
                    MethodChip(m.label, state.method == m) { vm.setMethod(m) }
                }
            }

            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.fillMaxWidth().background(InsetAlt, RoundedCornerShape(12.dp)).padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Amount due", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
                Text(formatMUR(methodDueCents), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp)
            }

            if (state.method == PayMethod.CASH) {
                Spacer(Modifier.height(10.dp))
                FilledInput(value = state.tenderedText, onValueChange = vm::setTendered, placeholder = "Tendered (Rs ${"%.2f".format(methodDueCents / 100.0)})", modifier = Modifier.fillMaxWidth())
                if (tenderedCents != null) {
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Change", color = TextMuted, fontFamily = Barlow, fontSize = 12.5.sp)
                        val change = tenderedCents - methodDueCents
                        Text(formatMUR(change.coerceAtLeast(0)), color = if (change < 0) Danger else TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            } else if (methodDueCents > 0) {
                Spacer(Modifier.height(10.dp))
                FilledInput(value = state.ref, onValueChange = vm::setRef, placeholder = "External reference", modifier = Modifier.fillMaxWidth())
            }

            state.submitError?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = Danger, fontFamily = Barlow, fontSize = 12.5.sp)
            }

            Spacer(Modifier.height(16.dp))
            Box(
                Modifier.fillMaxWidth().height(52.dp)
                    .background(if (state.busy) InsetAlt else Accent, RoundedCornerShape(13.dp))
                    .clickable(enabled = !state.busy, onClick = vm::submit),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (state.busy) "Settling…" else "Settle ${formatMUR(totalDueCents)}",
                    color = if (state.busy) TextMuted else AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                )
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

/** The exact structure of CounterScreen's Sale-complete dialog — a centred floating card
 *  over a dimmed scrim, status + total + actions on the left, the printed slip(s) on the
 *  right exactly as they came off the printer. */
@Composable
private fun SettlementCompleteDialog(state: SettlementState, vm: SettlementViewModel) {
    val doc = state.completedReceipts.firstOrNull()
    // A multi-invoice settlement is ONE consolidated ReceiptDoc (consolidatedSections
    // non-empty); a single-invoice settlement is the ordinary per-invoice doc. Either way
    // there's exactly one ReceiptDoc to show — this just names what's inside it.
    val invoiceNumbers = doc?.consolidatedSections?.mapNotNull { it.invoiceNo }
        ?.takeIf { it.isNotEmpty() } ?: listOfNotNull(doc?.invoiceNo)
    val totalCents = doc?.totalCents ?: 0L
    val customerName = doc?.customer ?: ""
    Dialog(onDismissRequest = {}, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Row(
            Modifier.widthIn(max = 960.dp).fillMaxWidth(0.97f).background(CardBg, RoundedCornerShape(22.dp)).padding(26.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            // ── left: status + total + actions (scrolls on the small checkout tablet) ──
            Column(Modifier.weight(1.15f).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Settlement complete", color = TextPrimary, fontFamily = Condensed, fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                        Text(
                            if (invoiceNumbers.size <= 1) "Invoice ${invoiceNumbers.firstOrNull() ?: "—"} · paid"
                            else "${invoiceNumbers.size} invoices · ${invoiceNumbers.joinToString(", ")}",
                            color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp,
                        )
                    }
                    Box(
                        Modifier.height(42.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = vm::dismissReceipts).padding(horizontal = 15.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("←  Done", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }
                }
                Spacer(Modifier.height(24.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Box(Modifier.size(8.dp).background(Success, CircleShape))
                    Text("PAYMENT CONFIRMED", color = Success, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.2.sp)
                }
                Spacer(Modifier.height(6.dp))
                Text(formatMUR(totalCents), color = TextPrimary, fontFamily = Condensed, fontSize = 46.sp, fontWeight = FontWeight.Bold)
                Text(
                    "received from $customerName" + if (invoiceNumbers.size > 1) " · ${invoiceNumbers.size} invoices settled" else "",
                    color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                )
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // printed automatically at settlement — this re-sends the same slip(s)
                    Box(
                        Modifier.height(48.dp).background(Accent, RoundedCornerShape(12.dp)).clickable(onClick = vm::reprint).padding(horizontal = 20.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Print again", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp) }
                }
                Spacer(Modifier.height(16.dp))
                Row(
                    Modifier.fillMaxWidth().background(Tile, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp)).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.size(38.dp).background(AccentSoft, CircleShape), contentAlignment = Alignment.Center) {
                        Text("+", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Ready for the next customer", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("Settle another account, or head back to Checkout", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp)
                    }
                    Box(
                        Modifier.height(40.dp).background(Accent, RoundedCornerShape(11.dp)).clickable(onClick = vm::dismissReceipts).padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Back  →", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp) }
                }
            }
            // ── right: the slip exactly as it printed (consolidated when >1 invoice) ──
            // The scroll goes ON ReceiptPaper's own modifier, same as CounterScreen's
            // Sale-complete dialog — a plain Column here would report only its heightIn(max)
            // as its size and let a long consolidated receipt overflow past it uncut, instead
            // of scrolling inside the space actually allotted to it.
            Box(Modifier.weight(0.9f), contentAlignment = Alignment.TopCenter) {
                doc?.let { ReceiptPaper(it, Modifier.width(300.dp).heightIn(max = 700.dp).verticalScroll(rememberScrollState())) }
            }
        }
    }
}
