package mu.carfection.pos.feature.stock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.AdjustmentRow
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.StockAdjustmentSlip
import mu.carfection.pos.core.data.StockBalance
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.data.adjustmentRow
import mu.carfection.pos.core.network.StockAdjustmentDto
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.money.shelfCents
import mu.carfection.pos.core.network.OverrideApi
import mu.carfection.pos.core.network.OverrideOutcome
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.StockProductDto
import mu.carfection.pos.core.network.UserNameDto
import mu.carfection.pos.core.network.pinErrorCopy
import mu.carfection.pos.core.catalog.AttrItem
import mu.carfection.pos.core.catalog.BrandRow
import mu.carfection.pos.core.catalog.SizeQuery
import mu.carfection.pos.core.catalog.SizeRow
import mu.carfection.pos.core.catalog.TyreSizes
import kotlin.math.roundToInt
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

// Low-stock rule (shared with the web form + DB check): blank = 10, hard cap 20.
const val DEFAULT_LOW_THRESHOLD = 10.0
const val MAX_LOW_THRESHOLD = 20.0
// Kept in step with the web's quick-reason chips (features/inventory/InventoryPanel).
// "Return to supplier" is stock going back OUT to where it came from — faulty batches,
// over-orders, wrong parts — which the shop was previously logging as "Damaged".
/**
 * How far back the printable adjustment log reaches.
 *
 * Days, not a calendar picker: the errands are "what did we do today", "this week", "since the
 * last count" — and a two-date picker on a tablet at a stock shelf is slower than three taps.
 */
enum class LogRange(val label: String, val days: Long?) {
    TODAY("Today", 0),
    WEEK("7 days", 7),
    MONTH("30 days", 30),
    ALL("Everything", null),
}

val STOCK_REASONS = listOf("Received stock", "Used in job", "Return to supplier", "Damaged", "Correction")

data class StockItem(
    val id: String,
    val name: String,
    val category: String,
    val priceCents: Long,
    val onHand: Int,
    val threshold: Double,
    val photoUrl: String? = null,
    /** "Michelin · 205/55 R16 91V"; "" when it has neither (20261127000010). */
    val attr: String = "",
) {
    val low: Boolean get() = onHand < threshold
    val zero: Boolean get() = onHand == 0
}

data class AdjustState(val productId: String, val name: String, val onHand: Int, val delta: Int = 0, val reason: String = "") {
    val result: Int get() = (onHand + delta).coerceAtLeast(0)
    /** Nothing is written until BOTH a movement and a reason exist. */
    val canApply: Boolean get() = delta != 0 && reason.isNotBlank()
}

/**
 * "Ask the owner" for one adjustment (20261128000020): anyone but the owner needs the owner's
 * PIN, and the approval is single-use and bound to exactly this product, location and quantity.
 */
data class StockApproval(
    val adj: AdjustState,
    /** Active owners of this tenant. Null = still loading. */
    val owners: List<UserNameDto>? = null,
    val ownersError: String? = null,
    val ownerId: String? = null,
    /** Masked; cleared the instant a submit resolves either way. */
    val pin: String = "",
    val busy: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean get() = !busy && ownerId != null && pin.length == 4
}

