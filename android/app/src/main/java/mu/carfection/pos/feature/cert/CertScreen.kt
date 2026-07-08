package mu.carfection.pos.feature.cert

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import kotlinx.coroutines.delay
import mu.carfection.pos.core.network.CertificateDto
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentBlue
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.Plate
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

private val Purple = Color(0xFF7C5CE8)
private val CertGrad = Brush.linearGradient(listOf(Accent, AccentBlue))
private val CertBorderGrad = Brush.linearGradient(listOf(Accent, AccentBlue, Purple))
private val DFMT = DateTimeFormatter.ofPattern("d MMM yyyy")
private const val STUDIO = "Carfectionist"

private fun parseDate(iso: String?): LocalDate? = iso?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
private fun fmt(d: LocalDate?): String = d?.format(DFMT) ?: "—"
private fun vehLabel(v: mu.carfection.pos.core.network.JobVehicleDto?): String =
    listOfNotNull(v?.make, v?.model).joinToString(" ").ifBlank { "Vehicle" }

private data class Sched(val label: String, val date: LocalDate, val past: Boolean, val due: Boolean)

private fun schedule(c: CertificateDto, now: LocalDate): List<Sched> {
    val applied = parseDate(c.appliedAt) ?: return emptyList()
    val expires = parseDate(c.expiresAt) ?: return emptyList()
    val out = mutableListOf<Sched>()
    var n = 1; var markedDue = false
    while (out.size < 5) {
        val t = applied.plusMonths(6L * n)
        if (!t.isBefore(expires)) break
        val past = !t.isAfter(now)
        val due = !past && !markedDue
        if (due) markedDue = true
        out.add(Sched("Maintenance wash $n", t, past, due))
        n++
    }
    return out
}

/** Next upcoming (non-past) maintenance date for the reminders list. */
private fun nextDue(c: CertificateDto, now: LocalDate): LocalDate? =
    schedule(c, now).firstOrNull { !it.past }?.date

@Composable
fun CertScreen(viewModel: CertViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() } // refresh certificates on entry
    val now = LocalDate.now()
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("CERTIFICATES & WARRANTY", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text("Ceramic protection — issued from checkout after payment", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        }
        if (s.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = TextMuted, fontFamily = Barlow) }
        } else if (s.certs.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("No certificates issued yet — they're created from checkout after a ceramic job is paid.", color = TextMuted, fontFamily = Barlow, fontSize = 14.sp) }
        } else {
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                // LEFT 44 — list + reminders
                Column(Modifier.weight(44f).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    s.certs.forEach { c -> CertRow(c, c.id == s.activeCertId, fmt(parseDate(c.expiresAt))) { viewModel.pick(c.id) } }
                    Text("UPCOMING MAINTENANCE", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.6.sp, color = TextMuted, modifier = Modifier.padding(top = 8.dp, start = 2.dp))
                    val reminders = s.certs.mapNotNull { c -> nextDue(c, now)?.let { c to it } }.sortedBy { it.second }
                    if (reminders.isEmpty()) Text("Nothing due.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted, modifier = Modifier.padding(start = 2.dp))
                    reminders.forEach { (c, date) -> ReminderRow(c, date, now, viewModel) }
                }
                // RIGHT 56 — certificate
                Column(Modifier.weight(56f).fillMaxHeight().verticalScroll(rememberScrollState())) {
                    viewModel.active(s)?.let { CertificateCard(it, now, viewModel) }
                }
            }
        }
    }
    s.toast?.let { LaunchedEffect(it) { delay(1900); viewModel.clearToast() } }
    s.toast?.let { Toast(it) }
}

