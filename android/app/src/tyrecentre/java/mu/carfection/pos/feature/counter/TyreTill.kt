package mu.carfection.pos.feature.counter

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CallSplit
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.SERVICES_TAB
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.shelfCents
import mu.carfection.pos.core.network.CompanyDto
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentBlue
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.EntityColours
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TcBody
import mu.carfection.pos.ui.theme.TcFainter
import mu.carfection.pos.ui.theme.TcHighlight
import mu.carfection.pos.ui.theme.TcOnHighlight
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning
import mu.carfection.pos.ui.theme.entityColours
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// The tyre centre's own Till and Paid screens (docs/redesign/DESIGN-SPEC.md §6.4, §6.5, §7;
// mockups docs/redesign/screens/tablet-till.png and tablet-paid-receipts.png). Only this flavor
// compiles this file: Carfectionist's flavor has a stub with TYRE_TILL = false, so its checkout
// stays exactly as it was. Every action goes through the same CounterViewModel calls the classic
// checkout uses — this file is layout only.

internal const val TYRE_TILL = true

/** The company a product sells under, as an index in the shop's company order (0 = main). */
private fun companyIndexOf(companyId: String?, companies: List<CompanyDto>): Int =
    companies.indexOfFirst { it.id == companyIdOfProduct(companyId, companies) }.coerceAtLeast(0)

/** The selection colour of a company's tiles: the main company's is the black pill, the others their accent. */
private fun ringColour(index: Int): Color = if (index == 0) Accent else entityColours(index).accent

/** "Rs 2,950" on a tile — the whole rupees when there are no cents, as the mockup reads. */
private fun tilePrice(cents: Long): String = formatMUR(cents).let { if (it.endsWith(".00")) it.dropLast(3) else it }

/** Amounts inside a bill block read like the slip: "11,800.00", no currency. */
private fun plainAmount(cents: Long): String = formatMUR(cents).removePrefix("Rs ").removePrefix("Rs").trim()

private fun Modifier.dashed(color: Color, radius: Dp, stroke: Dp = 1.5.dp) = this.drawBehind {
    val sw = stroke.toPx(); val r = radius.toPx()
    drawRoundRect(
        color = color, topLeft = Offset(sw / 2, sw / 2), size = Size(size.width - sw, size.height - sw),
        cornerRadius = CornerRadius(r, r), style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(sw * 4, sw * 3))),
    )
}

@Composable
private fun DashLine(color: Color) = Canvas(Modifier.fillMaxWidth().height(1.dp)) {
    drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f)))
}

/** The tyre mark beside the first company's name: a ring with a hub. */
@Composable
private fun TyreMark(color: Color) = Canvas(Modifier.size(16.dp)) {
    drawCircle(color, radius = size.minDimension / 2 - 1.dp.toPx(), style = Stroke(1.8.dp.toPx()))
    drawCircle(color, radius = 2.2.dp.toPx())
}

private val MonoLabel = 10.5.sp

// ─── Till ────────────────────────────────────────────────────────────────────

@Composable
internal fun TyreTill(s: CounterUiState, vm: CounterViewModel, onOpenTill: () -> Unit) {
    val device by produceState("", vm) { value = vm.deviceCode() }
    Row(Modifier.fillMaxSize().background(ScreenBg).padding(start = 14.dp, top = 10.dp, end = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            TillHeader(s, vm, device, onOpenTill)
            CategoryChips(s, vm)
            ProductGrid(s, vm, Modifier.weight(1f))
        }
        CartPanel(s, vm, Modifier.width(390.dp).fillMaxHeight())
    }
}