data class StockState(
    val loading: Boolean = true,
    val products: List<StockProductDto> = emptyList(),
    val onHand: Map<String, Int> = emptyMap(),
    val tab: String = "All",
    val query: String = "",
    val catQuery: String = "", // narrows the category chip row (same idea as the checkout rail)
    // Brand (grouping key, "" = any) and tyre size as typed ("205/55", "R16") — the web
    // catalogue's two filters, read by the same TyreSizes rules.
    val brandKey: String = "",
    val sizeText: String = "",
    val tenant: String? = null,
    val locationId: String? = null,
    val adj: AdjustState? = null,
    val approval: StockApproval? = null,
    // The shop quotes VAT-inclusive shelf prices — show gross here too. Display only.
    val pricesInclVat: Boolean = false,
    val vatDefault: Double = 15.0,
    val busy: Boolean = false,
    val toast: String? = null,
    val error: String? = null,
    // ── the printable adjustment log ──────────────────────────────────────────
    val logOpen: Boolean = false,
    val logBusy: Boolean = false,
    val log: List<AdjustmentRow> = emptyList(),
    /** Ids ticked for printing. Everything loaded starts ticked — the common case is
     *  "print what I just did", and un-ticking a few is less work than ticking many. */
    val logPicked: Set<String> = emptySet(),
    val logPrinting: Boolean = false,
    /** Which stretch of time the log covers. */
    val logRange: LogRange = LogRange.WEEK,
) {
    val logSelected: List<AdjustmentRow> get() = log.filter { it.id in logPicked }
    val logAllPicked: Boolean get() = log.isNotEmpty() && logPicked.size == log.size
}

