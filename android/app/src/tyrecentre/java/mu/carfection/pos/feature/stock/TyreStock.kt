package mu.carfection.pos.feature.stock

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.RemoveShoppingCart
import androidx.compose.material.icons.outlined.Warehouse
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.core.catalog.TyreSizes
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.network.ProductMoveDto
import mu.carfection.pos.core.network.StockProductDto
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.Barlow
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
import mu.carfection.pos.ui.theme.Warning

// The tyre centre's stock screen, in Carfectionist's look (Kite file
// https://kite.new/p/4y3zeeyaa6jwdfgj, frame "Stock — Carfectionist style"). Only this flavor
// compiles it; Carfectionist's stub has TYRE_STOCK = false and keeps the classic grid.
//
// Everything here READS, except the one write the classic screen already has: Adjust, which opens
// the same AdjustModal (a reason is required) and posts through StockViewModel.adjApply. Counts,
// the status tiles, the size/brand filters, the weekly bars and the days-left estimate are
// worked out from what the view model loaded — nothing new is stored.

internal const val TYRE_STOCK = true

private enum class Status { ALL, LOW, OUT }
private enum class Where(val label: String) { SHOP("Shop"), WAREHOUSE("Warehouse"), BOTH("All places") }

private val AmberSoft = Color(0xFFFFF3DC)
private val RedSoft = Color(0xFFFDE8E8)
private val BlueSoft = Color(0xFFE6F1FF)
private val GreenSoft = Color(0xFFE3F5EC)
private val BarTrack = Color(0xFFE8ECF1)

/** What a stock movement was, in the shop's words. */
private fun moveLabel(m: ProductMoveDto): String = when (m.refType) {
    "invoice", "document" -> if (m.qty < 0) "Sold" else "Sale reversed"
    "job", "job_card" -> if (m.qty < 0) "Used on a job" else "Back from a job"
    "transfer" -> if (m.qty < 0) "Transfer out" else "Transfer in"
    "purchase_order" -> "Delivery received"
    "credit_note" -> "Returned by customer"
    "adjustment" -> m.note?.ifBlank { null } ?: "Adjustment"
    else -> m.refType?.replace('_', ' ')?.replaceFirstChar { it.uppercase() } ?: "Movement"
}

/** Sales and jobs take tyres off the shelf; a credit note or reversal puts them back. */
private val SALE_TYPES = setOf("invoice", "document", "job", "job_card", "credit_note")

private val MU = java.time.ZoneId.of("Indian/Mauritius")
private fun movedAt(m: ProductMoveDto): java.time.ZonedDateTime? =
    m.movedAt?.let { runCatching { java.time.OffsetDateTime.parse(it).atZoneSameInstant(MU) }.getOrNull() }

/** Units sold per week, oldest first, over the last six weeks (week 6 = the last 7 days). */
private fun weeklySold(moves: List<ProductMoveDto>): List<Int> {
    val now = java.time.ZonedDateTime.now(MU)
    val weeks = IntArray(6)
    moves.filter { it.refType in SALE_TYPES }.forEach { m ->
        val at = movedAt(m) ?: return@forEach
        val days = java.time.Duration.between(at, now).toDays().toInt()
        if (days in 0 until 42) weeks[5 - days / 7] += (-m.qty).toInt()
    }
    return weeks.map { it.coerceAtLeast(0) }
}

@Composable
private fun Label(t: String, color: Color = TextMuted, modifier: Modifier = Modifier) = Text(
    t, color = color, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.6.sp,
    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier,
)