@Composable
private fun TillHeader(s: CounterUiState, vm: CounterViewModel, device: String, onOpenTill: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            val till = s.till
            val opened = till?.openedAt?.let { iso ->
                runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm")) }.getOrNull()
            }
            Text(
                if (till != null) listOfNotNull("TILL", device.ifBlank { null }, opened?.let { "OPEN $it" }).joinToString(" · ")
                else "TILL CLOSED · TAP TO OPEN",
                color = if (till != null) TextMuted else Warning, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.4.sp,
                modifier = Modifier.clickable(onClick = onOpenTill),
            )
            Text("New sale", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 26.sp)
        }
        // The search box is also where a barcode scanner types (CounterViewModel.setQuery).
        FilledInput(
            value = s.query, onValueChange = vm::setQuery, placeholder = "Size, brand, plate…",
            modifier = Modifier.width(300.dp), height = 52.dp, radius = 26.dp, bg = CardBg, leadingSearch = true,
        )
        Box(
            Modifier.size(52.dp).background(Accent, CircleShape).clickable { vm.setQuery("") },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Outlined.QrCodeScanner, contentDescription = "Scan", tint = AccentInk, modifier = Modifier.size(22.dp)) }
    }
}

@Composable
private fun CategoryChips(s: CounterUiState, vm: CounterViewModel) {
    // Each category's colour square is the company that sells most of it, learnt while "All" shows
    // the whole catalogue (the filtered tabs only hold their own products).
    val dots = remember { mutableStateMapOf<String, Int>() }
    LaunchedEffect(s.tab, s.products, s.companies) {
        if (s.tab != "All") return@LaunchedEffect
        s.products.groupBy { it.category }.forEach { (cat, ps) ->
            if (cat != null) dots[cat] = ps.groupingBy { companyIndexOf(it.legalEntityId, s.companies) }.eachCount().maxByOrNull { it.value }?.key ?: 0
        }
        s.products.filter { it.kind == "service" }.takeIf { it.isNotEmpty() }?.let { ps ->
            dots[SERVICES_TAB] = ps.groupingBy { companyIndexOf(it.legalEntityId, s.companies) }.eachCount().maxByOrNull { it.value }?.key ?: 0
        }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            s.categories.forEach { c ->
                val on = c == s.tab
                Row(
                    Modifier.height(46.dp).background(if (on) Accent else CardBg, RoundedCornerShape(23.dp))
                        .clickable { vm.setTab(c) }.padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    dots[c]?.takeIf { c != "All" }?.let { i ->
                        Box(Modifier.size(9.dp).background(if (i == 0) entityColours(0).accent else entityColours(i).accent, RoundedCornerShape(2.dp)))
                    }
                    Text(c, color = if (on) AccentInk else TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 1)
                }
            }
        }
        // Back to the TO COLLECT list (job bills and held sales) — the mockup's till has no list.
        // Leaving ends the sale (backToList starts a fresh one), so it only shows on an empty
        // cart; with lines in it, "Cancel sale" in the footer is the honest way out.
        if (s.cart.isEmpty()) Spacer(Modifier.width(10.dp))
        if (s.cart.isEmpty()) Box(
            Modifier.height(46.dp).background(CardBg, RoundedCornerShape(23.dp)).border(1.dp, Hairline, RoundedCornerShape(23.dp))
                .clickable { vm.backToList() }.padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center,
        ) { Text("To collect", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
    }
}

@Composable
private fun ProductGrid(s: CounterUiState, vm: CounterViewModel, modifier: Modifier) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3), modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(s.products, key = { it.id }) { p ->
            val qty = s.cart.firstOrNull { it.product.id == p.id }?.qty?.toInt()
            TillTile(p, qty, s.onHand[p.id], s.pricesInclVat, s.companies) { vm.add(p) }
        }
        item(key = "custom-line") {
            Column(
                Modifier.height(150.dp).dashed(Color(0x380F1720), 22.dp).clickable { vm.openAdhoc() },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(24.dp))
                Spacer(Modifier.height(8.dp))
                Text("Custom line", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp)
                Text(if (s.several) "Pick the company" else "Priced by hand", color = TcFainter, fontFamily = Barlow, fontSize = 12.5.sp)
            }
        }
    }
}

