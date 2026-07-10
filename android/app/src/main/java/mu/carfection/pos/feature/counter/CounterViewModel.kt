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
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.PayMethod
import mu.carfection.pos.core.data.SaleLineSpec
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.expandSaleLines
import mu.carfection.pos.core.data.qtyAtLocation
import mu.carfection.pos.core.data.qtyEverywhere
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.CashDrawer
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.hardware.ReceiptText
import mu.carfection.pos.core.money.DocTotals
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.TodayPaymentDto
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.inject.Inject

/** Everything the counter screen renders. Totals are always derived, never stored. */
data class CounterUiState(
    val query: String = "",
    val tab: String = "All", // category filter
    val categories: List<String> = listOf("All"),
    val catCounts: Map<String, Int> = emptyMap(), // category → product count (rail scanning aid)
    val railOpen: Boolean = true, // category rail expanded / collapsed to a slim strip
    // Counter sales draw down the Shop, so the tiles and the warning read the Shop shelf;
    // the Warehouse figure rides along as a restock hint.
    val shopQty: Map<String, Int> = emptyMap(), // productId → on hand at the Shop
    val warehouseQty: Map<String, Int> = emptyMap(), // productId → on hand at the Warehouse
    val adhocOpen: Boolean = false,
    val products: List<ProductEntity> = emptyList(),
    val cart: List<CartLine> = emptyList(),
    // basket-level discount (applies after line discounts; emitted as negative lines)
    val basketMode: DiscountMode = DiscountMode.PCT,
    val basketText: String = "",
    val specs: List<SaleLineSpec> = emptyList(), // the exact lines the invoice will carry
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
    val receipt: ReceiptDoc? = null, // what just printed — post-sale preview / reprint
    // checkout mode: the TO COLLECT / PAID TODAY list, or a walk-in cart
    val mode: CheckoutMode = CheckoutMode.LIST,
    val bills: List<OutstandingInvoiceDto> = emptyList(),
    val paidToday: List<TodayPaymentDto> = emptyList(),
    val listBusy: Boolean = false,
    val collect: OutstandingInvoiceDto? = null, // when set, the pad collects on this invoice
    val paymentAction: TodayPaymentDto? = null, // a tapped PAID TODAY row → reverse / refund
    val notice: String? = null, // transient corrections feedback
    val oversell: OversellPrompt? = null, // adding this would drive stock negative — confirm first
) {
    /** The amount the pad is settling: an existing invoice's balance, or the cart total. */
    val dueCents: Long get() = collect?.let { rupeesToCents(it.totalIncl) - rupeesToCents(it.amountPaid) } ?: totals.totalCents
    val tenderCents: Long? get() = if (tenderText.isBlank()) null else parseMoneyToCents(tenderText)
    val effectiveTenderCents: Long get() = tenderCents ?: dueCents // pad opens "exact"
    val changeCents: Long get() = (effectiveTenderCents - dueCents).coerceAtLeast(0)

    val canRecord: Boolean
        get() = !busy && (collect != null || cart.isNotEmpty()) && when (method) {
            PayMethod.CASH -> effectiveTenderCents >= dueCents
            PayMethod.CREDIT -> collect == null && customerId != null // credit is walk-in only
            else -> true
        }

    /** Quick-tender chips: Exact + the round-ups a customer actually hands over. */
    val quickTenders: List<Long>
        get() {
            val t = dueCents
            fun up(step: Long) = ((t + step - 1) / step) * step
            return listOf(up(100_00), up(500_00), up(1000_00), up(5000_00))
                .filter { it > t }.distinct().take(3)
        }

    // ── basket discount, derived from the raw input ─────────────────────────────
    val basketPct: Int get() = if (basketMode == DiscountMode.PCT) (basketText.toIntOrNull() ?: 0).coerceIn(0, 100) else 0
    val basketAmtCents: Long get() = if (basketMode == DiscountMode.AMT) (parseMoneyToCents(basketText) ?: 0L).coerceAtLeast(0) else 0

    /** What the basket discount actually takes off (post-clamp, post-apportionment). */
    val basketAppliedCents: Long
        get() = specs.filter { it.productId == null && it.title.startsWith("Basket discount") }.sumOf { -it.unitCents }

    /** Subtotal before the basket discount — what the "Subtotal" row shows. */
    val preBasketSubtotalCents: Long get() = totals.subtotalCents + basketAppliedCents
}