@Composable
private fun CertRow(c: CertificateDto, active: Boolean, until: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(if (active) AccentSoft else CardBg, RoundedCornerShape(13.dp)).border(if (active) 1.5.dp else 1.dp, if (active) AccentLine else Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onClick).padding(horizontal = 13.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        Box(Modifier.size(36.dp).background(CertGrad, CircleShape), contentAlignment = Alignment.Center) { Text("✓", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = Color.White) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(vehLabel(c.vehicles), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${c.number} · ${c.customers?.name ?: "—"}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            PlateBadge(c.vehicles?.plate ?: "—", small = true)
            Text("to $until", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted)
        }
    }
}

@Composable
private fun ReminderRow(c: CertificateDto, date: LocalDate, now: LocalDate, vm: CertViewModel) {
    val days = ChronoUnit.DAYS.between(now, date).toInt().coerceAtLeast(0)
    val soon = days <= 30
    val due = if (days <= 30) "in $days d" else "in ${Math.round(days / 30.0)} mo"
    Row(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(12.dp)).border(1.dp, Hairline, RoundedCornerShape(12.dp)).padding(horizontal = 13.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.height(24.dp).background(if (soon) Color(0x26C17A00) else InsetAlt, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
            Text(due, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = if (soon) Warning else TextSecondary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${c.customers?.name ?: "—"} · ${vehLabel(c.vehicles)}", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Ceramic maintenance wash · ${c.number} · ${fmt(date)}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.height(38.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(10.dp)).clickable { vm.note("Maintenance wash booked — ${(c.customers?.name ?: "").split(" ").firstOrNull() ?: ""}") }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
            Text("Book", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextPrimary)
        }
    }
}

@Composable
private fun CertificateCard(c: CertificateDto, now: LocalDate, vm: CertViewModel) {
    Box(Modifier.fillMaxWidth().background(CertBorderGrad, RoundedCornerShape(20.dp)).padding(1.5.dp)) {
        Column(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(18.5.dp)).padding(horizontal = 26.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // header
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(52.dp).background(CertGrad, CircleShape), contentAlignment = Alignment.Center) { Text("✓", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Color.White) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("CERTIFICATE OF CERAMIC PROTECTION", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 2.5.sp, color = TextPrimary, lineHeight = 22.sp)
                    Text("$STUDIO · Grand Baie · Mauritius", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, letterSpacing = 0.6.sp, color = TextMuted)
                }
                Text(c.number, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextSecondary)
            }
            Box(Modifier.height(1.dp).fillMaxWidth().background(Color(0x1A101A24)))
            // info grid
            Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Field("VEHICLE", vehLabel(c.vehicles), Modifier.weight(1f))
                    FieldSlot("REGISTRATION", Modifier.weight(1f)) { PlateBadge(c.vehicles?.plate ?: "—") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Field("OWNER", c.customers?.name ?: "—", Modifier.weight(1f))
                    Field("COLOUR", c.vehicles?.colour ?: "—", Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Field("PRODUCT APPLIED", c.products?.name ?: "—", Modifier.weight(1f))
                    Field("APPLIED BY", "${c.appliedBy?.displayName?.replace(Regex("\\s*\\(.*\\)$"), "") ?: "—"} · ${fmt(parseDate(c.appliedAt))}", Modifier.weight(1f))
                }
            }
            // warranty box
            Row(Modifier.fillMaxWidth().background(AccentSoft, RoundedCornerShape(14.dp)).border(1.dp, AccentLine, RoundedCornerShape(14.dp)).padding(horizontal = 17.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("WARRANTY VALID UNTIL", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted)
                    Text(fmt(parseDate(c.expiresAt)), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, letterSpacing = 1.sp, color = Accent)
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("TERM", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted)
                    Text(termLabel(c.warrantyMonths), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                }
            }
            // maintenance schedule
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("MAINTENANCE SCHEDULE — EVERY 6 MONTHS", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted)
                val sched = schedule(c, now)
                if (sched.isEmpty()) Text("No maintenance milestones within the warranty term.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                sched.forEach { m ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val dotBg = if (m.past) Success else if (m.due) Accent else Color.Transparent
                        val dotRing = if (m.past) Success else if (m.due) Accent else Color(0x33101A24)
                        val txtC = if (m.past) TextMuted else if (m.due) TextPrimary else TextSecondary
                        Box(Modifier.size(22.dp).background(dotBg, CircleShape).border(1.5.dp, dotRing, CircleShape), contentAlignment = Alignment.Center) {
                            if (m.past) Text("✓", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 11.sp, color = Color.White)
                        }
                        Text(m.label, Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = txtC)
                        Text(fmt(m.date), fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = txtC)
                    }
                }
            }
            // footer
            Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Warranty requires a Ceramic Maintenance Wash every 6 months at an approved studio." + (c.jobId?.let { " Issued against job ${it.take(4).uppercase()}." } ?: ""), Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp, color = TextMuted)
                Box(Modifier.height(44.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(11.dp)).clickable { vm.note("Maintenance wash booked") }.padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                    Text("Book maintenance", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary)
                }
            }
        }
    }
}

private fun termLabel(months: Int): String = when {
    months % 12 == 0 -> "${months / 12} year${if (months / 12 > 1) "s" else ""}"
    else -> "$months months"
}

@Composable private fun Field(label: String, value: String, modifier: Modifier = Modifier) = Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
    Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 1.4.sp, color = TextMuted)
    Text(value, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp, color = TextPrimary)
}
@Composable private fun FieldSlot(label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) = Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
    Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 1.4.sp, color = TextMuted)
    content()
}
@Composable private fun PlateBadge(text: String, small: Boolean = false) = Box(Modifier.background(Plate, RoundedCornerShape(4.dp)).padding(horizontal = if (small) 7.dp else 8.dp, vertical = 3.dp)) {
    Text(text, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = if (small) 10.5.sp else 13.sp, color = Color(0xFF151208))
}
@Composable private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = Color.White)
    }
}