@Composable
private fun TillTile(p: ProductEntity, inCart: Int?, onHand: Int?, inclVat: Boolean, companies: List<CompanyDto>, onAdd: () -> Unit) {
    val idx = companyIndexOf(p.legalEntityId, companies)
    val company = companies.getOrNull(idx)
    val selected = inCart != null && inCart > 0
    val ring = ringColour(idx)
    Box(
        Modifier.height(150.dp).background(CardBg, RoundedCornerShape(22.dp))
            .border(if (selected) 2.5.dp else 1.dp, if (selected) ring else Hairline, RoundedCornerShape(22.dp))
            .clickable(onClick = onAdd),
    ) {
        Column(Modifier.fillMaxSize().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 14.dp)) {
            val service = p.kind == "service"
            val label = when {
                service && company != null && !company.vatRegistered -> "SERVICE · NO VAT"
                service -> "SERVICE"
                else -> (p.category ?: "PRODUCT").uppercase()
            }
            Text(
                label, color = if (idx > 0) entityColours(idx).ink else TextMuted, fontFamily = Mono, fontSize = 10.sp,
                letterSpacing = 1.2.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 40.dp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                p.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 20.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = if (selected) 40.dp else 0.dp),
            )
            Spacer(Modifier.weight(1f))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    tilePrice(shelfCents(p.sellingPriceCents, p.vatRatePct, inclVat, p.priceInclusive)),
                    color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 22.sp,
                    maxLines = 1, modifier = Modifier.weight(1f),
                )
                if (p.isStocked) {
                    val oh = onHand ?: 0
                    val (t, c) = when {
                        oh <= 0 -> "Out of stock" to Danger
                        oh <= 5 -> "$oh left" to Warning
                        else -> "$oh left" to Success
                    }
                    Text(t, color = c, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                }
            }
        }
        if (selected) Box(
            Modifier.align(Alignment.TopEnd).padding(top = 14.dp, end = 14.dp).size(36.dp).background(ring, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text(inCart.toString(), color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
    }
}

// ─── the cart: one bill per company ─────────────────────────────────────────

/** One bill block as the cart draws it — a real company bill, or the whole sale on a one-company till. */
private data class Block(val companyId: String?, val name: String, val vatRegistered: Boolean, val index: Int, val lines: List<Int>, val totalCents: Long, val vatCents: Long, val discText: String, val blockReason: String?)

private fun blocksOf(s: CounterUiState): List<Block> =
    if (s.tillBills.isNotEmpty()) s.tillBills.map { b ->
        Block(b.company.id, b.name, b.company.vatRegistered, companyIndexOf(b.company.id, s.companies), b.lineIndexes, b.totals.totalCents, b.totals.vatCents, b.disc.text, b.blockReason)
    } else if (s.cart.isNotEmpty()) listOf(
        Block(null, s.companies.firstOrNull()?.let(::companyName) ?: mu.carfection.pos.ui.theme.Brand.NAME, true, 0, s.cart.indices.toList(), s.totals.totalCents, s.totals.vatCents, s.basketText, s.discountBlockReason),
    ) else emptyList()

@Composable
private fun CartPanel(s: CounterUiState, vm: CounterViewModel, modifier: Modifier) {
    Column(modifier.background(CardBg, RoundedCornerShape(26.dp))) {
        CustomerHeader(s, vm)
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        val blocks = blocksOf(s)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (blocks.isEmpty()) Text(
                "Tap a tyre or a service to start the sale.", color = TextMuted, fontFamily = Barlow, fontSize = 13.5.sp,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 18.dp),
            )
            blocks.forEach { b -> BillBlock(s, vm, b) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        CartFooter(s, vm, blocks.size)
    }
}

@Composable
private fun CustomerHeader(s: CounterUiState, vm: CounterViewModel) {
    var editing by remember { mutableStateOf(false) }
    val name = s.customerText.trim()
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val initials = name.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "W" }
            Box(
                Modifier.size(44.dp).background(Brush.linearGradient(listOf(Color(0xFF3D8BFF), AccentBlue)), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) { Text(initials, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
            Column(Modifier.weight(1f)) {
                Text(name.ifBlank { "Walk-in customer" }, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (s.customerId != null) "ON FILE" else if (name.isNotEmpty()) "NEW · NOT ON FILE" else "TAP TO ADD THE CUSTOMER",
                    color = TextMuted, fontFamily = Mono, fontSize = 10.5.sp, letterSpacing = 1.sp,
                )
            }
            Box(
                Modifier.size(44.dp).border(1.dp, Hairline, CircleShape).clickable { editing = !editing },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ManageAccounts, contentDescription = "Customer", tint = TextPrimary, modifier = Modifier.size(20.dp)) }
        }
        if (editing) {
            Spacer(Modifier.height(10.dp))
            FilledInput(
                value = s.customerText, onValueChange = vm::setCustomerText, placeholder = "Customer name",
                modifier = Modifier.fillMaxWidth(), height = 42.dp, radius = 12.dp, bg = Inset, fontSize = 14.sp,
            )
            s.customerMatches.forEach { c ->
                Text(
                    c.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.fillMaxWidth().clickable { vm.pickCustomer(c); editing = false }.padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun BillBlock(s: CounterUiState, vm: CounterViewModel, b: Block) {
    val c: EntityColours = entityColours(b.index)
    var discOpen by remember(b.companyId) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().background(c.tint, RoundedCornerShape(16.dp))
            .border(1.dp, if (b.blockReason != null) Danger else c.border, RoundedCornerShape(16.dp)).padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (b.index == 0) TyreMark(c.icon) else Icon(Icons.Outlined.Build, contentDescription = null, tint = c.icon, modifier = Modifier.size(16.dp))
            Text(b.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(if (b.vatRegistered) "VAT 15%" else "NO VAT", color = c.ink, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 0.6.sp)
        }
        Spacer(Modifier.height(8.dp))
        b.lines.forEach { i ->
            val l = s.cart.getOrNull(i) ?: return@forEach
            Row(
                Modifier.fillMaxWidth().clickable { vm.toggleLine(l.product.id) }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${l.qty.toInt()}×", color = TextMuted, fontFamily = Mono, fontSize = 12.sp, modifier = Modifier.width(30.dp))
                Text(l.product.name, color = TcBody, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(
                    plainAmount(if (s.pricesInclVat) s.rowGrossCents(i) else s.docTotals.lineExclCents.getOrElse(i) { 0L }),
                    color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                )
            }
            if (l.expanded) Row(
                Modifier.fillMaxWidth().padding(start = 30.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoundKey("−") { vm.setQty(l.product.id, l.qty - 1) }
                Text(l.qty.toInt().toString(), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                RoundKey("+") { vm.setQty(l.product.id, l.qty + 1) }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.size(34.dp).background(Color(0x14D63B50), CircleShape).clickable { vm.setQty(l.product.id, 0.0) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Remove", tint = Danger, modifier = Modifier.size(18.dp)) }
            }
        }
        Spacer(Modifier.height(6.dp))
        DashLine(c.dash)
        Spacer(Modifier.height(8.dp))
        val disc = b.discText.isNotBlank()
        if (b.vatRegistered && b.vatCents > 0) Row(Modifier.fillMaxWidth()) {
            Text(
                if (s.pricesInclVat) "of which VAT 15%" else "+ VAT 15% on ${plainAmount(b.totalCents - b.vatCents)}",
                color = TextMuted, fontFamily = Barlow, fontSize = 11.5.sp, modifier = Modifier.weight(1f),
            )
            Text(plainAmount(b.vatCents), color = TextMuted, fontFamily = Mono, fontSize = 11.5.sp)
        }
        // Each company's bill has its own discount (owner rule): open it here, on this bill.
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (disc) "Discount · ${b.discText}${if (s.discFocusFor(b) == DiscountMode.PCT) "%" else " off"}" else "+ Discount",
                color = if (disc) Success else c.ink, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                modifier = Modifier.weight(1f).clickable { b.companyId?.let(vm::setDiscFocus); discOpen = !discOpen },
            )
        }
        if (discOpen) DiscountEditor(s, vm, b)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Total", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, modifier = Modifier.weight(1f))
            Text(plainAmount(b.totalCents), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        b.blockReason?.let { Text(it, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, modifier = Modifier.padding(top = 6.dp)) }
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
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(DiscountMode.PCT to "%", DiscountMode.AMT to "Rs").forEach { (m, t) ->
                val on = s.discMode == m
                Box(
                    Modifier.height(32.dp).background(if (on) Accent else CardBg, RoundedCornerShape(16.dp))
                        .border(1.dp, Hairline, RoundedCornerShape(16.dp)).clickable { vm.setBasketMode(m) }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(t, color = if (on) AccentInk else TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp) }
            }
            FilledInput(
                value = s.discText, onValueChange = vm::setBasketText, placeholder = if (s.discMode == DiscountMode.PCT) "0" else "0.00",
                modifier = Modifier.width(110.dp), height = 32.dp, radius = 16.dp, bg = CardBg, fontSize = 13.sp,
            )
        }
        if (s.allowance.reasonRequired || s.discReason.isNotBlank()) FilledInput(
            value = s.discReason, onValueChange = vm::setDiscountReason, placeholder = "Why — e.g. regular customer",
            modifier = Modifier.fillMaxWidth(), height = 34.dp, radius = 12.dp, bg = CardBg, fontSize = 12.5.sp,
        )
        if (b.blockReason != null && s.blockAllowance.overCeiling) Text(
            "Ask the owner →", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp,
            modifier = Modifier.clickable { vm.askOwner() },
        )
    }
}

@Composable
private fun RoundKey(t: String, onClick: () -> Unit) = Box(
    Modifier.size(30.dp).background(CardBg, CircleShape).border(1.dp, Hairline, CircleShape).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
) { Text(t, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp) }

@Composable
private fun CartFooter(s: CounterUiState, vm: CounterViewModel, receipts: Int) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(
            "TO PAY · $receipts ${if (receipts == 1) "RECEIPT" else "RECEIPTS"}",
            color = TextMuted, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.2.sp,
        )
        Text(formatMUR(s.totals.totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 30.sp)
        s.error?.takeUnless { s.padOpen }?.let { Text(it, color = Danger, fontFamily = Barlow, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
        val ready = s.cart.isNotEmpty() && s.discountBlockReason == null
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FooterKey("Split", Icons.Outlined.CallSplit, Modifier.weight(1f), enabled = ready) { vm.openPad(); vm.toggleSplit() }
            // Ends this sale and goes back to the TO COLLECT list (the classic "Cancel counter sale").
            FooterKey("Cancel sale", Icons.Outlined.DeleteOutline, Modifier.weight(1f), enabled = true) { vm.backToList() }
        }
        Spacer(Modifier.height(10.dp))
        Row(
            Modifier.fillMaxWidth().height(64.dp).background(if (ready) Accent else InsetAlt, RoundedCornerShape(32.dp))
                .clickable(enabled = ready) { vm.openPad() }.padding(start = 24.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Charge ${formatMUR(s.totals.totalCents)}", color = if (ready) AccentInk else TextMuted,
                fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Box(Modifier.size(40.dp).background(if (ready) TcHighlight else CardBg, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = TcOnHighlight, modifier = Modifier.size(20.dp))
            }
        }
    }
}

@Composable
private fun FooterKey(t: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) = Row(
    modifier.height(54.dp).background(Inset, RoundedCornerShape(16.dp)).clickable(enabled = enabled, onClick = onClick),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
) {
    Icon(icon, contentDescription = null, tint = if (enabled) TextPrimary else TextMuted, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(8.dp))
    Text(t, color = if (enabled) TextPrimary else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp)
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
            Modifier.widthIn(max = 460.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(24.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Custom line", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            if (s.several && main != null) {
                Text(
                    "Billed by ${companyName(main)}${if (main.vatRegistered) " with VAT" else ""}. Services sold by another company are picked from the catalogue.",
                    color = TextSecondary, fontFamily = Barlow, fontSize = 13.5.sp,
                )
            }
            Text("DESCRIPTION", color = TextMuted, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.2.sp)
            FilledInput(value = name, onValueChange = { name = it }, placeholder = "e.g. Rim straightening", modifier = Modifier.fillMaxWidth(), radius = 14.dp, bg = Inset)
            Text(
                if (s.pricesInclVat) "PRICE (Rs, incl. VAT)" else "PRICE (Rs, excl. VAT)",
                color = TextMuted, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.2.sp,
            )
            FilledInput(value = price, onValueChange = { p -> price = p.filter { it.isDigit() || it == '.' } }, placeholder = "0.00", modifier = Modifier.fillMaxWidth(), radius = 14.dp, bg = Inset)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(54.dp).background(Inset, RoundedCornerShape(18.dp)).clickable { vm.closeAdhoc() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp) }
                Box(
                    Modifier.weight(1.4f).height(54.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(27.dp))
                        .clickable(enabled = ok) { vm.addAdhoc(name, cents ?: 0) },
                    contentAlignment = Alignment.Center,
                ) { Text("Add line", color = if (ok) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
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
    Row(Modifier.fillMaxSize().background(ScreenBg).padding(start = 14.dp, top = 10.dp, end = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.width(400.dp).fillMaxHeight().background(CardBg, RoundedCornerShape(30.dp)).padding(28.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(64.dp).background(TcHighlight, CircleShape), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = TextPrimary, modifier = Modifier.size(30.dp))
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "Done", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        modifier = Modifier.clickable { vm.backToList() }.padding(8.dp),
                    )
                }
                Spacer(Modifier.height(22.dp))
                val n = bills.size
                Text(
                    when {
                        result.offlineRef != null -> "PAID · HELD ON THIS TABLET"
                        result.onAccount -> "ON ACCOUNT · $n ${if (n == 1) "BILL" else "BILLS"}"
                        else -> "PAID · ${methodLabel.uppercase()} · $n ${if (n == 1) "RECEIPT" else "RECEIPTS"}"
                    },
                    color = TextMuted, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.6.sp,
                )
                Text(formatMUR(result.totalCents), color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 36.sp)
                Spacer(Modifier.height(16.dp))
                when {
                    result.onAccount -> DarkCard("OWED", formatMUR(result.totalCents), "by ${result.debtor ?: s.customerText.trim().ifBlank { "the customer" }} — on their statement")
                    result.changeCents > 0 -> DarkCard("GIVE CHANGE", formatMUR(result.changeCents), "Tendered ${formatMUR(result.totalCents + result.changeCents)}")
                    result.offlineRef != null -> DarkCard("HELD", result.offlineRef, "The invoices follow when the tablet is back online")
                }
                Spacer(Modifier.height(18.dp))
                bills.forEach { b ->
                    val idx = companyIndexOf(b.legalEntityId, s.companies)
                    val co = s.companies.getOrNull(idx)
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).background(entityColours(idx).accent, RoundedCornerShape(2.dp)))
                        Spacer(Modifier.width(10.dp))
                        Text((co?.let(::companyName) ?: "Invoice") + " · ", color = TcBody, fontFamily = Barlow, fontSize = 14.sp)
                        Text(b.number ?: "—", color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        Text(plainAmount(b.totalCents), color = TextPrimary, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
                    }
                }
                if (vm.canManage && result.offlineRef == null) VoidControl(result, vm)
            }
            Spacer(Modifier.height(12.dp))
            var sendOpen by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FooterKey("Print again", Icons.Outlined.Print, Modifier.weight(1f), enabled = slips.isNotEmpty()) { vm.reprint() }
                FooterKey("WhatsApp", Icons.Outlined.Chat, Modifier.weight(1f), enabled = result.offlineRef == null && !s.busy) { sendOpen = true }
            }
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().height(64.dp).background(Accent, RoundedCornerShape(32.dp)).clickable { vm.startNextSale() }.padding(end = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                Text("New sale", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Spacer(Modifier.width(14.dp))
                Box(Modifier.size(34.dp).background(TcHighlight, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Add, contentDescription = null, tint = TcOnHighlight, modifier = Modifier.size(20.dp))
                }
            }
            if (sendOpen) SendReceiptsDialog(vm, onClose = { sendOpen = false })
        }
        // The slips exactly as they printed — ReceiptPaper is the code that renders the printed slip.
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Printed receipts", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 22.sp, modifier = Modifier.weight(1f))
                if (slips.size > 1) Text("ONE PER COMPANY", color = TextMuted, fontFamily = Mono, fontSize = 10.sp, letterSpacing = 1.2.sp)
            }
            if (slips.isEmpty()) Text(
                if (result.offlineRef != null) "The receipt printed from this tablet; the invoices follow when it is back online."
                else "No receipt to show.", color = TextMuted, fontFamily = Barlow, fontSize = 13.5.sp,
            )
            Row(
                Modifier.fillMaxWidth().weight(1f).horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
            ) {
                slips.forEach { slip ->
                    val bill = bills.firstOrNull { it.number != null && it.number == slip.invoiceNo }
                    val idx = companyIndexOf(bill?.legalEntityId, s.companies)
                    Column(Modifier.width(300.dp).shadow(10.dp, RoundedCornerShape(6.dp)).background(CardBg, RoundedCornerShape(6.dp))) {
                        Box(Modifier.fillMaxWidth().height(5.dp).background(entityColours(idx).accent, RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp)))
                        ReceiptPaper(slip, Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}

@Composable
private fun DarkCard(label: String, big: String, sub: String) = Column(
    Modifier.fillMaxWidth().background(Accent, RoundedCornerShape(22.dp)).padding(horizontal = 20.dp, vertical = 18.dp),
) {
    Text(label, color = TcFainter, fontFamily = Mono, fontSize = MonoLabel, letterSpacing = 1.6.sp)
    Text(big, color = TcHighlight, fontFamily = Condensed, fontWeight = FontWeight.SemiBold, fontSize = 44.sp, maxLines = 1)
    Text(sub, color = Color(0xFFC8CDD3), fontFamily = Barlow, fontSize = 13.sp)
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
        color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
        modifier = Modifier.clickable { if (needsReason) open = !open else vm.voidCompletedSale(null) }.padding(vertical = 6.dp),
    )
    if (open) {
        FilledInput(value = reason, onValueChange = { reason = it }, placeholder = "Reason (required)", modifier = Modifier.fillMaxWidth(), height = 42.dp, radius = 12.dp, bg = Inset, fontSize = 13.5.sp)
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.fillMaxWidth().height(46.dp).background(if (reason.isBlank()) InsetAlt else Danger, RoundedCornerShape(23.dp))
                .clickable(enabled = reason.isNotBlank()) { vm.voidCompletedSale(reason.trim()) },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (reason.isBlank()) "Enter the reason first" else "Confirm — this goes in the books",
                color = if (reason.isBlank()) TextMuted else Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp,
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
            Modifier.widthIn(max = 420.dp).fillMaxWidth(0.94f).background(CardBg, RoundedCornerShape(24.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Send on WhatsApp", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Text("Every company's invoice goes as its own PDF.", color = TextSecondary, fontFamily = Barlow, fontSize = 13.sp)
            FilledInput(value = phone, onValueChange = { phone = it }, placeholder = "Phone, e.g. 5712 3456", modifier = Modifier.fillMaxWidth(), radius = 14.dp, bg = Inset)
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(52.dp).background(Inset, RoundedCornerShape(18.dp)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp)
                }
                val ok = phone.isNotBlank()
                Box(
                    Modifier.weight(1.4f).height(52.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(26.dp))
                        .clickable(enabled = ok) { vm.sendDoneReceipts(phone); onClose() },
                    contentAlignment = Alignment.Center,
                ) { Text("Send", color = if (ok) AccentInk else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
            }
        }
    }
}
