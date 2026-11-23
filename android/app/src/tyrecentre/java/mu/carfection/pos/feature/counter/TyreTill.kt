package mu.carfection.pos.feature.counter

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CallSplit
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.CenterFocusStrong
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ElectricBolt
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.TireRepair
import androidx.compose.material.icons.outlined.TripOrigin
import androidx.compose.material.icons.outlined.WaterDrop
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import mu.carfection.pos.core.catalog.TyreSizes
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.SERVICES_TAB
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.money.shelfCents
import mu.carfection.pos.core.network.CompanyDto
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentSoft
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

// The tyre centre's own New-sale and Paid screens, in Carfectionist's look (Kite file
// https://kite.new/p/4y3zeeyaa6jwdfgj, frames "New sale — Carfectionist style"). Only this
// flavor compiles this file: Carfectionist's flavor has a stub with TYRE_TILL = false, so its
// checkout stays exactly as it was. Every action goes through the same CounterViewModel calls the
// classic checkout uses — the size finder and brand ticks only narrow what is already listed.

internal const val TYRE_TILL = true

/** The company a product sells under, as an index in the shop's company order (0 = main). */
private fun companyIndexOf(companyId: String?, companies: List<CompanyDto>): Int =
    companies.indexOfFirst { it.id == companyIdOfProduct(companyId, companies) }.coerceAtLeast(0)

/** Bill colours in company order: the first bill blue, the second green (the Kite frames). */
private val BILL_DOTS = listOf(Color(0xFF2B8CFF), Color(0xFF1FA361), Color(0xFFE8A400), Color(0xFF8B5CF6))
private fun billDot(index: Int): Color = BILL_DOTS[index.coerceAtLeast(0) % BILL_DOTS.size]

/** "Rs 2,950" on a tile — the whole rupees when there are no cents. */
private fun tilePrice(cents: Long): String = formatMUR(cents).let { if (it.endsWith(".00")) it.dropLast(3) else it }

/** Amounts inside the ticket read like the slip: "11,800.00", no currency. */
private fun plainAmount(cents: Long): String = formatMUR(cents).removePrefix("Rs ").removePrefix("Rs").trim()

private val LabelSize = 11.sp
private val AmberSoft = Color(0xFFFFF3DC)
private val GreenSoft = Color(0xFFE3F5EC)
private val GreenInk = Color(0xFF178A51)
private val Faint = Color(0xFFA7B2BE)
private val Footer = Color(0xFFF7F9FB)

private fun Modifier.dashed(color: Color, radius: Dp, stroke: Dp = 1.5.dp) = this.drawBehind {
    val sw = stroke.toPx(); val r = radius.toPx()
    drawRoundRect(
        color = color, topLeft = Offset(sw / 2, sw / 2), size = Size(size.width - sw, size.height - sw),
        cornerRadius = CornerRadius(r, r), style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(sw * 4, sw * 3))),
    )
}

@Composable
private fun SectionLabel(t: String, color: Color = TextMuted, modifier: Modifier = Modifier) =
    Text(t, color = color, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = LabelSize, letterSpacing = 1.6.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)

// ─── category look: a coloured round icon per category ───────────────────────

private val CAT_COLOURS = listOf(
    Color(0xFF2B8CFF), Color(0xFF1FA361), Color(0xFFE8A400), Color(0xFF34558F),
    Color(0xFFC47A00), Color(0xFF4E8E7C), Color(0xFF8B5CF6), Color(0xFFD9467A),
)

private fun catIcon(name: String): ImageVector {
    val n = name.lowercase()
    return when {
        n == "all" -> Icons.Outlined.Apps
        n.contains("tyre") || n.contains("tire") || n.contains("pneu") -> Icons.Outlined.TireRepair
        name == SERVICES_TAB || n.contains("fit") || n.contains("service") || n.contains("labour") || n.contains("labor") -> Icons.Outlined.Build
        n.contains("align") || n.contains("géom") || n.contains("geom") -> Icons.Outlined.CenterFocusStrong
        n.contains("batter") -> Icons.Outlined.BatteryChargingFull
        n.contains("rim") || n.contains("wheel") || n.contains("jante") || n.contains("mag") -> Icons.Outlined.TripOrigin
        n.contains("oil") || n.contains("fluid") || n.contains("huile") || n.contains("lubri") -> Icons.Outlined.WaterDrop
        n.contains("access") -> Icons.Outlined.AutoAwesome
        else -> Icons.Outlined.Category
    }
}

private fun catColour(name: String, index: Int): Color = if (name == "All") Color(0xFF17202A) else CAT_COLOURS[index % CAT_COLOURS.size]

@Composable
private fun RoundIcon(icon: ImageVector, colour: Color, size: Dp = 36.dp, iconSize: Dp = 19.dp) = Box(
    Modifier.size(size).background(colour, CircleShape), contentAlignment = Alignment.Center,
) { Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(iconSize)) }

// ─── New sale ────────────────────────────────────────────────────────────────

