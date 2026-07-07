package mu.carfection.pos.feature.dash

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentBlue
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning

private val BestGrad = Brush.horizontalGradient(listOf(Accent, AccentBlue))
private val BarGrad = Brush.verticalGradient(listOf(Accent, Color(0xFF0E8F7C)))

private fun Modifier.panel() = this.background(CardBg, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp))

@Composable
fun DashScreen(viewModel: DashViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("TODAY AT THE STUDIO", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text("Live — updates as sales are recorded", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        }
        if (s.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = TextMuted, fontFamily = Barlow) }
        } else {
            val d = s.data
            // KPI row
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                d.kpis.forEach { k ->
                    Column(Modifier.weight(1f).panel().padding(horizontal = 15.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(k.label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted)
                        Text(k.value, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, letterSpacing = 0.5.sp, color = if (k.accent) Accent else if (k.warn) Warning else TextPrimary)
                        Text(k.sub, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
                    }
                }
            }
            // Row 1: turnover bars (58) + best sellers (42)
            Row(Modifier.weight(1.1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(58f).fillMaxHeight().panel().padding(horizontal = 15.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Label("TURNOVER — LAST 7 DAYS")
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        val chartH = maxHeight.value - 30f
                        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            d.bars.forEach { b ->
                                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Bottom, horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(b.value, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 9.5.sp, color = if (b.today) Accent else TextMuted, maxLines = 1)
                                    Spacer(Modifier.height(4.dp))
                                    Box(Modifier.fillMaxWidth().height((chartH * b.heightPct / 100f).coerceAtLeast(3f).dp).background(if (b.today) BarGrad else Brush.verticalGradient(listOf(Color(0xFFDDE4EB), Color(0xFFDDE4EB))), RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp, bottomStart = 2.dp, bottomEnd = 2.dp)))
                                    Spacer(Modifier.height(4.dp))
                                    Text(b.label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, letterSpacing = 0.5.sp, color = if (b.today) Accent else TextMuted, maxLines = 1)
                                }
                            }
                        }
                    }
                }
                Column(Modifier.weight(42f).fillMaxHeight().panel().padding(horizontal = 15.dp, vertical = 13.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Label("BEST SELLERS — 7 DAYS")
                    if (d.top.isEmpty()) Text("No sales in the last 7 days.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted)
                    d.top.forEach { t ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(t.name, Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(t.value, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = TextSecondary, maxLines = 1)
                            }
                            Box(Modifier.fillMaxWidth().height(5.dp).background(InsetAlt, RoundedCornerShape(3.dp))) {
                                Box(Modifier.fillMaxWidth(t.pct / 100f).height(5.dp).background(BestGrad, RoundedCornerShape(3.dp)))
                            }
                        }
                    }
                }
            }
            // Row 2: technicians (58) + payment mix (42)
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(58f).fillMaxHeight().panel().padding(horizontal = 15.dp, vertical = 13.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Label("TECHNICIANS — TODAY")
                    if (d.techs.isEmpty()) Text("No technicians.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted)
                    d.techs.forEach { u ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Box(Modifier.size(30.dp).background(Accent, CircleShape), contentAlignment = Alignment.Center) { Text(u.init, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = AccentInk) }
                            Text(u.name, Modifier.width(96.dp), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextPrimary, maxLines = 1)
                            Text(u.jobs, Modifier.width(84.dp), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted, maxLines = 1)
                            Text(u.hours, Modifier.width(52.dp), fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextSecondary, maxLines = 1)
                            Box(Modifier.weight(1f).height(6.dp).background(InsetAlt, RoundedCornerShape(3.dp))) {
                                Box(Modifier.fillMaxWidth(u.pct / 100f).height(6.dp).background(Accent, RoundedCornerShape(3.dp)))
                            }
                            Text(u.rev, Modifier.width(90.dp), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextPrimary, maxLines = 1)
                        }
                    }
                }
                Column(Modifier.weight(42f).fillMaxHeight().panel().padding(horizontal = 15.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Label("PAYMENT MIX — TODAY")
                    d.mix.forEach { m ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(m.label, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
                                Text(m.value, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = TextPrimary)
                            }
                            Box(Modifier.fillMaxWidth().height(5.dp).background(InsetAlt, RoundedCornerShape(3.dp))) {
                                Box(Modifier.fillMaxWidth(m.pct / 100f).height(5.dp).background(Color(m.colorArgb), RoundedCornerShape(3.dp)))
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Text("Card & Juice are settled on the bank terminal — the POS records references.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp, color = TextMuted)
                }
            }
        }
    }
}

@Composable private fun Label(t: String) = Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted)
