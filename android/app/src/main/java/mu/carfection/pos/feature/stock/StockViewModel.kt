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
import mu.carfection.pos.core.data.adjustmentRow
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.NewStockMovementDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.StockProductDto
import kotlin.math.roundToInt
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

// Low-stock rule (shared with the web form + DB check): blank = 10, hard cap 20.
const val DEFAULT_LOW_THRESHOLD = 10.0
const val MAX_LOW_THRESHOLD = 20.0
// Kept in step with the web's quick-reason chips (features/inventory/InventoryPanel).
// "Return to supplier" is stock going back OUT to where it came from — faulty batches,
// over-orders, wrong parts — which the shop was previously logging as "Damaged".
val STOCK_REASONS = listOf("Received stock", "Used in job", "Return to supplier", "Damaged", "Correction")

data class StockItem(
    val id: String,
    val name: String,
    val category: String,
    val priceCents: Long,
    val onHand: Int,
    val threshold: Double,
    val photoUrl: String? = null,
) {
    val low: Boolean get() = onHand < threshold
    val zero: Boolean get() = onHand == 0
}

data class AdjustState(val productId: String, val name: String, val onHand: Int, val delta: Int = 0, val reason: String = "") {
    val result: Int get() = (onHand + delta).coerceAtLeast(0)
    /** Nothing is written until BOTH a movement and a reason exist. */
    val canApply: Boolean get() = delta != 0 && reason.isNotBlank()
}

data class StockState(
    val loading: Boolean = true,
    val products: List<StockProductDto> = emptyList(),
    val onHand: Map<String, Int> = emptyMap(),
    val tab: String = "All",
    val query: String = "",
    val catQuery: String = "", // narrows the category chip row (same idea as the checkout rail)
    val tenant: String? = null,
    val locationId: String? = null,
    val adj: AdjustState? = null,
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
) : ViewModel() {
    private val _s = MutableStateFlow(StockState())
    val state = _s.asStateFlow()

    /** Resolved once per session — it never changes while signed in. */
    private var appUserId: String? = null

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

    fun items(s: StockState): List<StockItem> {
        val q = s.query.trim()
        return s.products
            .filter { s.tab == "All" || it.category == s.tab }
            .filter {
                q.isEmpty() || it.name.contains(q, ignoreCase = true) ||
                    it.category?.contains(q, ignoreCase = true) == true ||
                    it.barcode?.contains(q) == true // scanner types into the field too
            }
            .map {
                val net = rupeesToCents(it.sellingPrice)
                StockItem(
                    it.id, it.name, it.category ?: "—",
                    if (s.pricesInclVat) grossCents(net, it.vatRate ?: s.vatDefault) else net,
                    s.onHand[it.id] ?: 0,
                    (it.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD),
                    mu.carfection.pos.core.data.productPhotoUrl(it.photoPath),
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
        _s.update { it.copy(logOpen = true, logBusy = true) }
        viewModelScope.launch {
            val rows = runCatching { api.fetchStockAdjustments() }.getOrDefault(emptyList()).map(::adjustmentRow)
            _s.update { it.copy(logBusy = false, log = rows, logPicked = rows.map { r -> r.id }.toSet()) }
        }
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
            val text = StockAdjustmentSlip.render(picked, catalog.receiptBiz(), printerWidth(), at)
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
        _s.update { it.copy(adj = null) }
        post(a.productId, a.delta, a.reason, a.result, "${a.name} → ${a.result} on hand")
    }

    private fun post(productId: String, delta: Int, note: String, newOnHand: Int, toast: String? = null) {
        val s = _s.value
        val tenant = s.tenant; val loc = s.locationId
        if (tenant == null || loc == null) { _s.update { it.copy(toast = "Not synced — pull the catalogue first") }; return }
        _s.update { it.copy(onHand = it.onHand + (productId to newOnHand), toast = toast) }
        viewModelScope.launch {
            // Stamp WHO moved the stock. Every historical row has created_by null because the
            // JWT carries a name but not the app_users id, so the ledger could never answer
            // "who did this" — and that is the first question asked of a printed adjustment log.
            val by = appUserId ?: api.currentAppUserId()?.also { appUserId = it }
            runCatching { api.adjustStock(NewStockMovementDto(tenant, productId, loc, delta.toDouble(), refType = "adjustment", note = note, createdBy = by)) }
                .onFailure { e ->
                    val msg = if (e.message?.contains("row-level security", true) == true) "Stock adjustments need owner or manager access" else "Couldn't save the adjustment — try again"
                    _s.update { it.copy(error = e.uiMessage(), toast = msg) }; load()
                }
        }
    }
}