@Composable
internal fun TyreTill(s: CounterUiState, vm: CounterViewModel, onOpenTill: () -> Unit) {
    // The size finder and brand ticks are this screen's own narrowing of what the view model
    // already lists for the tab + search; they never change the cart or the catalogue.
    var width by rememberSaveable { mutableStateOf("") }
    var profile by rememberSaveable { mutableStateOf("") }
    var rim by rememberSaveable { mutableStateOf("") }
    var brands by remember { mutableStateOf(setOf<String>()) }

    val wq = width.toIntOrNull(); val pq = profile.toIntOrNull(); val rq = rim.replace(',', '.').toDoubleOrNull()
    val sized = s.products.filter { p ->
        (wq == null || p.tyreWidth == wq) && (pq == null || p.tyreProfile == pq) && (rq == null || p.tyreRim == rq)
    }
    val brandRows = sized.mapNotNull { p -> p.brand?.trim()?.ifBlank { null } }
        .groupingBy { it.lowercase() }.eachCount().toList().sortedByDescending { it.second }
    val brandNames = sized.mapNotNull { it.brand?.trim()?.ifBlank { null } }.associateBy { it.lowercase() }
    val shown = sized.filter { p -> brands.isEmpty() || p.brand?.trim()?.lowercase() in brands }
    val hasSizes = s.products.any { it.tyreWidth != null } || width.isNotEmpty() || profile.isNotEmpty() || rim.isNotEmpty()

    BoxWithConstraints(Modifier.fillMaxSize().background(ScreenBg)) {
        val wide = maxWidth >= 1180.dp
        Column(
            Modifier.fillMaxSize().padding(start = 18.dp, top = 14.dp, end = 16.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            TillHeader(s, vm, onOpenTill)
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                if (wide) CategoryColumn(s, vm, Modifier.width(210.dp).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!wide) CategoryChips(s, vm)
                    if (hasSizes) SizeFinder(
                        width, profile, rim,
                        onWidth = { width = it.filter(Char::isDigit).take(3) },
                        onProfile = { profile = it.filter(Char::isDigit).take(2) },
                        onRim = { v -> rim = v.filter { it.isDigit() || it == '.' || it == ',' }.take(4) },
                        onClear = { width = ""; profile = ""; rim = ""; brands = emptySet() },
                    )
                    if (brandRows.size > 1) Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            BrandChip("All brands", brands.isEmpty()) { brands = emptySet() }
                            brandRows.forEach { (key, n) ->
                                val on = key in brands
                                BrandChip("${brandNames[key] ?: key}  $n", on) { brands = if (on) brands - key else brands + key }
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("${shown.size} match", color = TextMuted, fontFamily = Mono, fontSize = 13.sp)
                    }
                    ProductGrid(s, vm, shown, Modifier.weight(1f))
                    GoesWith(s, vm)
                }
                TicketPanel(s, vm, Modifier.width(if (wide) 392.dp else 356.dp).fillMaxHeight())
            }
        }
    }
}

