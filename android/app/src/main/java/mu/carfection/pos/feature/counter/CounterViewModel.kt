package mu.carfection.pos.feature.counter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CartLine
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.CashDrawer
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.hardware.ReceiptText
import mu.carfection.pos.core.money.DocTotals
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.CashSessionDto
import java.util.UUID
import javax.inject.Inject

/** Everything the counter screen renders. Totals are always derived, never stored. */
data class CounterUiState(
    val query: String = "",
    val products: List<ProductEntity> = emptyList(),
    val cart: List<CartLine> = emptyList(),
    val totals: DocTotals = computeTotals(emptyList()),
    // customer (optional walk-in name; picked id required for credit)
    val customerText: String = "",
    val customerId: String? = null,
    val customerMatches: List<CustomerEntity> = emptyList(),
    // till
    val till: CashSessionDto? = null,
    // payment pad
    val padOpen: Boolean = false,
    val method: PayMethod = PayMethod.CASH,
    val tenderText: String = "", // numpad-owned; empty = exact
    val refText: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val done: SaleResult? = null,
) {
    val tenderCents: Long? get() = if (tenderText.isBlank()) null else parseMoneyToCents(tenderText)
    val effectiveTenderCents: Long get() = tenderCents ?: totals.totalCents // pad opens "exact"
    val changeCents: Long get() = (effectiveTenderCents - totals.totalCents).coerceAtLeast(0)

    val canRecord: Boolean
        get() = cart.isNotEmpty() && !busy && when (method) {
            PayMethod.CASH -> effectiveTenderCents >= totals.totalCents
            PayMethod.CREDIT -> customerId != null
            else -> true
        }

    /** Quick-tender chips: Exact + the round-ups a customer actually hands over. */
    val quickTenders: List<Long>
        get() {
            val t = totals.totalCents
            fun up(step: Long) = ((t + step - 1) / step) * step
            return listOf(up(100_00), up(500_00), up(1000_00), up(5000_00))
                .filter { it > t }.distinct().take(3)
        }
}

@HiltViewModel
class CounterViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val sales: SaleRepository,
    private val till: TillRepository,
    private val session: SessionRepository,
    private val printer: ReceiptPrinter,
    private val drawer: CashDrawer,
) : ViewModel() {

    private val local = MutableStateFlow(CounterUiState())

    val state: StateFlow<CounterUiState> =
        combine(local, catalog.products, catalog.customers) { s, products, customers ->
            val q = s.query.trim().lowercase()
            val filtered = if (q.isEmpty()) products
            else products.filter { it.name.lowercase().contains(q) || (it.barcode ?: "").contains(q) }
            val cq = s.customerText.trim().lowercase()
            val matches = if (cq.isEmpty() || s.customerId != null) emptyList()
            else customers.filter { it.name.lowercase().contains(cq) }.take(6)
            s.copy(products = filtered, customerMatches = matches)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CounterUiState())

    init {
        refreshTill()
        viewModelScope.launch { runCatching { catalog.refresh() } } // stale-while-revalidate
    }

    fun refreshTill() = viewModelScope.launch {
        runCatching { till.openSession() }.onSuccess { s -> local.value = local.value.copy(till = s) }
    }

    // ── cart ──────────────────────────────────────────────────────────────────
    fun setQuery(q: String) { local.value = local.value.copy(query = q) }

    fun add(p: ProductEntity) = mutateCart { cart ->
        val i = cart.indexOfFirst { it.product.id == p.id }
        if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = it[i].qty + 1) }
        else cart + CartLine(p, 1.0)
    }

    fun setQty(productId: String, qty: Double) = mutateCart { cart ->
        if (qty <= 0) cart.filterNot { it.product.id == productId }
        else cart.map { if (it.product.id == productId) it.copy(qty = qty) else it }
    }

    private fun mutateCart(f: (List<CartLine>) -> List<CartLine>) {
        val cart = f(local.value.cart)
        val totals = computeTotals(cart.map { LineInput(it.qty, it.product.sellingPriceCents, 0.0, it.product.vatRatePct) })
        local.value = local.value.copy(cart = cart, totals = totals, error = null)
    }

    // ── customer ─────────────────────────────────────────────────────────────
    fun setCustomerText(t: String) { local.value = local.value.copy(customerText = t, customerId = null) }
    fun pickCustomer(c: CustomerEntity) { local.value = local.value.copy(customerText = c.name, customerId = c.id) }

    // ── payment pad ──────────────────────────────────────────────────────────
    fun openPad() {
        if (local.value.cart.isEmpty()) { local.value = local.value.copy(error = "Add at least one product."); return }
        local.value = local.value.copy(padOpen = true, method = PayMethod.CASH, tenderText = "", refText = "", error = null)
    }
    fun closePad() { local.value = local.value.copy(padOpen = false) }
    fun setMethod(m: PayMethod) { local.value = local.value.copy(method = m, error = null) }
    fun setRef(t: String) { local.value = local.value.copy(refText = t) }
    fun setTenderCents(cents: Long) { local.value = local.value.copy(tenderText = (cents / 100).toString() + if (cents % 100 != 0L) "." + (cents % 100).toString().padStart(2, '0') else "") }

    /** Spec numpad rules: digits append; one '.'; ≤2 decimals; ≤7 integer digits; ⌫ deletes. */
    fun padKey(key: String) {
        val t = local.value.tenderText
        val next = when (key) {
            "⌫" -> t.dropLast(1)
            "." -> if (t.contains('.')) t else if (t.isEmpty()) "0." else "$t."
            else -> { // digit
                val (int, dec) = t.split('.').let { it[0] to it.getOrNull(1) }
                when {
                    dec != null && dec.length >= 2 -> t
                    dec == null && int.length >= 7 -> t
                    else -> t + key
                }
            }
        }
        local.value = local.value.copy(tenderText = next)
    }

    // ── settle ───────────────────────────────────────────────────────────────
    private var saleKey = UUID.randomUUID().toString() // stable per sale; rotates on reset

    fun record() {
        val s = state.value
        if (!s.canRecord || s.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = sales.completeSale(
                    cart = s.cart,
                    method = s.method,
                    tenderCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                    externalRef = s.refText,
                    customerId = s.customerId,
                    walkInName = s.customerText,
                    cashSessionId = s.till?.id,
                    saleKey = saleKey,
                )
                // Sale is committed — printing/drawer are fire-and-forget (can never lose it).
                launch {
                    runCatching {
                        val lineView = s.cart.mapIndexed { i, l -> l.product.name to s.totals.lines[i].exclCents }
                        printer.printReceipt(ReceiptText.forSale(catalog.tradingName(), result, lineView))
                        if (s.method == PayMethod.CASH) drawer.kick()
                    }
                }
                local.value = local.value.copy(busy = false, padOpen = false, done = result)
            } catch (e: Exception) {
                local.value = local.value.copy(busy = false, error = e.message ?: "Sale failed — try again.")
            }
        }
    }

    fun newSale() {
        saleKey = UUID.randomUUID().toString()
        local.value = CounterUiState(till = local.value.till)
        refreshTill()
    }

    fun signOut() = viewModelScope.launch { session.signOut() }
}