@Composable
internal fun TyreStock(s: StockState, vm: StockViewModel) {
    var status by rememberSaveable { mutableStateOf(Status.ALL) }
    var where by rememberSaveable { mutableStateOf(Where.SHOP) }
    var width by rememberSaveable { mutableStateOf("") }
    var profile by rememberSaveable { mutableStateOf("") }
    var rim by rememberSaveable { mutableStateOf("") }
    var brands by remember { mutableStateOf(setOf<String>()) }

    val byId = remember(s.products) { s.products.associateBy { it.id } }
    // Tab (category) and the search box are the view model's own filters; the size boxes, brand
    // ticks and status tiles narrow that list here.
    val base = vm.items(s)
    val wq = width.toIntOrNull(); val pq = profile.toIntOrNull(); val rq = rim.replace(',', '.').toDoubleOrNull()
    val sized = base.filter { i ->
        val p = byId[i.id]
        (wq == null || p?.tyreWidth == wq) && (pq == null || p?.tyreProfile == pq) && (rq == null || p?.tyreRim == rq)
    }
    val brandRows = sized.mapNotNull { byId[it.id]?.brand?.trim()?.ifBlank { null } }
        .groupBy { it.lowercase() }.map { (k, v) -> Triple(k, v.first(), v.size) }.sortedByDescending { it.third }
    val branded = sized.filter { brands.isEmpty() || byId[it.id]?.brand?.trim()?.lowercase() in brands }
    val shown = branded.filter {
        when (status) { Status.ALL -> true; Status.LOW -> it.low && !it.zero; Status.OUT -> it.zero }
    }

    // The detail panel follows the first product in view until the cashier picks one, and moves
    // on when a filter hides the one it was showing.
    val selected = shown.firstOrNull { it.id == s.detailId }
    LaunchedEffect(shown.map { it.id }, s.loading) {
        if (!s.loading && shown.none { it.id == s.detailId }) shown.firstOrNull()?.let { vm.openDetail(it.id) }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(ScreenBg)) {
        val wide = maxWidth >= 1100.dp
        Row(Modifier.fillMaxSize().padding(start = 18.dp, top = 14.dp, end = 16.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Header(s, vm)
                StatusTiles(s, base, status) { status = if (status == it) Status.ALL else it }
                Filters(
                    s, vm, width, profile, rim, brandRows, brands, where,
                    onWidth = { width = it.filter(Char::isDigit).take(3) },
                    onProfile = { profile = it.filter(Char::isDigit).take(2) },
                    onRim = { v -> rim = v.filter { it.isDigit() || it == '.' || it == ',' }.take(4) },
                    onBrand = { k -> brands = if (k in brands) brands - k else brands + k },
                    onAllBrands = { brands = emptySet() },
                    onWhere = { where = it },
                    onClear = { width = ""; profile = ""; rim = ""; brands = emptySet(); status = Status.ALL },
                )
                if (s.loading) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("Loading stock…", color = TextMuted, fontFamily = Barlow, fontSize = 15.sp)
                } else StockList(s, vm, shown, byId, where, Modifier.weight(1f))
            }
            if (wide) DetailPanel(s, vm, selected, byId[selected?.id], Modifier.width(400.dp).fillMaxHeight())
        }
    }
}