enum class CheckoutMode { LIST, WALKIN }

/**
 * A tap that would drive the SHOP shelf below zero, held until the cashier confirms.
 * Carries both figures so the dialog can tell a transferable shortfall from a real stock-out.
 */
data class OversellPrompt(
    val product: ProductEntity,
    val targetQty: Double,
    val shopQty: Int,
    val warehouseQty: Int,
)

/** True when selling [targetQty] drives the Shop below zero and the cashier hasn't waved it through. */
internal fun needsOversellPrompt(isStocked: Boolean, alreadyConfirmed: Boolean, shopQty: Int, targetQty: Double): Boolean {
    if (!isStocked) return false // services / ad-hoc lines don't track stock
    if (alreadyConfirmed) return false // asked once per product per sale
    return shopQty - targetQty < 0
}

/** The restock line under the shop figure — a shop shortfall reads differently from a stock-out. */
internal fun warehouseHint(warehouseQty: Int): String =
    if (warehouseQty > 0) "$warehouseQty in the warehouse — transfer or continue"
    else "none in the warehouse either"

/**
 * Single recompute path: every cart/basket change rebuilds the exact invoice line set
 * (expandSaleLines) and prices it with the shared money engine — the footer always shows
 * what the server will charge.
 */
internal fun CounterUiState.withCart(cart: List<CartLine>): CounterUiState {
    // Emptying the cart ends the ticket, so the whole-sale discount goes with it. Otherwise a
    // discount typed for one walk-in silently re-prices the next basket built on this screen.
    val s = if (cart.isEmpty() && this.cart.isNotEmpty()) copy(basketMode = DiscountMode.PCT, basketText = "") else this
    val specs = expandSaleLines(cart, s.basketMode, s.basketPct, s.basketAmtCents)
    val totals = computeTotals(specs.map { LineInput(it.qty, it.unitCents, it.discountPct, it.vatRatePct) })
    return s.copy(cart = cart, specs = specs, totals = totals, error = null)
}

