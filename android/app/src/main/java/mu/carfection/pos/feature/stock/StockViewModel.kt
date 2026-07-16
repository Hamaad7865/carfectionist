package mu.carfection.pos.feature.stock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CatalogRepository
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
val STOCK_REASONS = listOf("Received stock", "Used in job", "Damaged", "Correction")

data class StockItem(
    val id: String,
    val name: String,
    val category: String,
    val priceCents: Long,
    val onHand: Int,
    val threshold: Double,
) {
    val low: Boolean get() = onHand < threshold
    val zero: Boolean get() = onHand == 0
}

data class AdjustState(val productId: String, val name: String, val onHand: Int, val delta: Int = 0, val reason: String = "Received stock") {
    val result: Int get() = (onHand + delta).coerceAtLeast(0)
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
    val busy: Boolean = false,
    val toast: String? = null,
    val error: String? = null,
)

@HiltViewModel
class StockViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
) : ViewModel() {
    private val _s = MutableStateFlow(StockState())
    val state = _s.asStateFlow()

    init { load() }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
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
                StockItem(it.id, it.name, it.category ?: "—", rupeesToCents(it.sellingPrice), s.onHand[it.id] ?: 0, (it.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD))
            }
    }

    fun lowCount(s: StockState): Int =
        s.products.count { (s.onHand[it.id] ?: 0) < (it.lowStockThreshold ?: DEFAULT_LOW_THRESHOLD).coerceAtMost(MAX_LOW_THRESHOLD) }

    fun clearToast() = _s.update { it.copy(toast = null) }

    /** ±1 quick adjust — one signed adjustment movement. */
    fun quickAdjust(item: StockItem, delta: Int) {
        if (delta < 0 && item.onHand <= 0) return
        post(item.id, delta, "Quick ${if (delta > 0) "+1" else "−1"}", item.onHand + delta)
    }

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
        _s.update { it.copy(adj = null) }
        post(a.productId, a.delta, a.reason, a.result, "${a.name} → ${a.result} on hand")
    }

    private fun post(productId: String, delta: Int, note: String, newOnHand: Int, toast: String? = null) {
        val s = _s.value
        val tenant = s.tenant; val loc = s.locationId
        if (tenant == null || loc == null) { _s.update { it.copy(toast = "Not synced — pull the catalogue first") }; return }
        _s.update { it.copy(onHand = it.onHand + (productId to newOnHand), toast = toast) }
        viewModelScope.launch {
            runCatching { api.adjustStock(NewStockMovementDto(tenant, productId, loc, delta.toDouble(), refType = "adjustment", note = note)) }
                .onFailure { e ->
                    val msg = if (e.message?.contains("row-level security", true) == true) "Stock adjustments need owner or manager access" else "Couldn't save the adjustment — try again"
                    _s.update { it.copy(error = e.uiMessage(), toast = msg) }; load()
                }
        }
    }
}