@Composable
private fun Header(s: StockState, vm: StockViewModel) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("STOCK", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 32.sp, letterSpacing = 2.sp)
        Text(
            "Shop and warehouse counts, what's running low, and every move", color = TextMuted, fontFamily = Barlow,
            fontWeight = FontWeight.Medium, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        FilledInput(
            value = s.query, onValueChange = vm::setQuery, placeholder = "Search or scan…",
            modifier = Modifier.width(260.dp), height = 44.dp, radius = 12.dp, bg = CardBg, leadingSearch = true,
        )
        Row(
            Modifier.height(44.dp).background(CardBg, RoundedCornerShape(12.dp)).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                .clickable { vm.openLog() }.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.ReceiptLong, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
            Text("Adjustment log", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun StatusTiles(s: StockState, items: List<StockItem>, status: Status, onPick: (Status) -> Unit) {
    val low = items.count { it.low && !it.zero }
    val out = items.count { it.zero }
    val away = items.sumOf { s.elsewhereOnHand[it.id] ?: 0 }
    val shop = items.sumOf { it.onHand.coerceAtLeast(0) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Tile(Icons.Outlined.Inventory2, Accent, BlueSoft, "${items.size}", "products · $shop in shop", status == Status.ALL, Modifier.weight(1f)) { onPick(Status.ALL) }
        Tile(Icons.Outlined.WarningAmber, Warning, AmberSoft, "$low", "running low", status == Status.LOW, Modifier.weight(1f)) { onPick(Status.LOW) }
        Tile(Icons.Outlined.RemoveShoppingCart, Danger, RedSoft, "$out", "out of stock in the shop", status == Status.OUT, Modifier.weight(1f)) { onPick(Status.OUT) }
        Tile(Icons.Outlined.Warehouse, Success, GreenSoft, "$away", "units in the warehouse", false, Modifier.weight(1f), null)
    }
}

@Composable
private fun Tile(icon: ImageVector, ink: Color, soft: Color, big: String, sub: String, on: Boolean, modifier: Modifier, onClick: (() -> Unit)?) {
    Row(
        modifier.height(78.dp).background(CardBg, RoundedCornerShape(16.dp))
            .border(2.dp, if (on) ink else CardBg, RoundedCornerShape(16.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).background(soft, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(big, color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 30.sp)
            Text(sub, color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Filters(
    s: StockState, vm: StockViewModel,
    width: String, profile: String, rim: String,
    brandRows: List<Triple<String, String, Int>>, brands: Set<String>, where: Where,
    onWidth: (String) -> Unit, onProfile: (String) -> Unit, onRim: (String) -> Unit,
    onBrand: (String) -> Unit, onAllBrands: () -> Unit, onWhere: (Where) -> Unit, onClear: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (s.products.any { it.tyreWidth != null }) {
                SizeBox("WIDTH", width, onWidth, Modifier.width(120.dp))
                Text("/", color = Color(0xFFC2CBD5), fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 26.sp)
                SizeBox("PROFILE", profile, onProfile, Modifier.width(120.dp))
                Text("R", color = Color(0xFFC2CBD5), fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 26.sp)
                SizeBox("RIM", rim, onRim, Modifier.width(120.dp))
            }
            Spacer(Modifier.weight(1f))
            // Which count the list shows: the shop floor (what the till sells), the warehouse, or both.
            Row(Modifier.background(Inset, RoundedCornerShape(12.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Where.entries.forEach { w ->
                    val on = w == where
                    Box(
                        Modifier.height(44.dp).background(if (on) CardBg else Color.Transparent, RoundedCornerShape(9.dp))
                            .clickable { onWhere(w) }.padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(w.label, color = if (on) TextPrimary else TextSecondary, fontFamily = Barlow, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold, fontSize = 14.5.sp) }
                }
            }
            val any = width.isNotEmpty() || profile.isNotEmpty() || rim.isNotEmpty() || brands.isNotEmpty()
            if (any) Box(
                Modifier.size(52.dp).background(Inset, RoundedCornerShape(12.dp)).clickable(onClick = onClear),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.Close, contentDescription = "Clear the filters", tint = TextSecondary, modifier = Modifier.size(20.dp)) }
        }
        if (brandRows.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("All brands", brands.isEmpty(), onClick = onAllBrands)
            // Ticks, not one-of: "Michelin or Bridgestone in 205/55" is the question at the counter.
            brandRows.forEach { (key, name, n) -> Chip("$name  $n", key in brands, tick = true) { onBrand(key) } }
        }
        val tabs = vm.tabs(s)
        if (tabs.size > 2) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            tabs.forEach { t -> Chip(t, t == s.tab, outline = true) { vm.setTab(t) } }
        }
    }
}

@Composable
private fun SizeBox(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier) {
    val set = value.isNotEmpty()
    // Enter walks width → profile → rim; the last box just closes the keyboard.
    val imeFlow = mu.carfection.pos.ui.rememberImeFlow(KeyboardOptions(keyboardType = KeyboardType.Decimal))
    Column(
        modifier.height(64.dp).background(if (set) Color(0xFFF4F9FF) else Inset, RoundedCornerShape(12.dp))
            .border(2.dp, if (set) Accent else Inset, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Label(label, color = if (set) Accent else TextMuted)
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true,
            keyboardOptions = imeFlow.first,
            keyboardActions = imeFlow.second,
            textStyle = TextStyle(color = if (set) Accent else TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) Text("Any", color = Color(0xFFB4BFCA), fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 24.sp)
                    inner()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Chip(t: String, on: Boolean, tick: Boolean = false, outline: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.height(40.dp)
            .background(if (on && !outline) TextPrimary else if (outline && on) BlueSoft else InsetAlt, RoundedCornerShape(10.dp))
            .border(if (outline && on) 1.5.dp else 0.dp, if (outline && on) Accent else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (tick) Box(
            Modifier.size(16.dp).background(if (on) Color.White else Color.Transparent, RoundedCornerShape(4.dp))
                .border(1.5.dp, if (on) Color.White else TextMuted, RoundedCornerShape(4.dp)),
            contentAlignment = Alignment.Center,
        ) { if (on) Text("✓", color = TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
        Text(
            t, color = if (on && !outline) Color.White else if (on) Accent else TextPrimary,
            fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 1,
        )
    }
}

/** The list, grouped by tyre size (other products by category) — how a tyre shop thinks about stock. */
@Composable
private fun StockList(s: StockState, vm: StockViewModel, shown: List<StockItem>, byId: Map<String, StockProductDto>, where: Where, modifier: Modifier) {
    if (shown.isEmpty()) {
        Box(modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
            Text("Nothing matches — clear a filter.", color = TextMuted, fontFamily = Barlow, fontSize = 15.sp)
        }
        return
    }
    data class Group(val key: String, val title: String, val tyre: Boolean, val rows: List<StockItem>)
    val groups = shown.groupBy { i -> byId[i.id]?.tyreSize?.let(TyreSizes::format) ?: "~${i.category}" }
        .map { (k, rows) -> Group(k, k.removePrefix("~"), !k.startsWith("~"), rows) }
        .sortedWith(compareBy({ !it.tyre }, { it.title }))
    LazyColumn(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(groups, key = { it.key }) { g ->
            Column(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                    Text(g.title.uppercase(), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 0.8.sp)
                    val shopN = g.rows.sumOf { it.onHand.coerceAtLeast(0) }
                    val awayN = g.rows.sumOf { s.elsewhereOnHand[it.id] ?: 0 }
                    Text(
                        "${g.rows.size} ${if (g.rows.size == 1) "product" else "products"} · $shopN in shop · $awayN in warehouse",
                        color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp,
                    )
                }
                g.rows.forEachIndexed { n, i ->
                    if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Inset))
                    StockRow(i, byId[i.id], s.elsewhereOnHand[i.id] ?: 0, where, i.id == s.detailId, vm)
                }
            }
        }
    }
}

@Composable
private fun StockRow(i: StockItem, p: StockProductDto?, away: Int, where: Where, selected: Boolean, vm: StockViewModel) {
    val shown = when (where) { Where.SHOP -> i.onHand; Where.WAREHOUSE -> away; Where.BOTH -> i.onHand + away }
    val ink = when { i.zero -> Danger; i.low -> Warning; else -> Success }
    Row(
        Modifier.fillMaxWidth().background(if (selected) Color(0xFFF4F9FF) else Color.Transparent, RoundedCornerShape(12.dp))
            .clickable { vm.openDetail(i.id) }.padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(10.dp).background(ink, CircleShape))
        Column(Modifier.weight(1f)) {
            val brand = p?.brand?.ifBlank { null }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (brand != null) Label(brand.uppercase())
                Text(i.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            }
            val spec = p?.tyreSize?.let { TyreSizes.formatSpec(it, p.tyreLoadIndex, p.tyreSpeedRating) }
            Text(listOfNotNull(spec, formatMUR(i.priceCents)).joinToString("  ·  "), color = TextSecondary, fontFamily = Mono, fontSize = 12.5.sp, maxLines = 1)
        }
        // How full the shop shelf is against its minimum — the bar reads before the number does.
        Column(Modifier.width(150.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            val cap = (i.threshold * 2).coerceAtLeast(1.0)
            Box(Modifier.fillMaxWidth().height(8.dp).background(BarTrack, RoundedCornerShape(4.dp))) {
                Box(Modifier.fillMaxWidth((i.onHand / cap).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(ink, RoundedCornerShape(4.dp)))
                Box(Modifier.fillMaxWidth(0.5f).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) { Box(Modifier.width(2.dp).fillMaxHeight().background(TextMuted)) }
            }
            Text(
                when { i.zero -> "Out — min ${i.threshold.toInt()}"; i.low -> "Low — min ${i.threshold.toInt()}"; else -> "Min ${i.threshold.toInt()}" },
                color = if (i.low) ink else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
            )
        }
        Column(Modifier.width(110.dp), horizontalAlignment = Alignment.End) {
            Text(shown.toString(), color = if (where == Where.SHOP) ink.takeIf { i.low } ?: TextPrimary else TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 30.sp)
            Text(
                when (where) { Where.SHOP -> "in shop · $away whse"; Where.WAREHOUSE -> "in warehouse"; Where.BOTH -> "${i.onHand} shop + $away" },
                color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, maxLines = 1,
            )
        }
    }
}

// ─── detail panel ────────────────────────────────────────────────────────────

@Composable
private fun DetailPanel(s: StockState, vm: StockViewModel, i: StockItem?, p: StockProductDto?, modifier: Modifier) {
    Column(modifier.background(CardBg, RoundedCornerShape(18.dp))) {
        if (i == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Pick a product to see its moves.", color = TextMuted, fontFamily = Barlow, fontSize = 15.sp)
            }
            return@Column
        }
        val away = s.elsewhereOnHand[i.id] ?: 0
        val moves = if (s.detailId == i.id) s.detailMoves else emptyList()
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                p?.brand?.ifBlank { null }?.let { Label(it.uppercase()) }
                Text(i.name.uppercase(), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 28.sp, letterSpacing = 0.4.sp)
                val spec = p?.tyreSize?.let { TyreSizes.formatSpec(it, p.tyreLoadIndex, p.tyreSpeedRating) }
                Text(listOfNotNull(spec, i.category).joinToString("  ·  "), color = TextSecondary, fontFamily = Mono, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(formatMUR(i.priceCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Figure("IN SHOP", i.onHand.toString(), when { i.zero -> Danger; i.low -> Warning; else -> TextPrimary }, Modifier.weight(1f))
                Figure("WAREHOUSE", away.toString(), TextPrimary, Modifier.weight(1f))
                Figure("MINIMUM", i.threshold.toInt().toString(), TextSecondary, Modifier.weight(1f))
            }
            val weeks = weeklySold(moves)
            val sold = weeks.sum()
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("SOLD, LAST 6 WEEKS", modifier = Modifier.weight(1f))
                    Text("$sold ${if (sold == 1) "unit" else "units"}", color = TextPrimary, fontFamily = Mono, fontSize = 13.sp)
                }
                WeekBars(weeks, s.detailBusy && moves.isEmpty())
                // Days left at the six-week pace — a plain estimate, said as one.
                val perDay = sold / 42.0
                val (text, ink, bg) = when {
                    s.detailBusy && moves.isEmpty() -> Triple("Working out the pace…", TextMuted, Inset)
                    i.onHand <= 0 -> Triple("Out in the shop now" + if (away > 0) " — $away in the warehouse" else "", Danger, RedSoft)
                    perDay <= 0.0 -> Triple("No sales in six weeks", TextSecondary, Inset)
                    else -> {
                        val days = (i.onHand / perDay).toInt()
                        Triple(
                            "About $days ${if (days == 1) "day" else "days"} left at this pace",
                            if (days <= 7) Danger else if (days <= 21) Warning else Success,
                            if (days <= 7) RedSoft else if (days <= 21) AmberSoft else GreenSoft,
                        )
                    }
                }
                Row(
                    Modifier.fillMaxWidth().background(bg, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
                    Text(text, color = ink, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Label("LATEST MOVES", modifier = Modifier.padding(bottom = 6.dp))
                if (moves.isEmpty()) Text(
                    if (s.detailBusy) "Loading…" else "Nothing moved in six weeks.",
                    color = TextMuted, fontFamily = Barlow, fontSize = 14.sp,
                )
                moves.take(12).forEach { m -> MoveRow(m) }
            }
        }
        Row(
            Modifier.fillMaxWidth().background(Color(0xFFF7F9FB), RoundedCornerShape(bottomStart = 18.dp, bottomEnd = 18.dp)).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // The same adjust path as the classic screen: −/+ open the dialog with the step set,
            // and nothing is written until a reason is picked.
            StepKey("−", enabled = i.onHand > 0) { vm.quickAdjust(i, -1) }
            StepKey("+", enabled = true) { vm.quickAdjust(i, +1) }
            Box(
                Modifier.weight(1f).height(54.dp).background(Accent, RoundedCornerShape(14.dp)).clickable { vm.openAdj(i) },
                contentAlignment = Alignment.Center,
            ) { Text("Adjust shop count…", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
        }
    }
}

@Composable
private fun Figure(label: String, value: String, ink: Color, modifier: Modifier) = Column(
    modifier.background(Inset, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
) {
    Label(label)
    Text(value, color = ink, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 32.sp)
}

@Composable
private fun WeekBars(weeks: List<Int>, loading: Boolean) {
    val top = (weeks.maxOrNull() ?: 0).coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().height(110.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        weeks.forEachIndexed { n, w ->
            Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                Text(if (loading) "" else w.toString(), color = TextSecondary, fontFamily = Mono, fontSize = 11.sp)
                Spacer(Modifier.height(3.dp))
                val frac = if (loading) 0.08f else (w.toFloat() / top).coerceIn(0.04f, 1f)
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().fillMaxHeight(frac).background(if (n == weeks.lastIndex) Accent else Color(0xFFB9D7FF), RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp)))
                }
                Spacer(Modifier.height(4.dp))
                Text(if (n == weeks.lastIndex) "This wk" else "${weeks.size - 1 - n}w ago", color = TextMuted, fontFamily = Barlow, fontSize = 11.sp, textAlign = TextAlign.Center, maxLines = 1)
            }
        }
    }
}

@Composable
private fun MoveRow(m: ProductMoveDto) {
    val at = movedAt(m)
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(moveLabel(m), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(at?.format(java.time.format.DateTimeFormatter.ofPattern("d MMM · HH:mm")), m.location?.name).joinToString(" · "),
                color = TextMuted, fontFamily = Barlow, fontSize = 12.sp, maxLines = 1,
            )
        }
        val q = m.qty
        val qText = (if (q > 0) "+" else "") + (if (q % 1.0 == 0.0) q.toInt().toString() else q.toString())
        Text(qText, color = if (q < 0) Danger else Success, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp)
    }
}

@Composable
private fun StepKey(t: String, enabled: Boolean, onClick: () -> Unit) = Box(
    Modifier.size(54.dp).background(InsetAlt, RoundedCornerShape(14.dp)).clickable(enabled = enabled, onClick = onClick),
    contentAlignment = Alignment.Center,
) { Text(t, color = if (enabled) TextPrimary else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 22.sp) }

@Suppress("unused") private val keepDp: Dp = 0.dp
