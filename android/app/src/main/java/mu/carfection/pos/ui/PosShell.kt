package mu.carfection.pos.ui

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentBlue
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.PosIcons
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Tile
import mu.carfection.pos.ui.theme.Warning
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

enum class PosTab(val label: String, val icon: ImageVector, val title: String, val caption: String) {
    INTAKE("Intake", PosIcons.Intake, "Reception · Intake", "Customer → vehicle → condition → quotation"),
    QUOTE("Quotes", PosIcons.Quote, "Quotations", "Build a quote, then convert to a job"),
    JOBS("Jobs", PosIcons.Jobs, "Jobs board", "Scheduled · In progress · Ready · Done"),
    SALE("Checkout", PosIcons.Checkout, "Checkout", "Collect payment — job invoices & counter sales"),
    STOCK("Stock", PosIcons.Stock, "Stock", "On-hand per product · quick adjust"),
    CERT("Warranty", PosIcons.Warranty, "Certificates & warranty", "Ceramic certificates + maintenance"),
    DASH("Today", PosIcons.Today, "Today at the studio", "KPIs, turnover, best sellers, technicians"),
}

private val TileBrush = Brush.linearGradient(listOf(Accent, AccentBlue))
private val Tracked2 = 2.sp

@Composable
fun PosShell(
    active: PosTab,
    onSelect: (PosTab) -> Unit,
    studioName: String,
    staffName: String,
    staffRole: String,
    online: Boolean,
    pendingSync: Int,
    onStaffClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(ScreenBg)) {
        Header(studioName, staffName, staffRole, online, pendingSync, onStaffClick)
        Row(Modifier.fillMaxSize()) {
            NavRail(active, onSelect)
            Box(Modifier.weight(1f).fillMaxHeight().background(ScreenBg)) { content() }
        }
    }
}

@Composable
private fun Header(studioName: String, staffName: String, staffRole: String, online: Boolean, pendingSync: Int, onStaffClick: () -> Unit) {
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { now = LocalDateTime.now(); delay(1000) } }
    val timeStr = now.format(DateTimeFormatter.ofPattern("HH:mm"))
    val dateStr = now.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy"))
    val init = staffName.trim().firstOrNull()?.uppercase() ?: "?"

    Row(
        Modifier.fillMaxWidth().height(58.dp).background(CardBg).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // logo tile
        Box(Modifier.size(34.dp).background(TileBrush, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text("C", color = AccentInk, fontFamily = Condensed, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(studioName.uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = Tracked2, color = TextPrimary)
            Text("Grand Baie · Mauritius", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted, letterSpacing = 0.4.sp)
        }
        Spacer(Modifier.weight(1f))
        // time / date
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(timeStr, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, letterSpacing = 1.sp, color = TextPrimary)
            Text(dateStr, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted)
        }
        // sync pill — reflects real connectivity and any writes still queued in the outbox
        val dotColor = when { !online -> Danger; pendingSync > 0 -> Warning; else -> Success }
        val syncLabel = when {
            !online && pendingSync > 0 -> "Offline · $pendingSync"
            !online -> "Offline"
            pendingSync > 0 -> "Syncing $pendingSync"
            else -> "Online"
        }
        Pill {
            Box(Modifier.size(9.dp).background(dotColor, CircleShape))
            Text(syncLabel, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextPrimary)
        }
        // staff chip (tap = sign out — our functional equivalent of the PIN switch)
        Row(
            Modifier.height(42.dp).background(Tile, RoundedCornerShape(21.dp)).border(1.dp, Hairline, RoundedCornerShape(21.dp))
                .clickable(onClick = onStaffClick).padding(start = 6.dp, end = 13.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(32.dp).background(Accent, CircleShape), contentAlignment = Alignment.Center) {
                Text(init, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = AccentInk)
            }
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(staffName, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary)
                Text(staffRole, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, color = TextMuted)
            }
        }
    }
}

@Composable
private fun Pill(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.height(42.dp).background(Tile, RoundedCornerShape(21.dp)).border(1.dp, Hairline, RoundedCornerShape(21.dp)).padding(horizontal = 15.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp), content = content,
    )
}

@Composable
private fun NavRail(active: PosTab, onSelect: (PosTab) -> Unit) {
    Column(
        Modifier.width(86.dp).fillMaxHeight().background(CardBg).padding(horizontal = 7.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        PosTab.entries.forEach { tab ->
            val sel = tab == active
            Column(
                Modifier.fillMaxWidth().height(68.dp)
                    .background(if (sel) AccentSoft else Color.Transparent, RoundedCornerShape(13.dp))
                    .clickable { onSelect(tab) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(tab.icon, tab.label, tint = if (sel) Accent else TextSecondary, modifier = Modifier.size(22.dp))
                Spacer(Modifier.height(5.dp))
                Text(tab.label.uppercase(), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 9.5.sp, letterSpacing = 0.8.sp, color = if (sel) Accent else TextSecondary)
            }
        }
    }
}

/** Not-yet-built tabs — the handoff's screen title row + a placeholder body. */
@Composable
fun PlaceholderScreen(tab: PosTab) {
    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tab.title.uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text(tab.caption, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Coming soon", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextMuted)
        }
    }
}