@Composable
private fun TillHeader(s: CounterUiState, vm: CounterViewModel, onOpenTill: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("NEW SALE", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 32.sp, letterSpacing = 2.sp)
        Text(
            "Pick tyres and services — the bill builds on the right", color = TextMuted, fontFamily = Barlow,
            fontWeight = FontWeight.Medium, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        // The search box is also where a barcode scanner types (CounterViewModel.setQuery).
        FilledInput(
            value = s.query, onValueChange = vm::setQuery, placeholder = "Search or scan…",
            modifier = Modifier.width(260.dp), height = 44.dp, radius = 12.dp, bg = CardBg, leadingSearch = true,
        )
        val till = s.till
        Row(
            Modifier.height(44.dp).background(if (till != null) GreenSoft else AmberSoft, RoundedCornerShape(22.dp))
                .clickable(onClick = onOpenTill).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(if (till != null) Icons.Outlined.LockOpen else Icons.Outlined.Lock, contentDescription = null, tint = if (till != null) Success else Warning, modifier = Modifier.size(16.dp))
            Text(if (till != null) "Till open" else "Open the till", color = if (till != null) GreenInk else Warning, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
        // Back to the TO COLLECT list (job bills and held sales). Leaving ends the sale
        // (backToList starts a fresh one), so it only shows on an empty cart; with lines in
        // it, "Cancel" in the ticket is the honest way out.
        if (s.cart.isEmpty()) Box(
            Modifier.height(44.dp).background(CardBg, RoundedCornerShape(12.dp)).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                .clickable { vm.backToList() }.padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center,
        ) { Text("To collect", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
    }
}

@Composable
private fun CategoryColumn(s: CounterUiState, vm: CounterViewModel, modifier: Modifier) {
    Column(modifier) {
        SectionLabel("CATEGORIES", modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            s.categories.forEachIndexed { i, c ->
                val on = c == s.tab
                Row(
                    Modifier.fillMaxWidth().height(58.dp)
                        .background(if (on) CardBg else Color.Transparent, RoundedCornerShape(14.dp))
                        .border(2.dp, if (on) Accent else Color.Transparent, RoundedCornerShape(14.dp))
                        .clickable { vm.setTab(c) }.padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    RoundIcon(catIcon(c), catColour(c, i))
                    Text(
                        c, color = TextPrimary, fontFamily = Barlow, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold,
                        fontSize = 15.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                    )
                    val n = if (c == "All") null else s.catCounts[c]
                    if (n != null) Text(n.toString(), color = if (on) Accent else TextMuted, fontFamily = Mono, fontSize = 13.sp)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).dashed(Color(0xFFC9D2DC), 14.dp).clickable { vm.openAdhoc() },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Ad-hoc line", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

/** The narrow-screen fallback: the same categories as a chip row above the grid. */
@Composable
private fun CategoryChips(s: CounterUiState, vm: CounterViewModel) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        s.categories.forEachIndexed { i, c ->
            val on = c == s.tab
            Row(
                Modifier.height(44.dp).background(CardBg, RoundedCornerShape(22.dp))
                    .border(2.dp, if (on) Accent else Color.Transparent, RoundedCornerShape(22.dp))
                    .clickable { vm.setTab(c) }.padding(start = 6.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoundIcon(catIcon(c), catColour(c, i), size = 32.dp, iconSize = 17.dp)
                Text(c, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 1)
            }
        }
        Row(
            Modifier.height(44.dp).dashed(Color(0xFFC9D2DC), 22.dp).clickable { vm.openAdhoc() }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { Text("+ Ad-hoc line", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp) }
    }
}

@Composable
private fun SizeFinder(
    width: String, profile: String, rim: String,
    onWidth: (String) -> Unit, onProfile: (String) -> Unit, onRim: (String) -> Unit, onClear: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SizeBox("WIDTH", width, "Any", onWidth, Modifier.weight(1f))
        Text("/", color = Color(0xFFC2CBD5), fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 28.sp)
        SizeBox("PROFILE", profile, "Any", onProfile, Modifier.weight(1f))
        Text("R", color = Color(0xFFC2CBD5), fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 28.sp)
        SizeBox("RIM", rim, "Any", onRim, Modifier.weight(1f))
        val any = width.isNotEmpty() || profile.isNotEmpty() || rim.isNotEmpty()
        Box(
            Modifier.size(64.dp).background(if (any) Inset else Color.Transparent, RoundedCornerShape(12.dp)).clickable(enabled = any, onClick = onClear),
            contentAlignment = Alignment.Center,
        ) { if (any) Icon(Icons.Outlined.Close, contentDescription = "Clear the size", tint = TextSecondary, modifier = Modifier.size(22.dp)) }
    }
}

/** One part of the tyre size — a label over a big typed number, outlined blue once set. */
@Composable
private fun SizeBox(label: String, value: String, hint: String, onChange: (String) -> Unit, modifier: Modifier) {
    val set = value.isNotEmpty()
    Column(
        modifier.height(64.dp).background(if (set) Color(0xFFF4F9FF) else Inset, RoundedCornerShape(12.dp))
            .border(2.dp, if (set) Accent else Inset, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        SectionLabel(label, color = if (set) Accent else TextMuted)
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = TextStyle(color = if (set) Accent else TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 28.sp),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) Text(hint, color = Color(0xFFB4BFCA), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 20.sp, modifier = Modifier.padding(top = 5.dp))
                    inner()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun BrandChip(t: String, on: Boolean, onClick: () -> Unit) = Box(
    Modifier.height(40.dp).background(if (on) TextPrimary else InsetAlt, RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp),
    contentAlignment = Alignment.Center,
) { Text(t, color = if (on) Color.White else TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1) }

@Composable
private fun ProductGrid(s: CounterUiState, vm: CounterViewModel, shown: List<ProductEntity>, modifier: Modifier) {
    if (shown.isEmpty()) {
        Box(modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
            Text("Nothing matches — clear the size or pick another brand.", color = TextMuted, fontFamily = Barlow, fontSize = 15.sp)
        }
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(250.dp), modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(shown, key = { it.id }) { p ->
            val qty = s.cart.firstOrNull { it.product.id == p.id }?.qty?.toInt()
            TyreTile(p, qty, s.onHand[p.id], s.pricesInclVat, s.companies, s.several,
                onAdd = { vm.add(p) },
                onAddFour = {
                    val cur = s.cart.firstOrNull { it.product.id == p.id }?.qty ?: 0.0
                    // add() raises the oversell prompt itself when stock runs out; setQty does
                    // the same for the jump to +4, so the till's stock rules hold.
                    if (vm.add(p)) vm.setQty(p.id, cur + 4)
                },
            )
        }
    }
}

@Composable
private fun TyreTile(
    p: ProductEntity, inCart: Int?, onHand: Int?, inclVat: Boolean, companies: List<CompanyDto>, several: Boolean,
    onAdd: () -> Unit, onAddFour: () -> Unit,
) {
    val selected = inCart != null && inCart > 0
    val tyre = p.tyreWidth != null
    val service = p.kind == "service"
    val idx = companyIndexOf(p.legalEntityId, companies)
    Column(
        Modifier.height(196.dp).background(CardBg, RoundedCornerShape(16.dp))
            .border(2.dp, if (selected) Accent else CardBg, RoundedCornerShape(16.dp))
            .clickable(onClick = onAdd).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val label = when {
                !p.brand.isNullOrBlank() -> p.brand.uppercase()
                service -> "SERVICE"
                else -> (p.category ?: "PRODUCT").uppercase()
            }
            if (several) Box(Modifier.size(8.dp).background(billDot(idx), CircleShape))
            if (several) Spacer(Modifier.width(6.dp))
            Text(label, color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.6.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Row(
                Modifier.height(24.dp).background(Accent, RoundedCornerShape(12.dp)).padding(horizontal = 9.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(Icons.Filled.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
                Text("$inCart IN SALE", color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(p.name.uppercase(), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 24.sp, letterSpacing = 0.4.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val size = p.tyreSize
        if (size != null) Text(TyreSizes.formatSpec(size, p.tyreLoadIndex, p.tyreSpeedRating), color = TextSecondary, fontFamily = Mono, fontSize = 13.5.sp, maxLines = 1)
        else if (!p.brand.isNullOrBlank() && p.category != null) Text(p.category, color = TextSecondary, fontFamily = Barlow, fontSize = 13.5.sp, maxLines = 1)
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(tilePrice(shelfCents(p.sellingPriceCents, p.vatRatePct, inclVat, p.priceInclusive)), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 25.sp, maxLines = 1)
                if (p.isStocked) {
                    val oh = onHand ?: 0
                    val low = oh < (p.lowStockThreshold ?: 5.0)
                    val (t, c) = when {
                        oh <= 0 -> "Out of stock" to Danger
                        low -> "$oh in shop · low" to Warning
                        else -> "$oh in shop" to Success
                    }
                    Text(t, color = c, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, maxLines = 1)
                }
            }
            if (tyre) {
                TileKey("+1", InsetAlt, TextPrimary, Modifier.width(48.dp), onAdd)
                TileKey("+4", Accent, Color.White, Modifier.width(60.dp), onAddFour)
            } else TileKey("+", Accent, Color.White, Modifier.width(56.dp), onAdd)
        }
    }
}

@Composable
private fun TileKey(t: String, bg: Color, fg: Color, modifier: Modifier, onClick: () -> Unit) = Box(
    modifier.height(48.dp).background(bg, RoundedCornerShape(12.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center,
) { Text(t, color = fg, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp) }

/** Words that mark a service done once per tyre (fitting, balancing, a valve…). */
private val PER_TYRE = listOf("fit", "balanc", "valve", "nitro", "montage", "équilib", "equilib")
private fun perTyre(name: String) = name.lowercase().let { n -> PER_TYRE.any { n.contains(it) } }

/** Once tyres are in the sale, the services that go with them — one tap each. */
@Composable
private fun GoesWith(s: CounterUiState, vm: CounterViewModel) {
    val tyres = s.cart.filter { it.product.tyreWidth != null }.sumOf { it.qty }.toInt()
    if (tyres <= 0) return
    val services = remember(s.cart.size) {
        vm.catalogueServices().sortedWith(compareBy({ if (perTyre(it.name)) 0 else 1 }, { it.name })).take(3)
    }
    if (services.isEmpty()) return
    Column(Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.ElectricBolt, contentDescription = null, tint = Success, modifier = Modifier.size(16.dp))
            SectionLabel("GOES WITH $tyres ${if (tyres == 1) "TYRE" else "TYRES"}")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            services.forEach { svc ->
                val inCart = s.cart.firstOrNull { it.product.id == svc.id }?.qty?.toInt() ?: 0
                val n = if (perTyre(svc.name)) tyres else 1
                Row(
                    Modifier.weight(1f).height(56.dp).background(Inset, RoundedCornerShape(12.dp)).padding(start = 12.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (inCart > 0) RoundIcon(Icons.Filled.Check, Success, size = 30.dp, iconSize = 16.dp)
                    Column(Modifier.weight(1f)) {
                        Text("${svc.name}${if (n > 1) " ×$n" else ""}", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            if (inCart > 0) "added ×$inCart" else plainAmount(shelfCents(svc.sellingPriceCents, svc.vatRatePct, s.pricesInclVat, svc.priceInclusive) * n),
                            color = if (inCart > 0) Success else TextSecondary, fontFamily = Mono, fontSize = 11.5.sp,
                        )
                    }
                    if (inCart == 0) Box(
                        Modifier.size(40.dp).background(CardBg, RoundedCornerShape(10.dp)).clickable { if (vm.add(svc) && n > 1) vm.setQty(svc.id, n.toDouble()) },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Add, contentDescription = "Add ${svc.name}", tint = Accent, modifier = Modifier.size(19.dp)) }
                }
            }
            repeat(3 - services.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

// ─── the ticket: one bill per company ────────────────────────────────────────

/** One bill block as the ticket draws it — a real company bill, or the whole sale on a one-company till. */
private data class Block(val companyId: String?, val name: String, val vatRegistered: Boolean, val index: Int, val lines: List<Int>, val totalCents: Long, val vatCents: Long, val discText: String, val blockReason: String?)

private fun blocksOf(s: CounterUiState): List<Block> =
    if (s.tillBills.isNotEmpty()) s.tillBills.map { b ->
        Block(b.company.id, b.name, b.company.vatRegistered, companyIndexOf(b.company.id, s.companies), b.lineIndexes, b.totals.totalCents, b.totals.vatCents, b.disc.text, b.blockReason)
    } else if (s.cart.isNotEmpty()) listOf(
        Block(null, s.companies.firstOrNull()?.let(::companyName) ?: mu.carfection.pos.ui.theme.Brand.NAME, true, 0, s.cart.indices.toList(), s.totals.totalCents, s.totals.vatCents, s.basketText, s.discountBlockReason),
    ) else emptyList()

@Composable
private fun TicketPanel(s: CounterUiState, vm: CounterViewModel, modifier: Modifier) {
    val blocks = blocksOf(s)
    Column(modifier.background(CardBg, RoundedCornerShape(18.dp))) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("CURRENT SALE", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, modifier = Modifier.weight(1f))
                if (s.cart.isNotEmpty()) Box(Modifier.height(26.dp).background(AmberSoft, RoundedCornerShape(13.dp)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                    Text("UNPAID", color = Warning, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.8.sp)
                }
            }
            CustomerRow(s, vm)
        }
        Box(Modifier.padding(horizontal = 20.dp).fillMaxWidth().height(1.dp).background(Inset))
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (blocks.isEmpty()) Text(
                "Tap a tyre or a service to start the sale.", color = TextMuted, fontFamily = Barlow, fontSize = 14.5.sp,
                modifier = Modifier.padding(vertical = 18.dp),
            )
            blocks.forEachIndexed { n, b -> BillBlock(s, vm, b, n + 1, blocks.size > 1) }
        }
        TicketFooter(s, vm, blocks.size)
    }
}

@Composable
private fun CustomerRow(s: CounterUiState, vm: CounterViewModel) {
    var editing by remember { mutableStateOf(false) }
    val name = s.customerText.trim()
    Column {
        Row(
            Modifier.fillMaxWidth().height(56.dp).background(Inset, RoundedCornerShape(12.dp)).clickable { editing = !editing }.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.Person, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text(name.ifBlank { "Walk-in customer" }, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (s.customerId != null) "On file" else if (name.isNotEmpty()) "New — not on file yet" else "Tap to add the customer",
                    color = TextSecondary, fontFamily = Barlow, fontSize = 12.5.sp,
                )
            }
            Icon(Icons.Outlined.Edit, contentDescription = "Customer", tint = TextMuted, modifier = Modifier.size(17.dp))
        }
        if (editing) {
            Spacer(Modifier.height(8.dp))
            FilledInput(
                value = s.customerText, onValueChange = vm::setCustomerText, placeholder = "Customer name or phone",
                modifier = Modifier.fillMaxWidth(), height = 44.dp, radius = 12.dp, bg = Inset, fontSize = 14.5.sp,
            )
            s.customerMatches.forEach { c ->
                Text(
                    c.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                    modifier = Modifier.fillMaxWidth().clickable { vm.pickCustomer(c); editing = false }.padding(horizontal = 10.dp, vertical = 9.dp),
                )
            }
        }
    }
}

@Composable
private fun BillBlock(s: CounterUiState, vm: CounterViewModel, b: Block, number: Int, several: Boolean) {
    var discOpen by remember(b.companyId) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().then(if (b.blockReason != null) Modifier.border(1.dp, Danger, RoundedCornerShape(12.dp)).padding(8.dp) else Modifier),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (several) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(8.dp).background(billDot(b.index), CircleShape))
            SectionLabel("BILL $number · ${b.name.uppercase()}", modifier = Modifier.weight(1f))
            Text(if (b.vatRegistered) "VAT 15%" else "NO VAT", color = TextMuted, fontFamily = Mono, fontSize = 10.5.sp)
        }
        b.lines.forEach { i ->
            val l = s.cart.getOrNull(i) ?: return@forEach
            Column {
                Row(
                    Modifier.fillMaxWidth().clickable { vm.toggleLine(l.product.id) }.padding(vertical = 2.dp),
                    verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("${l.qty.toInt()}×", color = Accent, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 15.sp, modifier = Modifier.width(32.dp))
                    Column(Modifier.weight(1f)) {
                        Text(l.product.name.uppercase(), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, letterSpacing = 0.3.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val unit = plainAmount(shelfCents(l.product.sellingPriceCents, l.product.vatRatePct, s.pricesInclVat, l.product.priceInclusive))
                        // The size only when the name doesn't already say it ("TEST TYRE 205/55 R16").
                        val size = l.product.tyreSize?.let(TyreSizes::format)?.takeUnless { z -> l.product.name.contains(z, ignoreCase = true) }
                        Text(
                            listOfNotNull(size, "@ $unit").joinToString(" · "),
                            color = TextMuted, fontFamily = Mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        plainAmount(if (s.pricesInclVat) s.rowGrossCents(i) else s.docTotals.lineExclCents.getOrElse(i) { 0L }),
                        color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 15.sp,
                    )
                }
                if (l.expanded) Row(
                    Modifier.fillMaxWidth().padding(start = 42.dp, top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    StepKey("−") { vm.setQty(l.product.id, l.qty - 1) }
                    Text(l.qty.toInt().toString(), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 16.sp, modifier = Modifier.width(28.dp), textAlign = TextAlign.Center)
                    StepKey("+") { vm.setQty(l.product.id, l.qty + 1) }
                    Spacer(Modifier.weight(1f))
                    Box(
                        Modifier.size(40.dp).background(Color(0x14D63A3A), RoundedCornerShape(10.dp)).clickable { vm.setQty(l.product.id, 0.0) },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove", tint = Danger, modifier = Modifier.size(19.dp)) }
                }
            }
        }
        // Each company's bill has its own discount (owner rule): open it here, on this bill.
        val disc = b.discText.isNotBlank()
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (disc) "Discount · ${b.discText}${if (s.discFocusFor(b) == DiscountMode.PCT) "%" else " off"}" else "+ Discount",
                color = if (disc) Success else Accent, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp,
                modifier = Modifier.clickable { b.companyId?.let(vm::setDiscFocus); discOpen = !discOpen }.padding(vertical = 4.dp),
            )
            Spacer(Modifier.weight(1f))
            if (several) Text("Bill $number  ${plainAmount(b.totalCents)}", color = TextSecondary, fontFamily = Mono, fontSize = 12.5.sp)
        }
        if (discOpen) DiscountEditor(s, vm, b)
        b.blockReason?.let { Text(it, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp) }
    }
}

/** The discount mode of a block: its own on a company bill, the whole sale's otherwise. */
private fun CounterUiState.discFocusFor(b: Block): DiscountMode =
    if (b.companyId != null) companyDiscs[b.companyId]?.mode ?: DiscountMode.PCT else basketMode

@Composable
private fun DiscountEditor(s: CounterUiState, vm: CounterViewModel, b: Block) {
    // The setters act on the focused bill; this editor only shows while its bill has the focus.
    val focused = b.companyId == null || s.focusBill?.company?.id == b.companyId
    if (!focused) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, t) ->
                val on = s.discMode == m
                Box(
                    Modifier.height(36.dp).background(if (on) Accent else InsetAlt, RoundedCornerShape(10.dp))
                        .clickable { vm.setBasketMode(m) }.padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(t, color = if (on) AccentInk else TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
            }
            FilledInput(
                value = s.discText, onValueChange = vm::setBasketText, placeholder = if (s.discMode == DiscountMode.PCT) "0" else "0.00",
                modifier = Modifier.width(120.dp), height = 36.dp, radius = 10.dp, bg = Inset, fontSize = 14.sp,
            )
        }
        if (s.allowance.reasonRequired || s.discReason.isNotBlank()) FilledInput(
            value = s.discReason, onValueChange = vm::setDiscountReason, placeholder = "Why — e.g. regular customer",
            modifier = Modifier.fillMaxWidth(), height = 38.dp, radius = 10.dp, bg = Inset, fontSize = 13.5.sp,
        )
        if (b.blockReason != null && s.blockAllowance.overCeiling) Text(
            "Ask the owner →", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp,
            modifier = Modifier.clickable { vm.askOwner() },
        )
    }
}

@Composable
private fun StepKey(t: String, onClick: () -> Unit) = Box(
    Modifier.size(40.dp).background(InsetAlt, RoundedCornerShape(10.dp)).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
) { Text(t, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp) }

@Composable
private fun TicketFooter(s: CounterUiState, vm: CounterViewModel, bills: Int) {
    val ready = s.cart.isNotEmpty() && s.discountBlockReason == null
    Column(
        Modifier.fillMaxWidth().background(Footer, RoundedCornerShape(bottomStart = 18.dp, bottomEnd = 18.dp)).padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 18.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FooterKey("Split", Icons.Outlined.CallSplit, TextPrimary, Modifier.weight(1f), enabled = ready) { vm.openPad(); vm.toggleSplit() }
            // Ends this sale and goes back to the TO COLLECT list (the classic "Cancel counter sale").
            FooterKey("Cancel", Icons.Outlined.Close, Danger, Modifier.weight(1f), enabled = s.cart.isNotEmpty()) { vm.backToList() }
        }
        Spacer(Modifier.height(4.dp))
        if (s.totals.vatCents > 0) Row {
            Text(
                (if (bills > 1) "$bills bills · " else "") + if (s.pricesInclVat) "VAT 15% included" else "VAT 15%",
                color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 14.sp, modifier = Modifier.weight(1f),
            )
            Text(plainAmount(s.totals.vatCents), color = TextSecondary, fontFamily = Mono, fontSize = 14.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Total incl. tax", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Text(formatMUR(s.totals.totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 36.sp, maxLines = 1)
        }
        s.error?.takeUnless { s.padOpen }?.let { Text(it, color = Danger, fontFamily = Barlow, fontSize = 13.sp) }
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier.fillMaxWidth().height(62.dp).background(if (ready) Accent else InsetAlt, RoundedCornerShape(14.dp)).clickable(enabled = ready) { vm.openPad() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (s.cart.isEmpty()) "Charge" else "Charge ${formatMUR(s.totals.totalCents)}",
                color = if (ready) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 19.sp,
            )
        }
    }
}

@Composable
private fun FooterKey(t: String, icon: ImageVector, tint: Color, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) = Row(
    modifier.height(46.dp).background(if (tint == Danger) Color.Transparent else InsetAlt, RoundedCornerShape(10.dp))
        .then(if (tint == Danger) Modifier.border(1.5.dp, if (enabled) Color(0xFFF2C9C9) else Hairline, RoundedCornerShape(10.dp)) else Modifier)
        .clickable(enabled = enabled, onClick = onClick),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
) {
    val c = if (enabled) tint else TextMuted
    Icon(icon, contentDescription = null, tint = c, modifier = Modifier.size(17.dp))
    Spacer(Modifier.width(7.dp))
    Text(t, color = c, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
}

/** A hand-typed line. It bills under the shop's main company (the database files a line with no
 *  product there), so the dialog says so; a non-VAT service is sold from the catalogue instead. */
@Composable
internal fun TyreCustomLineDialog(s: CounterUiState, vm: CounterViewModel) {
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    val cents = parseMoneyToCents(price)
    val ok = name.isNotBlank() && cents != null && cents > 0
    val main = s.companies.firstOrNull { it.isDefault } ?: s.companies.firstOrNull()
    Dialog(onDismissRequest = vm::closeAdhoc) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("AD-HOC LINE", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp)
            Text("A one-off service or product, priced by hand.", color = TextSecondary, fontFamily = Barlow, fontSize = 14.sp)
            if (s.several && main != null) {
                Text(
                    "Billed by ${companyName(main)}${if (main.vatRegistered) " with VAT" else ""}. Services sold by another company are picked from the catalogue.",
                    color = TextSecondary, fontFamily = Barlow, fontSize = 13.5.sp,
                )
            }
            SectionLabel("DESCRIPTION")
            FilledInput(value = name, onValueChange = { name = it }, placeholder = "e.g. Rim straightening", modifier = Modifier.fillMaxWidth(), radius = 12.dp, bg = Inset)
            SectionLabel(if (s.pricesInclVat) "PRICE (Rs, INCL. VAT)" else "PRICE (Rs, EXCL. VAT)")
            FilledInput(value = price, onValueChange = { p -> price = p.filter { it.isDigit() || it == '.' } }, placeholder = "0.00", modifier = Modifier.fillMaxWidth(), radius = 12.dp, bg = Inset)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(54.dp).background(InsetAlt, RoundedCornerShape(14.dp)).clickable { vm.closeAdhoc() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
                Box(
                    Modifier.weight(1.4f).height(54.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(14.dp))
                        .clickable(enabled = ok) { vm.addAdhoc(name, cents ?: 0) },
                    contentAlignment = Alignment.Center,
                ) { Text("Add line", color = if (ok) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
            }
        }
    }
}

// ─── Payment: the tyre centre's bill column (shared PaymentPad, TYRE_TILL only) ──

/**
 * The left column of the payment pad on a walk-in sale billed by two or more companies: one card
 * per company bill with its own lines and total, so the customer sees what the one payment covers.
 * Figures are the till's own per-company totals (CounterUiState.tillBills) — nothing is recomputed.
 */
@Composable
internal fun TyrePayBills(s: CounterUiState, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            s.tillBills.forEachIndexed { n, b ->
                val idx = companyIndexOf(b.company.id, s.companies)
                Column(
                    Modifier.fillMaxWidth().background(Footer, RoundedCornerShape(14.dp)).border(1.dp, Color(0xFFE6EAF0), RoundedCornerShape(14.dp))
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(10.dp).background(billDot(idx), CircleShape))
                        SectionLabel("BILL ${n + 1} · ${b.name.uppercase()}", color = TextSecondary, modifier = Modifier.weight(1f))
                        Text("No. on issue", color = TextMuted, fontFamily = Mono, fontSize = 11.5.sp)
                    }
                    b.lineIndexes.forEach { i ->
                        val l = s.cart.getOrNull(i) ?: return@forEach
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("${l.qty.toInt()}×", color = Accent, fontFamily = Mono, fontSize = 14.sp, modifier = Modifier.width(30.dp))
                            Column(Modifier.weight(1f)) {
                                Text(l.product.name.uppercase(), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                l.product.tyreSize?.let { z ->
                                    Text(TyreSizes.formatSpec(z, l.product.tyreLoadIndex, l.product.tyreSpeedRating), color = TextMuted, fontFamily = Mono, fontSize = 11.5.sp)
                                }
                            }
                            Text(plainAmount(s.rowGrossCents(i)), color = TextPrimary, fontFamily = Mono, fontSize = 14.sp)
                        }
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE6EAF0)))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Bill ${n + 1} total", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Text(formatMUR(b.totals.totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 23.sp)
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().background(Color(0xFFFFF8E8), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Payments, contentDescription = null, tint = Warning, modifier = Modifier.size(18.dp))
            Text("Each company issues its own invoice. One payment settles both bills.", color = Color(0xFF8A5A00), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp)
        }
    }
}

/**
 * Under the payment methods: how the money lands on each company's bill. Paying in full settles
 * every bill at its own total; a part payment follows the allocation the cashier picked
 * (CounterUiState.allocation, the same value record_checkout_payment receives) — so this strip
 * only reads figures, it never decides them.
 */
@Composable
internal fun TyreWhereMoneyGoes(s: CounterUiState) {
    val bills = s.tillBills
    if (bills.size < 2 || s.collect != null) return
    val total = bills.sumOf { it.totals.totalCents }.coerceAtLeast(1L)
    Column(
        Modifier.fillMaxWidth().background(Footer, RoundedCornerShape(14.dp)).border(1.dp, Color(0xFFE6EAF0), RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 13.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionLabel(if (s.isPartPayment) "THIS PAYMENT FOLLOWS YOUR CHOICE ABOVE" else "WHERE THE MONEY GOES")
        Row(Modifier.fillMaxWidth().height(12.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            bills.forEach { b ->
                val share = (b.totals.totalCents.toFloat() / total).coerceAtLeast(0.02f)
                Box(Modifier.weight(share).fillMaxHeight().background(billDot(companyIndexOf(b.company.id, s.companies)), RoundedCornerShape(6.dp)))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            bills.forEachIndexed { n, b ->
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(10.dp).background(billDot(companyIndexOf(b.company.id, s.companies)), CircleShape))
                    Text("Bill ${n + 1}", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(plainAmount(b.totals.totalCents), color = TextPrimary, fontFamily = Mono, fontSize = 14.sp)
                }
            }
        }
    }
}

// ─── Paid ────────────────────────────────────────────────────────────────────

@Composable
internal fun TyrePaid(s: CounterUiState, vm: CounterViewModel) {
    val result = s.done ?: return
    val slips = listOfNotNull(s.receipt) + s.moreReceipts
    // Each bill, in company order, with its colour — the slips print in the same order.
    val bills = result.bills.ifEmpty { listOf(mu.carfection.pos.core.data.SaleBill(result.invoiceId, result.number, result.totalCents, null)) }
    val methodLabel = s.receipt?.payLabel ?: s.method.label
    Row(Modifier.fillMaxSize().background(ScreenBg).padding(start = 18.dp, top = 14.dp, end = 16.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.width(410.dp).fillMaxHeight().background(CardBg, RoundedCornerShape(18.dp)).padding(24.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundIcon(Icons.Filled.Check, Success, size = 56.dp, iconSize = 28.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            when {
                                result.offlineRef != null -> "HELD ON THIS TABLET"
                                result.onAccount -> "ON ACCOUNT"
                                else -> "PAID"
                            },
                            color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 30.sp, letterSpacing = 2.sp,
                        )
                        val n = bills.size
                        Text(
                            if (result.onAccount) "$n ${if (n == 1) "bill" else "bills"}" else "$methodLabel · $n ${if (n == 1) "receipt" else "receipts"}",
                            color = TextSecondary, fontFamily = Barlow, fontSize = 14.sp,
                        )
                    }
                }
                Spacer(Modifier.height(18.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("Total", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                    Text(formatMUR(result.totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 36.sp)
                }
                Spacer(Modifier.height(14.dp))
                when {
                    result.onAccount -> StatusCard("OWED", formatMUR(result.totalCents), "by ${result.debtor ?: s.customerText.trim().ifBlank { "the customer" }} — on their statement", AmberSoft, Warning)
                    result.changeCents > 0 -> StatusCard("GIVE CHANGE", formatMUR(result.changeCents), "Tendered ${formatMUR(result.totalCents + result.changeCents)}", GreenSoft, GreenInk)
                    result.offlineRef != null -> StatusCard("HELD", result.offlineRef, "The invoices follow when the tablet is back online", Inset, TextPrimary)
                }
                Spacer(Modifier.height(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    bills.forEachIndexed { n, b ->
                        val idx = companyIndexOf(b.legalEntityId, s.companies)
                        val co = s.companies.getOrNull(idx)
                        Row(
                            Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(10.dp).background(billDot(idx), CircleShape))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(co?.let(::companyName) ?: "Bill ${n + 1}", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(b.number ?: "—", color = TextSecondary, fontFamily = Mono, fontSize = 12.5.sp, maxLines = 1, softWrap = false)
                            }
                            Spacer(Modifier.width(10.dp))
                            Text(formatMUR(b.totalCents), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 14.5.sp, maxLines = 1, softWrap = false)
                        }
                    }
                }
                if (vm.canManage && result.offlineRef == null) VoidControl(result, vm)
            }
            Spacer(Modifier.height(12.dp))
            var sendOpen by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FooterKey("Print again", Icons.Outlined.Print, TextPrimary, Modifier.weight(1f), enabled = slips.isNotEmpty()) { vm.reprint() }
                if (s.whatsapp) FooterKey("WhatsApp", Icons.Outlined.Chat, TextPrimary, Modifier.weight(1f), enabled = result.offlineRef == null && !s.busy) { sendOpen = true }
            }
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().height(62.dp).background(Accent, RoundedCornerShape(14.dp)).clickable { vm.startNextSale() },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = AccentInk, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("New sale", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            Text(
                "Back to the list", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().clickable { vm.backToList() }.padding(top = 12.dp, bottom = 2.dp),
            )
            if (sendOpen) SendReceiptsDialog(vm, onClose = { sendOpen = false })
        }
        // The slips exactly as they printed — ReceiptPaper is the code that renders the printed slip.
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("PRINTED RECEIPTS", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 26.sp, letterSpacing = 1.5.sp, modifier = Modifier.weight(1f))
                if (slips.size > 1) SectionLabel("ONE PER COMPANY")
            }
            if (slips.isEmpty()) Text(
                if (result.offlineRef != null) "The receipt printed from this tablet; the invoices follow when it is back online."
                else "No receipt to show.", color = TextMuted, fontFamily = Barlow, fontSize = 14.5.sp,
            )
            Row(
                Modifier.fillMaxWidth().weight(1f).horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
            ) {
                slips.forEach { slip ->
                    val bill = bills.firstOrNull { it.number != null && it.number == slip.invoiceNo }
                    val idx = companyIndexOf(bill?.legalEntityId, s.companies)
                    Column(Modifier.width(300.dp).shadow(10.dp, RoundedCornerShape(6.dp)).background(CardBg, RoundedCornerShape(6.dp))) {
                        Box(Modifier.fillMaxWidth().height(5.dp).background(billDot(idx), RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp)))
                        ReceiptPaper(slip, Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusCard(label: String, big: String, sub: String, bg: Color, ink: Color) = Column(
    Modifier.fillMaxWidth().background(bg, RoundedCornerShape(14.dp)).padding(horizontal = 18.dp, vertical = 14.dp),
) {
    SectionLabel(label, color = ink)
    Text(big, color = ink, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 38.sp, maxLines = 1)
    Text(sub, color = ink, fontFamily = Barlow, fontSize = 13.5.sp)
}

/** The owner's undo, with the same rules as the classic done panel: a reversal or a void needs a reason. */
@Composable
private fun VoidControl(result: mu.carfection.pos.core.data.SaleResult, vm: CounterViewModel) {
    var open by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    val isSplitReverse = result.paymentIds.isNotEmpty() && result.fromCollect
    val needsReason = result.paymentId != null || isSplitReverse || (result.onAccount && !result.fromCollect)
    Spacer(Modifier.height(14.dp))
    Text(
        when {
            result.onAccount && result.fromCollect -> "Undo handover — job back to Ready"
            result.onAccount -> "Void sale"
            isSplitReverse -> "Reverse the split payment"
            else -> "Void — refund & restock"
        },
        color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
        modifier = Modifier.clickable { if (needsReason) open = !open else vm.voidCompletedSale(null) }.padding(vertical = 6.dp),
    )
    if (open) {
        FilledInput(value = reason, onValueChange = { reason = it }, placeholder = "Reason (required)", modifier = Modifier.fillMaxWidth(), height = 44.dp, radius = 12.dp, bg = Inset, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.fillMaxWidth().height(48.dp).background(if (reason.isBlank()) InsetAlt else Danger, RoundedCornerShape(12.dp))
                .clickable(enabled = reason.isNotBlank()) { vm.voidCompletedSale(reason.trim()) },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (reason.isBlank()) "Enter the reason first" else "Confirm — this goes in the books",
                color = if (reason.isBlank()) TextMuted else Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp,
            )
        }
    }
}

@Composable
private fun SendReceiptsDialog(vm: CounterViewModel, onClose: () -> Unit) {
    var phone by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { if (phone.isBlank()) phone = vm.receiptPhone() }
    Dialog(onDismissRequest = onClose) {
        Column(
            Modifier.widthIn(max = 420.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("SEND ON WHATSAPP", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = 1.2.sp)
            Text("Every company's invoice goes as its own PDF.", color = TextSecondary, fontFamily = Barlow, fontSize = 14.sp)
            FilledInput(value = phone, onValueChange = { phone = it }, placeholder = "Phone, e.g. 5712 3456", modifier = Modifier.fillMaxWidth(), radius = 12.dp, bg = Inset)
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(52.dp).background(InsetAlt, RoundedCornerShape(14.dp)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                }
                val ok = phone.isNotBlank()
                Box(
                    Modifier.weight(1.4f).height(52.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(14.dp))
                        .clickable(enabled = ok) { vm.sendDoneReceipts(phone); onClose() },
                    contentAlignment = Alignment.Center,
                ) { Text("Send", color = if (ok) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
            }
        }
    }
}

@Suppress("unused") private val keepRowScope: RowScope.() -> Unit = {}
@Suppress("unused") private val keepAccentSoft = AccentSoft
@Suppress("unused") private fun keepRupees(x: Double) = rupeesToCents(x)