@HiltViewModel
class CounterViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val sales: SaleRepository,
    private val till: TillRepository,
    private val session: SessionRepository,
    private val printer: ReceiptPrinter,
    private val drawer: CashDrawer,
    private val api: PosApi,
) : ViewModel() {

    private val local = MutableStateFlow(CounterUiState())

    val state: StateFlow<CounterUiState> =
        combine(local, catalog.products, catalog.customers) { s, products, customers ->
            val cats = listOf("All") + products.mapNotNull { it.category }.distinct().sorted()
            val counts = products.mapNotNull { it.category }.groupingBy { it }.eachCount() + ("All" to products.size)
            val q = s.query.trim().lowercase()
            val filtered = products
                .filter { s.tab == "All" || it.category == s.tab }
                .filter { q.isEmpty() || it.name.lowercase().contains(q) || (it.barcode ?: "").contains(q) }
            val cq = s.customerText.trim().lowercase()
            val matches = if (cq.isEmpty() || s.customerId != null) emptyList()
            else customers.filter { it.name.lowercase().contains(cq) }.take(6)
            s.copy(products = filtered, categories = cats, catCounts = counts, customerMatches = matches)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CounterUiState())

    init {
        refreshTill()
        loadLists()
        refreshStock()
        viewModelScope.launch { runCatching { catalog.refresh() } } // stale-while-revalidate
    }

    // ── checkout list: TO COLLECT + PAID TODAY ─────────────────────────────────
    fun loadLists() {
        local.value = local.value.copy(listBusy = true)
        viewModelScope.launch {
            val start = LocalDate.now(ZoneOffset.ofHours(4)).atStartOfDay(ZoneOffset.ofHours(4))
                .toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val bills = runCatching { api.fetchOutstandingInvoices() }.getOrDefault(emptyList())
            val paid = runCatching { api.fetchTodayPayments(start) }.getOrDefault(emptyList())
            local.value = local.value.copy(bills = bills, paidToday = paid, listBusy = false)
        }
    }

    fun startWalkIn() {
        local.value = local.value.copy(mode = CheckoutMode.WALKIN, collect = null)
        refreshStock()
    }
    fun backToList() { newSale(); local.value = local.value.copy(mode = CheckoutMode.LIST); loadLists() }

    /**
     * On-hand for the product tiles and the negative-stock warning, split by location:
     * the Shop is what a counter sale draws down, the Warehouse is the restock hint.
     */
    private fun refreshStock() = viewModelScope.launch {
        runCatching {
            val loc = catalog.counterLocations()
            val rows = api.fetchStockOnHand()
            // No Shop row means the Warehouse IS the shelf we sell from, and there is no
            // separate place to transfer from — so it offers no restock hint.
            val warehouseId = if (loc.shopId != null) loc.warehouseId else null
            // Locations unresolvable (a cold cache the server wouldn't fill): fall back to
            // totals rather than reading every shelf as empty and nagging on every tap.
            val shelf = loc.saleLocationId?.let { qtyAtLocation(rows, it) } ?: qtyEverywhere(rows)
            shelf to qtyAtLocation(rows, warehouseId)
        }.onSuccess { (shop, warehouse) ->
            local.value = local.value.copy(shopQty = shop, warehouseQty = warehouse)
        }
    }

    fun setTab(t: String) { local.value = local.value.copy(tab = t) }
    fun toggleRail() { local.value = local.value.copy(railOpen = !local.value.railOpen) }

    // ── ad-hoc line (typed name + price; saves with product_id = null) ─────────
    fun openAdhoc() { local.value = local.value.copy(adhocOpen = true) }
    fun closeAdhoc() { local.value = local.value.copy(adhocOpen = false) }

    fun addAdhoc(name: String, priceCents: Long) {
        if (name.isBlank() || priceCents <= 0) { closeAdhoc(); return }
        viewModelScope.launch {
            val vat = catalog.vatDefault()
            val p = ProductEntity(
                id = CartLine.ADHOC_PREFIX + UUID.randomUUID(),
                name = name.trim(), kind = "adhoc", sellingPriceCents = priceCents,
                vatRatePct = vat, barcode = null, isStocked = false, category = null, lowStockThreshold = null,
            )
            local.value = local.value.copy(adhocOpen = false)
            mutateCart { cart -> cart + CartLine(p, 1.0) }
        }
    }

    // ── corrections (void / reverse / refund) — RLS enforces owner/manager ─────
    val canManage: Boolean get() = session.userRole.lowercase().let { it.contains("owner") || it.contains("manager") }

    fun openPaymentAction(p: TodayPaymentDto) { local.value = local.value.copy(paymentAction = p) }
    fun closePaymentAction() { local.value = local.value.copy(paymentAction = null) }
    fun clearNotice() { local.value = local.value.copy(notice = null) }

    private fun correction(label: String, block: suspend () -> Unit) {
        if (local.value.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { local.value = local.value.copy(busy = false, padOpen = false, collect = null, paymentAction = null, done = null, notice = label); loadLists() }
                .onFailure { e ->
                    val msg = if (e.message?.contains("privileges", true) == true) "Only an owner or manager can do that" else (e.message ?: "Couldn't complete that — try again")
                    local.value = local.value.copy(busy = false, notice = msg)
                }
        }
    }

    /** "Start next sale" on the post-sale panel: clear the counter, straight into a fresh walk-in. */
    fun startNextSale() {
        newSale()
        local.value = local.value.copy(mode = CheckoutMode.WALKIN)
        refreshStock()
    }

    /** Reprint the slip shown in the post-sale panel. */
    fun reprint() {
        val doc = local.value.receipt ?: return
        viewModelScope.launch { runCatching { printer.printReceipt(ReceiptText.render(doc)) } }
        local.value = local.value.copy(notice = "Receipt sent to the printer")
    }

    /** Void the sale just completed: unpaid/on-account → void; paid → credit note (restocks). */
    fun voidCompletedSale() {
        val r = local.value.done ?: return
        newSale() // clear the finished cart first; the sale itself is already committed
        if (r.onAccount) correction("${r.number ?: "Invoice"} voided") { api.voidDocument(r.invoiceId, "Voided at POS") }
        else correction("Refunded — credit note issued for ${r.number ?: "the sale"}") { api.issueCreditNote(r.invoiceId, restock = true) }
    }

    fun voidInvoice(bill: OutstandingInvoiceDto) = correction("${bill.number ?: "Invoice"} voided") { api.voidDocument(bill.id, "Voided at POS") }
    fun reverseThisPayment(p: TodayPaymentDto) = correction("Payment reversed") { api.reversePayment(p.id, "Reversed at POS") }
    fun refundInvoice(p: TodayPaymentDto) = correction("Credit note issued — ${p.documents?.number ?: "invoice"}") { api.issueCreditNote(p.documentId, restock = true) }

    /** Tap an outstanding invoice → open the pad to collect its balance. */
    fun collectOn(bill: OutstandingInvoiceDto) {
        saleKey = UUID.randomUUID().toString()
        local.value = local.value.copy(
            collect = bill, padOpen = true, method = PayMethod.CASH,
            tenderText = "", refText = "", error = null,
        )
    }

    /** The pad's confirm button: collect on an invoice, or settle the walk-in cart. */
    fun confirm() = if (local.value.collect != null) recordCollect() else record()

    private fun recordCollect() {
        val s = state.value
        val bill = s.collect ?: return
        if (!s.canRecord || s.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = sales.collectOnInvoice(
                    invoiceId = bill.id,
                    number = bill.number,
                    amountCents = s.dueCents,
                    method = s.method,
                    tenderCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                    externalRef = s.refText,
                    cashSessionId = s.till?.id,
                    payKey = saleKey,
                )
                val receipt = ReceiptDoc(
                    biz = catalog.receiptBiz(),
                    invoiceNo = bill.number,
                    dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm")),
                    cashier = session.userName,
                    customer = bill.customers?.name ?: "Walk-in",
                    lines = emptyList(),
                    subtotalCents = s.dueCents, vatRatePct = catalog.vatDefault().toInt(),
                    vatCents = 0L, discountCents = 0L, totalCents = s.dueCents,
                    payLabel = s.method.label,
                    paidCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else s.dueCents,
                    changeCents = s.changeCents,
                    onAccount = false, isPayment = true,
                )
                launch {
                    runCatching {
                        printer.printReceipt(ReceiptText.render(receipt)) // instant payment slip
                        if (s.method == PayMethod.CASH) drawer.kick()
                    }
                }
                local.value = local.value.copy(busy = false, padOpen = false, collect = null, done = result, receipt = receipt)
                loadLists()
            } catch (e: Exception) {
                local.value = local.value.copy(busy = false, error = e.message ?: "Payment failed — try again.")
            }
        }
    }

    fun refreshTill() = viewModelScope.launch {
        runCatching { till.openSession() }.onSuccess { s -> local.value = local.value.copy(till = s) }
    }

    // ── cart ──────────────────────────────────────────────────────────────────
    fun setQuery(q: String) { local.value = local.value.copy(query = q) }

    fun add(p: ProductEntity) {
        val target = (local.value.cart.firstOrNull { it.product.id == p.id }?.qty ?: 0.0) + 1
        promptFor(p, target)?.let { local.value = local.value.copy(oversell = it); return }
        mutateCart { cart ->
            val i = cart.indexOfFirst { it.product.id == p.id }
            if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = it[i].qty + 1) }
            else cart + CartLine(p, 1.0)
        }
    }

    fun setQty(productId: String, qty: Double) {
        val cur = local.value.cart.firstOrNull { it.product.id == productId }
        if (cur != null && qty > cur.qty) {
            promptFor(cur.product, qty)?.let { local.value = local.value.copy(oversell = it); return }
        }
        mutateCart { cart ->
            if (qty <= 0) cart.filterNot { it.product.id == productId }
            else cart.map { if (it.product.id == productId) it.copy(qty = qty) else it }
        }
    }

    /** The prompt this tap owes the cashier, or null when the Shop can cover it. */
    private fun promptFor(p: ProductEntity, targetQty: Double): OversellPrompt? {
        val s = local.value
        val shop = s.shopQty[p.id] ?: 0
        val confirmed = s.cart.firstOrNull { it.product.id == p.id }?.oversellOk == true
        if (!needsOversellPrompt(p.isStocked, confirmed, shop, targetQty)) return null
        return OversellPrompt(p, targetQty, shop, s.warehouseQty[p.id] ?: 0)
    }

    /** "Sell anyway" — apply the held quantity and stop asking for this product this sale. */
    fun confirmOversell() {
        val o = local.value.oversell ?: return
        local.value = local.value.copy(oversell = null)
        mutateCart { cart ->
            val i = cart.indexOfFirst { it.product.id == o.product.id }
            if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = o.targetQty, oversellOk = true) }
            else cart + CartLine(o.product, o.targetQty, oversellOk = true)
        }
    }

    fun dismissOversell() { local.value = local.value.copy(oversell = null) }

    /** Tap a cart line → open its qty/discount editor (one open at a time, like the quote builder). */
    fun toggleLine(productId: String) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(expanded = !it.expanded) else it.copy(expanded = false) }
    }

    fun setDiscount(productId: String, pct: Int) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountPct = pct) else it }
    }

    fun setLineDiscountMode(productId: String, mode: DiscountMode) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountMode = mode) else it }
    }

    fun setLineDiscountAmt(productId: String, text: String) = mutateCart { cart ->
        cart.map { if (it.product.id == productId) it.copy(discountAmtText = text.filter { c -> c.isDigit() || c == '.' }) else it }
    }

    // ── basket discount ─────────────────────────────────────────────────────────
    fun setBasketMode(mode: DiscountMode) {
        local.value = local.value.copy(basketMode = mode, basketText = "")
        mutateCart { it } // recompute
    }

    fun setBasketText(text: String) {
        local.value = local.value.copy(basketText = text.filter { c -> c.isDigit() || c == '.' })
        mutateCart { it } // recompute
    }

    private fun mutateCart(f: (List<CartLine>) -> List<CartLine>) {
        val s = local.value
        local.value = s.withCart(f(s.cart))
    }

    // ── customer ─────────────────────────────────────────────────────────────
    fun setCustomerText(t: String) { local.value = local.value.copy(customerText = t, customerId = null) }
    fun pickCustomer(c: CustomerEntity) { local.value = local.value.copy(customerText = c.name, customerId = c.id) }

    // ── payment pad ──────────────────────────────────────────────────────────
    fun openPad() {
        if (local.value.cart.isEmpty()) { local.value = local.value.copy(error = "Add at least one product."); return }
        local.value = local.value.copy(padOpen = true, method = PayMethod.CASH, tenderText = "", refText = "", error = null)
    }
    fun closePad() { local.value = local.value.copy(padOpen = false, collect = null) }
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
                    basketMode = s.basketMode,
                    basketPct = s.basketPct,
                    basketAmtCents = s.basketAmtCents,
                )
                // Sale is committed — printing/drawer are fire-and-forget (can never lose it).
                // Receipt mirrors the SAVED lines (incl. discount lines) in the studio's slip format.
                // Each cart line's undiscounted list price, VAT-inclusive (per line's own rate).
                fun grossIncl(l: CartLine): Long {
                    val excl = lineExclCents(l.qty, l.product.sellingPriceCents) // qty × unit, no discount
                    return excl + Math.round(excl * (l.product.vatRatePct / 100.0))
                }
                val itemLines = s.cart.map { ReceiptLine(it.product.name, it.qty, grossIncl(it)) }
                val subtotalIncl = itemLines.sumOf { it.inclCents } // gross, before discounts
                val receipt = ReceiptDoc(
                    biz = catalog.receiptBiz(),
                    invoiceNo = result.number,
                    dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm")),
                    cashier = session.userName,
                    customer = s.customerText.trim().ifBlank { "Walk-in" },
                    lines = itemLines,
                    subtotalCents = subtotalIncl,
                    vatRatePct = catalog.vatDefault().toInt(),
                    vatCents = s.totals.vatCents,
                    discountCents = (subtotalIncl - result.totalCents).coerceAtLeast(0), // Subtotal − Discount = Total
                    totalCents = result.totalCents,
                    payLabel = if (result.onAccount) null else s.method.label,
                    paidCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else result.totalCents,
                    changeCents = result.changeCents,
                    onAccount = result.onAccount,
                )
                launch {
                    runCatching {
                        printer.printReceipt(ReceiptText.render(receipt)) // prints the moment the sale completes
                        if (s.method == PayMethod.CASH) drawer.kick()
                    }
                }
                local.value = local.value.copy(busy = false, padOpen = false, done = result, receipt = receipt)
            } catch (e: Exception) {
                local.value = local.value.copy(busy = false, error = e.message ?: "Sale failed — try again.")
            }
        }
    }

    fun newSale() {
        saleKey = UUID.randomUUID().toString()
        val cur = local.value
        local.value = CounterUiState(till = cur.till, mode = cur.mode, bills = cur.bills, paidToday = cur.paidToday)
        refreshTill()
    }

    fun signOut() = viewModelScope.launch { session.signOut() }
}
