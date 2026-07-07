package mu.carfection.pos.feature.stock

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
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
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning

private val LowRing = Color(0x59C17A00)

@Composable
fun StockScreen(viewModel: StockViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("STOCK", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text("Shop-floor view — quick adjustments only", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
            Spacer(Modifier.weight(1f))
            val low = viewModel.lowCount(s)
            if (low > 0) Box(Modifier.height(32.dp).background(Color(0x24C17A00), RoundedCornerShape(16.dp)).padding(horizontal = 13.dp), contentAlignment = Alignment.Center) {
                Text("⚠ $low low-stock item${if (low > 1) "s" else ""}", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = Warning)
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            viewModel.tabs(s).forEach { t ->
                val on = t == s.tab
                Box(Modifier.height(38.dp).background(if (on) AccentSoft else Color.Transparent, RoundedCornerShape(19.dp)).border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Color(0x1F101A24), RoundedCornerShape(19.dp)).clickable { viewModel.setTab(t) }.padding(horizontal = 15.dp), contentAlignment = Alignment.Center) {
                    Text(t, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = if (on) Accent else TextSecondary)
                }
            }
        }
        if (s.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = TextMuted, fontFamily = Barlow) }
        } else {
            LazyVerticalGrid(columns = GridCells.Fixed(3), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f).fillMaxWidth()) {
                items(viewModel.items(s), key = { it.id }) { p -> StockCard(p, viewModel) }
            }
        }
    }
    s.adj?.let { AdjustModal(it, viewModel) }
    s.toast?.let { LaunchedEffect(it) { delay(2000); viewModel.clearToast() } }
    s.toast?.let { Toast(it) }
}

@Composable
private fun StockCard(p: StockItem, vm: StockViewModel) {
    val ohColor = if (p.zero) Danger else if (p.low) Warning else TextPrimary
    Column(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(14.dp)).border(1.dp, if (p.low) LowRing else Hairline, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(p.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, lineHeight = 17.sp, color = TextPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${p.category} · ${formatMUR(p.priceCents)}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.onHand.toString(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, color = ohColor)
                if (p.low) Text("LOW", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 1.sp, color = Warning)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            StepBtn("−") { vm.quickAdjust(p, -1) }
            StepBtn("+") { vm.quickAdjust(p, +1) }
            Box(Modifier.weight(1f).height(42.dp).border(1.dp, Color(0x1F101A24), RoundedCornerShape(11.dp)).clickable { vm.openAdj(p) }, contentAlignment = Alignment.Center) {
                Text("Adjust…", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextSecondary)
            }
        }
    }
}

@Composable
private fun AdjustModal(a: AdjustState, vm: StockViewModel) {
    Dialog(onDismissRequest = vm::closeAdj) {
        Column(Modifier.width(480.dp).background(CardBg, RoundedCornerShape(22.dp)).border(1.dp, Color(0x1F101A24), RoundedCornerShape(22.dp)).padding(horizontal = 20.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("ADJUST STOCK", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.2.sp, color = TextPrimary)
                Text("${a.name} — on hand ${a.onHand}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = TextSecondary)
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Spacer(Modifier.weight(1f))
                BigStep("−") { vm.adjStep(-1) }
                Column(Modifier.width(130.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    val dc = if (a.delta > 0) Success else if (a.delta < 0) Danger else TextSecondary
                    Text(if (a.delta > 0) "+${a.delta}" else a.delta.toString(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 44.sp, color = dc)
                    Text("→ new on-hand ${a.result}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
                }
                BigStep("+") { vm.adjStep(+1) }
                Spacer(Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                STOCK_REASONS.forEach { r ->
                    val on = a.reason == r
                    Box(Modifier.height(38.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(19.dp)).border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(19.dp)).clickable { vm.adjReason(r) }.padding(horizontal = 13.dp), contentAlignment = Alignment.Center) {
                        Text(r, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = if (on) Accent else TextSecondary)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(52.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(13.dp)).clickable { vm.closeAdj() }, contentAlignment = Alignment.Center) {
                    Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextSecondary)
                }
                Box(Modifier.weight(2f).height(52.dp).background(if (a.delta != 0) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = a.delta != 0) { vm.adjApply() }, contentAlignment = Alignment.Center) {
                    Text("Apply adjustment", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (a.delta != 0) AccentInk else TextMuted)
                }
            }
        }
    }
}

@Composable private fun StepBtn(t: String, onClick: () -> Unit) = Box(Modifier.width(46.dp).height(42.dp).background(InsetAlt, RoundedCornerShape(11.dp)).border(1.dp, Hairline, RoundedCornerShape(11.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
    Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary)
}
@Composable private fun BigStep(t: String, onClick: () -> Unit) = Box(Modifier.size(64.dp).background(InsetAlt, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
    Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = TextPrimary)
}
@Composable private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = Color.White)
    }
}
