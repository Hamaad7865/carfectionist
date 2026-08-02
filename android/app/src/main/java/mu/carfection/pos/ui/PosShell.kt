package mu.carfection.pos.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.carfection.pos.R
import mu.carfection.pos.ui.theme.Accent
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
    CONTACTS("Contacts", PosIcons.Intake, "Contacts", "Customers, their cars, and what has been coated"),
    DASH("Today", PosIcons.Today, "Today at the studio", "KPIs, turnover, best sellers, technicians"),
    SETTINGS("Settings", PosIcons.Settings, "Device settings", "Printer · cash drawer · barcode scanner"),
}

private val Tracked2 = 2.sp

/** "1 sale held" / "3 sales held" — the pill is read at a glance, so it has to read right. */
private fun salesWord(n: Int) = if (n == 1) "sale" else "sales"

@Composable
fun PosShell(
    active: PosTab,
    onSelect: (PosTab) -> Unit,
    studioName: String,
    staffName: String,
    staffRole: String,
    online: Boolean,
    pendingSync: Int,
    heldSales: Int,
    syncing: Boolean,
    onSyncNow: () -> Unit,
    onStaffClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    // Edge-to-edge (targetSdk 35): inset for BOTH system bars — the status bar so the
    // clock/battery never overlap the header, and the navigation bar so Samsung's One UI
    // taskbar (a full-height bottom bar on the real tablet) never covers footer buttons.
    Column(Modifier.fillMaxSize().background(ScreenBg).windowInsetsPadding(WindowInsets.systemBars)) {
        Header(studioName, staffName, staffRole, online, pendingSync, heldSales, syncing, onSyncNow, onStaffClick)
        Row(Modifier.fillMaxSize()) {
            NavRail(active, onSelect)
            Box(Modifier.weight(1f).fillMaxHeight().background(ScreenBg)) { content() }
        }
    }
}

@Composable
private fun Header(
    studioName: String,
    staffName: String,
    staffRole: String,
    online: Boolean,
    pendingSync: Int,
    heldSales: Int,
    syncing: Boolean,
    onSyncNow: () -> Unit,
    onStaffClick: () -> Unit,
) {
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
        // brand logo — gold line-art on its black tile, as the brand asset is designed
        Box(Modifier.size(34.dp).background(Color(0xFF0B0D0F), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.logo_carfectionist), contentDescription = "Carfectionist", modifier = Modifier.size(32.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(studioName.uppercase(), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = Tracked2, color = TextPrimary)
            Text("Helvetia · Mauritius", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted, letterSpacing = 0.4.sp)
        }
        Spacer(Modifier.weight(1f))
        // manual sync — pulls the catalogue fresh, drains the outbox, checks for an update.
        // Everything it does already happens on its own (outbox drains on reconnect, the
        // catalogue refreshes on its own schedule, the update check runs once at launch); this
        // is just "don't make me wait for that" for the moment staff actually need it current.
        val spin by rememberInfiniteTransition(label = "sync-spin").animateFloat(
            initialValue = 0f, targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing)),
            label = "sync-spin-angle",
        )
        Box(
            Modifier.size(34.dp).clip(CircleShape)
                .background(if (syncing) AccentSoft else Tile)
                .border(1.dp, Hairline, CircleShape)
                .clickable(enabled = !syncing, onClick = onSyncNow),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Sync, contentDescription = "Sync now",
                tint = if (syncing) Accent else TextSecondary,
                modifier = Modifier.size(18.dp).graphicsLayer { if (syncing) rotationZ = spin },
            )
        }
        // time / date
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(timeStr, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, letterSpacing = 1.sp, color = TextPrimary)
            Text(dateStr, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted)
        }
        // sync pill — connectivity, queued writes, and any sale still held on this tablet.
        // A held sale outranks everything else it could say: that is money the books have
        // not seen, and it is the one thing staff must not walk away from at closing time.
        val dotColor = when {
            heldSales > 0 -> Warning
            !online -> Danger
            pendingSync > 0 -> Warning
            else -> Success
        }
        val syncLabel = when {
            heldSales > 0 && !online -> "Offline · $heldSales ${salesWord(heldSales)} held"
            heldSales > 0 -> "Filing $heldSales ${salesWord(heldSales)}"
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
                Text(staffName, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 14.sp, color = TextPrimary)
                Text(staffRole.replaceFirstChar { it.uppercase() }, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, lineHeight = 11.sp, color = TextMuted)
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

/** Below this screen width (dp) the shell goes compact: icon-only nav rail, and screens
 *  tuck their secondary rails away. ~1100 splits the Tab S11 (1280dp) from ~8" tablets. */
const val COMPACT_BREAKPOINT_DP = 1100

@Composable
private fun NavRail(active: PosTab, onSelect: (PosTab) -> Unit) {
    // The owner's second tablet (drawer + scanner, lives on Checkout) is SMALL. Below
    // the breakpoint the rail goes icon-only — labels cost ~30dp of width the content
    // needs, and the premium look of the Tab S11 layout comes from the content having
    // room, not from the rail's captions. It also COLLAPSES to a sliver: on the small
    // machine the cashier lives on one screen all day, and every dp belongs to the
    // categories and the bill. Collapsed is the small tablet's default.
    val compact = LocalConfiguration.current.screenWidthDp < COMPACT_BREAKPOINT_DP
    var open by rememberSaveable { mutableStateOf(!compact) }

    if (!open) {
        // A sliver: chevron to reopen + the active tab's icon so you never feel lost.
        Column(
            Modifier.width(30.dp).fillMaxHeight().background(CardBg).clickable { open = true },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("»", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextSecondary, modifier = Modifier.padding(top = 12.dp))
            Spacer(Modifier.height(14.dp))
            Icon(active.icon, active.label, tint = Accent, modifier = Modifier.size(18.dp))
        }
        return
    }

    Column(
        Modifier.width(if (compact) 58.dp else 86.dp).fillMaxHeight().background(CardBg)
            .padding(horizontal = if (compact) 5.dp else 7.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        PosTab.entries.forEach { tab ->
            val sel = tab == active
            Column(
                Modifier.fillMaxWidth().height(if (compact) 48.dp else 68.dp)
                    .background(if (sel) AccentSoft else Color.Transparent, RoundedCornerShape(13.dp))
                    .clickable { onSelect(tab) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(tab.icon, tab.label, tint = if (sel) Accent else TextSecondary, modifier = Modifier.size(22.dp))
                if (!compact) {
                    Spacer(Modifier.height(5.dp))
                    Text(tab.label.uppercase(), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 9.5.sp, letterSpacing = 0.8.sp, color = if (sel) Accent else TextSecondary)
                }
            }
        }
        Spacer(Modifier.weight(1f))
        // tuck the rail away — the content gets the width back
        Box(
            Modifier.fillMaxWidth().height(34.dp).clickable { open = false },
            contentAlignment = Alignment.Center,
        ) { Text("«", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextMuted) }
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