@HiltViewModel
class StockViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val printer: mu.carfection.pos.core.hardware.ReceiptPrinter,
    private val hw: mu.carfection.pos.core.hardware.HardwareSettings,
    private val session: SessionRepository,
    private val overrideApi: OverrideApi,
) : ViewModel() {
    private val _s = MutableStateFlow(StockState())
    val state = _s.asStateFlow()

    /** The owner IS the authorisation; everyone else asks for the owner's PIN per adjustment. */
    private val isOwner: Boolean get() = session.userRole.equals("owner", true)
    /** The adjust dialog's Apply says up front that the owner's PIN comes next. */
    val needsOwner: Boolean get() = !isOwner

    init {
        load()
        // Live, so a settings sync landing after this screen opened still flips the prices.
        viewModelScope.launch {
            catalog.pricesInclVatFlow.collect { incl -> _s.update { it.copy(pricesInclVat = incl) } }
        }
    }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            _s.update { it.copy(vatDefault = runCatching { catalog.vatDefault() }.getOrDefault(15.0)) }
            runCatching {
                val products = api.fetchStockProducts()
                // Count the same location this screen ADJUSTS. It used to sum
                // every location while writing its adjustments to the selling
                // floor, so the number on screen was never the one you changed.
                val loc = api.fetchShopLocationId()
                val onHand = api.fetchStockOnHand(loc).groupBy { it.productId }
                    .mapValues { (_, rows) -> rows.sumOf { it.qtyOnHand }.roundToInt() }
                val tenant = catalog.tenantId()
                Quad(products, onHand, loc, tenant)
            }.onSuccess { (products, onHand, loc, tenant) ->
                _s.update { it.copy(loading = false, products = products, onHand = onHand, locationId = loc, tenant = tenant) }
            }.onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    private data class Quad(val products: List<StockProductDto>, val onHand: Map<String, Int>, val loc: String?, val tenant: String?)

    // "All" always survives the chip search, so there is always a way back out.
    fun tabs(s: StockState): List<String> {
        val q = s.catQuery.trim()
        return listOf("All") + s.products.mapNotNull { it.category?.ifBlank { null } }.distinct().sorted()
            .filter { q.isEmpty() || it.contains(q, ignoreCase = true) }
    }

    fun setTab(t: String) = _s.update { it.copy(tab = t) }
    fun setQuery(q: String) = _s.update { it.copy(query = q) }
    fun setCatQuery(q: String) = _s.update { it.copy(catQuery = q) }
    fun setBrand(key: String) = _s.update { it.copy(brandKey = key) }
    fun setSizeText(t: String) = _s.update { it.copy(sizeText = t) }
    fun clearBrandSize() = _s.update { it.copy(brandKey = "", sizeText = "") }

    /** Stock counted here is the SHOP count — what this screen shows and adjusts. */
    private fun attrItems(s: StockState) = s.products.map { AttrItem(it.brand, it.tyreSize, (s.onHand[it.id] ?: 0).toDouble()) }
    fun brands(s: StockState): List<BrandRow> = TyreSizes.brandOptions(attrItems(s))
    fun hasSizes(s: StockState) = s.products.any { it.tyreSize != null }
    fun sizeQuery(s: StockState): SizeQuery? = TyreSizes.parseSizeQuery(s.sizeText)?.takeIf { it.isSet }
    /** Typed something that is not a size — the box goes red rather than silently matching all. */
    fun sizeBad(s: StockState) = s.sizeText.isNotBlank() && sizeQuery(s) == null
    fun brandsForSize(s: StockState, q: SizeQuery): List<BrandRow> = TyreSizes.brandsForSize(attrItems(s), q)
    fun sizesForBrand(s: StockState): List<SizeRow> = TyreSizes.sizesForBrand(attrItems(s), s.brandKey)

    fun items(s: StockState): List<StockItem> {
        val q = s.query.trim()
        val size = sizeQuery(s)
        return s.products
            .filter { s.tab == "All" || it.category == s.tab }
            .filter { TyreSizes.matchesFilter(it.brand, it.tyreSize, s.brandKey, size) }
            .filter {
                // name, category, barcode (the scanner types into the field too), brand, tyre size
                q.isEmpty() || TyreSizes.searchMatches(q, listOf(it.name, it.category, it.barcode), it.brand, it.tyreSize, it.tyreLoadIndex, it.tyreSpeedRating)
            }
            .map {
                val net = rupeesToCents(it.sellingPrice)
                StockItem(
                    it.id, it.name, it.category ?: "—",
                    // A price_includes_vat product's stored figure IS the exact gross — show it
                    // verbatim, never re-grossed (20260812000030). shelfCents mirrors every till surface.
                    shelfCents(net, it.vatRate ?: s.vatDefault, s.pricesInclVat, it.priceIncludesVat),
                    s.onHand[it.id] ?: 0,
                    (it.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD),
                    mu.carfection.pos.core.data.productPhotoUrl(it.photoPath),
                    listOfNotNull(it.brand?.ifBlank { null }, it.tyreSize?.let { z -> TyreSizes.formatSpec(z, it.tyreLoadIndex, it.tyreSpeedRating) }).joinToString(" · "),
                )
            }
    }

    fun lowCount(s: StockState): Int =
        s.products.count { (s.onHand[it.id] ?: 0) < (it.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD) }

    fun clearToast() = _s.update { it.copy(toast = null) }

    /**
     * ±1 from the card. It used to post immediately with the note "Quick +1", which recorded
     * THAT stock moved but never WHY — so the ledger, and the printed log built from it, could
     * not answer the only question worth asking of an adjustment. It now opens the adjust
     * dialog with the step already applied; a reason still has to be chosen before it commits.
     */
    fun quickAdjust(item: StockItem, delta: Int) {
        if (delta < 0 && item.onHand <= 0) return
        _s.update { it.copy(adj = AdjustState(item.id, item.name, item.onHand, delta = delta)) }
    }

    // ── printable adjustment log ──────────────────────────────────────────────
    fun openLog() {
        _s.update { it.copy(logOpen = true) }
        reloadLog()
    }

    fun setLogRange(r: LogRange) {
        if (_s.value.logRange == r) return
        _s.update { it.copy(logRange = r) }
        reloadLog()
    }

    /** Mauritius day bounds (UTC+4), so "Today" is the shop's today and not UTC's. */
    private fun reloadLog() {
        _s.update { it.copy(logBusy = true) }
        viewModelScope.launch {
            val range = _s.value.logRange
            val mu = java.time.ZoneId.of("Indian/Mauritius")
            val today = java.time.ZonedDateTime.now(mu).toLocalDate()
            val fromIso = range.days?.let {
                today.minusDays(it).atStartOfDay(mu).toOffsetDateTime().toString()
            }
            val dtos = runCatching { api.fetchStockAdjustments(fromIso = fromIso) }.getOrDefault(emptyList())
            val after = balancesAfter(dtos)
            val rows = dtos.map { adjustmentRow(it).copy(balanceAfter = after[it.id]) }
            // Everything in range starts ticked: the usual errand is "print what is on screen",
            // and un-ticking a few beats ticking many.
            _s.update { it.copy(logBusy = false, log = rows, logPicked = rows.map { r -> r.id }.toSet()) }
        }
    }

    /**
     * "→ N on hand" for each log row — the web Inventory ledger's "Stock after". Its own
     * runCatching: if this read fails the log still lists, just without the counts.
     */
    private suspend fun balancesAfter(log: List<StockAdjustmentDto>): Map<String, Double> {
        val oldest = log.lastOrNull()?.movedAt ?: return emptyMap() // newest first, so last = oldest
        val ids = log.mapNotNull { it.productId }
        if (ids.isEmpty()) return emptyMap()
        return runCatching {
            StockBalance.after(api.fetchMovesSince(ids, oldest), api.fetchStockOnHandFor(ids))
        }.getOrDefault(emptyMap())
    }

    fun closeLog() = _s.update { it.copy(logOpen = false, log = emptyList(), logPicked = emptySet()) }

    fun toggleLogRow(id: String) = _s.update {
        it.copy(logPicked = if (id in it.logPicked) it.logPicked - id else it.logPicked + id)
    }

    fun toggleLogAll() = _s.update {
        it.copy(logPicked = if (it.logAllPicked) emptySet() else it.log.map { r -> r.id }.toSet())
    }

    /** Print the ticked adjustments. Nothing ticked prints nothing — say so instead. */
    fun printLog() {
        val picked = _s.value.logSelected
        if (picked.isEmpty()) { _s.update { it.copy(toast = "Tick at least one adjustment") }; return }
        _s.update { it.copy(logPrinting = true) }
        viewModelScope.launch {
            val at = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm"))
            // The paper has to say WHICH stretch it covers, or a filed slip is unreadable later.
            val text = StockAdjustmentSlip.render(
                picked, catalog.receiptBiz(), printerWidth(), at, _s.value.logRange.label,
            )
            val ok = runCatching { printer.printReceipt(text) }.isSuccess
            _s.update {
                it.copy(
                    logPrinting = false,
                    toast = if (ok) "Printed ${picked.size} adjustment${if (picked.size == 1) "" else "s"}"
                    else "Couldn't reach the printer — check it's on and paired",
                )
            }
        }
    }

    /** 58mm rolls fit 32 columns, 80mm fit 48 — the same rule TillZReport applies. */
    private suspend fun printerWidth(): Int =
        runCatching { if (hw.config.first().paperWidthMm == 58) 32 else 48 }.getOrDefault(48)

    fun openAdj(item: StockItem) = _s.update { it.copy(adj = AdjustState(item.id, item.name, item.onHand)) }
    fun closeAdj() = _s.update { it.copy(adj = null) }
    fun adjStep(delta: Int) = _s.update { st ->
        val a = st.adj ?: return@update st
        st.copy(adj = a.copy(delta = (a.delta + delta).coerceAtLeast(-a.onHand)))
    }
    fun adjReason(r: String) = _s.update { st -> st.adj?.let { st.copy(adj = it.copy(reason = r)) } ?: st }

    fun adjApply() {
        val a = _s.value.adj ?: return
        if (a.delta == 0) { _s.update { it.copy(adj = null) }; return }
        // The dialog already disables Apply without a reason; this is the guarantee the
        // LEDGER gets, independent of whatever the UI does.
        if (a.reason.isBlank()) { _s.update { it.copy(toast = "Pick a reason first") }; return }
        if (!isOwner) { openApproval(a); return }
        _s.update { it.copy(adj = null) }
        post(a.productId, a.delta, a.reason, a.result, "${a.name} → ${a.result} on hand")
    }

    // ── owner approval ────────────────────────────────────────────────────────
    private fun openApproval(a: AdjustState) {
        _s.update { it.copy(adj = null, approval = StockApproval(a)) }
        // Fetched fresh each time: an RLS read that runs before the session is ready returns
        // an empty list rather than an error, so a cached one could strand the picker.
        viewModelScope.launch {
            runCatching { api.fetchApprovingOwners() }
                .onSuccess { list ->
                    _s.update { st -> st.approval?.let { ap -> st.copy(approval = ap.copy(owners = list, ownerId = ap.ownerId ?: list.singleOrNull()?.id)) } ?: st }
                }
                .onFailure { e -> _s.update { st -> st.approval?.let { st.copy(approval = it.copy(ownersError = e.uiMessage())) } ?: st } }
        }
    }

    /** Back to the adjust dialog, with the move and reason still filled in. */
    fun closeApproval() = _s.update { st -> st.copy(adj = st.approval?.adj, approval = null) }
    fun pickApprovalOwner(id: String) = _s.update { st -> st.approval?.let { st.copy(approval = it.copy(ownerId = id, error = null)) } ?: st }
    fun setApprovalPin(p: String) = _s.update { st -> st.approval?.let { st.copy(approval = it.copy(pin = p.filter(Char::isDigit).take(4), error = null)) } ?: st }

    fun submitApproval() {
        val ap = _s.value.approval ?: return
        val ownerId = ap.ownerId ?: return
        if (!ap.canSubmit) return
        val loc = _s.value.locationId
        if (loc == null) { _s.update { it.copy(toast = "Not synced — pull the catalogue first") }; return }
        val a = ap.adj
        _s.update { st -> st.copy(approval = ap.copy(busy = true, error = null)) }
        viewModelScope.launch {
            val result = overrideApi.requestOverride(
                appUserId = ownerId, pin = ap.pin, kind = "stock_adjustment", refType = "product",
                refId = a.productId, reason = a.reason, locationId = loc, qty = a.delta.toDouble(),
            )
            // Win or lose, the PIN has done its job — never held past the one request.
            val fail: String? = when (result) {
                is OverrideOutcome.Approved -> null
                is OverrideOutcome.PinRejected -> pinErrorCopy(result.reason)
                OverrideOutcome.NotOwner -> "That didn't check out as an owner — try again."
                is OverrideOutcome.Failed -> result.message
            }
            if (fail != null) {
                _s.update { st -> st.approval?.let { st.copy(approval = it.copy(pin = "", busy = false, error = fail)) } ?: st }
                return@launch
            }
            _s.update { it.copy(approval = null) }
            post(a.productId, a.delta, a.reason, a.result, "${a.name} → ${a.result} on hand (owner approved)")
        }
    }

    private fun post(productId: String, delta: Int, note: String, newOnHand: Int, toast: String? = null) {
        val s = _s.value
        val loc = s.locationId
        if (s.tenant == null || loc == null) { _s.update { it.copy(toast = "Not synced — pull the catalogue first") }; return }
        _s.update { it.copy(onHand = it.onHand + (productId to newOnHand), toast = toast) }
        viewModelScope.launch {
            // record_stock_adjustment stamps who moved it and, for anyone but the owner,
            // consumes the owner's approval for exactly this move.
            runCatching { api.adjustStock(productId, loc, delta.toDouble(), note) }
                .onFailure { e ->
                    val m = e.message.orEmpty()
                    val msg = when {
                        m.contains("requires the owner", true) -> "That adjustment needs the owner's approval"
                        m.contains("not open to this role", true) -> "Your role can't adjust stock"
                        else -> "Couldn't save the adjustment — try again"
                    }
                    _s.update { it.copy(error = e.uiMessage(), toast = msg) }; load()
                }
        }
    }
}
