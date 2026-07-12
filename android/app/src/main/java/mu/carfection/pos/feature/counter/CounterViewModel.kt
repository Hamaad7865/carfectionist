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
import mu.carfection.pos.core.data.SaleIssueUncertain
import mu.carfection.pos.core.data.SaleLineSpec
import mu.carfection.pos.core.data.SalePaymentUncertain
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.expandSaleLines
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.SaleHistoryDto
import mu.carfection.pos.core.network.SaleHistoryLineDto
import mu.carfection.pos.core.network.TodayPaymentDto
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

/** Everything the counter screen renders. Totals are always derived, never stored. */
data class CounterUiState(
    val query: String = "",
    val tab: String = "All", // category filter
    val catQuery: String = "", // narrows the category rail (189 accessories ≠ browsable)
    val categories: List<String> = listOf("All"),
    val catCounts: Map<String, Int> = emptyMap(), // category → product count (rail scanning aid)
    val railOpen: Boolean = true, // category rail expanded / collapsed to a slim strip
    val onHand: Map<String, Int> = emptyMap(), // productId → stock on hand (all locations)
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
    val pendingSettle: PendingSettle? = null, // a settle reached the server — basket is frozen
    // sales history (past sales + reprint)
    val historyOpen: Boolean = false,
    val history: List<SaleHistoryDto> = emptyList(),
    val historyQuery: String = "",
    val historyBusy: Boolean = false,
    val viewDoc: ReceiptDoc? = null, // a past sale's receipt, rebuilt for preview/reprint
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

/** A tap that would sell past available stock, held until the cashier confirms. */
data class OversellPrompt(val product: ProductEntity, val targetQty: Double)

/**
 * A settle attempt that reached `issue_document`. An invoice may exist on the server under this
 * sale's idempotency key, and the client cannot tell. Until it resolves the basket is frozen:
 * both money RPCs replay purely on the key, so settling a *different* basket under it would
 * charge the customer for this one. Retrying the identical basket is safe — the server replays.
 *
 * [invoiceId] is null when `issue_document` itself failed (the invoice may or may not exist).
 */
data class PendingSettle(val invoiceId: String?, val number: String?)

internal const val SETTLE_LOCK_NOTICE = "Finish or cancel this sale before changing the basket."

/**
 * Single recompute path: every cart/basket change rebuilds the exact invoice line set
 * (expandSaleLines) and prices it with the shared money engine — the footer always shows
 * what the server will charge.
 */
internal fun CounterUiState.withCart(cart: List<CartLine>): CounterUiState {
    if (pendingSettle != null) return copy(notice = SETTLE_LOCK_NOTICE)
    // Emptying the cart ends the ticket, so the whole-sale discount goes with it. Otherwise a
    // discount typed for one walk-in silently re-prices the next basket built on this screen.
    val s = if (cart.isEmpty() && this.cart.isNotEmpty()) copy(basketMode = DiscountMode.PCT, basketText = "") else this
    val specs = expandSaleLines(cart, s.basketMode, s.basketPct, s.basketAmtCents)
    val totals = computeTotals(specs.map { LineInput(it.qty, it.unitCents, it.discountPct, it.vatRatePct) })
    return s.copy(cart = cart, specs = specs, totals = totals, error = null)
}

/** The whole-sale discount is part of the basket, so it freezes with it. */
internal fun CounterUiState.withBasket(mode: DiscountMode, text: String): CounterUiState {
    if (pendingSettle != null) return copy(notice = SETTLE_LOCK_NOTICE)
    return copy(basketMode = mode, basketText = text).withCart(cart)
}

/**
 * Where a settle died decides whether the cashier may keep editing. Anything before
 * `issue_document` has committed nothing that costs money, so the basket stays live.
 */
internal fun CounterUiState.withSettleFailure(e: Throwable): CounterUiState = when (e) {
    // Retrying is the safe act: the payment may in fact have committed, and re-sending the same
    // request replays it. Cancelling instead would hide a settled invoice and re-ring the sale.
    is SalePaymentUncertain -> copy(
        busy = false,
        pendingSettle = PendingSettle(e.invoiceId, e.number),
        error = "${e.number?.let { "Invoice $it" } ?: "The invoice"} was issued but the payment " +
            "didn't confirm. Tap Record payment again — retrying can never charge twice. " +
            "Cancelling leaves it on the server.",
    )
    is SaleIssueUncertain -> copy(
        busy = false,
        pendingSettle = PendingSettle(null, null),
        error = "Couldn't confirm the sale reached the server. Tap Record payment again to " +
            "finish it — don't change the basket.",
    )
    else -> copy(busy = false, error = e.uiMessage("Sale failed — try again."))
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
            // "All" always survives the rail search, so there is always a way back out.
            val catQ = s.catQuery.trim()
            val cats = listOf("All") + products.mapNotNull { it.category }.distinct().sorted()
                .filter { catQ.isEmpty() || it.contains(catQ, ignoreCase = true) }
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
        // Track the shared session so opening/closing the till updates the chip immediately.
        viewModelScope.launch { till.current.collect { t -> local.value = local.value.copy(till = t) } }
        viewModelScope.launch { runCatching { catalog.refresh() } } // stale-while-revalidate
        // This ViewModel is activity-scoped and outlives a logout; wipe one operator's live cart,
        // customer and open pad so the next operator can't complete a stale sale under their name.
        viewModelScope.launch { session.isLoggedIn.collect { if (it == false) resetOnSignOut() } }
    }

    /** Hard reset on operator switch — unconditional (unlike newSale, which guards a settle). */
    private fun resetOnSignOut() {
        saleKey = UUID.randomUUID().toString()
        local.value = CounterUiState(till = local.value.till)
    }

    // ── checkout list: TO COLLECT + PAID TODAY ─────────────────────────────────
    fun loadLists() {
        local.value = local.value.copy(listBusy = true)
        viewModelScope.launch {
            val start = LocalDate.now(ZoneOffset.ofHours(4)).atStartOfDay(ZoneOffset.ofHours(4))
                .toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val bills = runCatching { api.fetchOutstandingInvoices() }.getOrDefault(emptyList())
            val paidRaw = runCatching { api.fetchTodayPayments(start) }.getOrDefault(emptyList())
            // PAID TODAY = money that actually stands. A mistake + its reversal
            // cancel out and BOTH disappear (the trail stays in History and the
            // back office), so a re-collected sale shows exactly once.
            val reversedIds = paidRaw.mapNotNull { it.reversesPaymentId }.toSet()
            val paid = paidRaw.filter { it.reversesPaymentId == null && it.id !in reversedIds }
            local.value = local.value.copy(bills = bills, paidToday = paid, listBusy = false)
        }
    }

    fun startWalkIn() {
        local.value = local.value.copy(mode = CheckoutMode.WALKIN, collect = null)
        refreshStock()
    }
    fun backToList() {
        // An unresolved settle may hold a real invoice under saleKey; abandoning it would orphan
        // the invoice with no idempotent path back. Retrying is the only safe exit — refuse.
        if (frozenBySettle()) return
        newSale(); local.value = local.value.copy(mode = CheckoutMode.LIST); loadLists()
    }

    /** On-hand counts for the product tiles (stock line + low-stock badge). */
    private fun refreshStock() = viewModelScope.launch {
        runCatching { api.fetchStockOnHand() }.onSuccess { rows ->
            val map = rows.groupBy { it.productId }.mapValues { (_, r) -> r.sumOf { it.qtyOnHand }.toInt() }
            local.value = local.value.copy(onHand = map)
        }
    }

    fun setTab(t: String) { local.value = local.value.copy(tab = t) }
    fun setCatQuery(q: String) { local.value = local.value.copy(catQuery = q) }
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

    // ── sales history: view past sales + reprint their receipts ────────────────
    fun openHistory() {
        local.value = local.value.copy(historyOpen = true, historyBusy = true)
        viewModelScope.launch {
            val h = runCatching { api.fetchSalesHistory() }.getOrDefault(emptyList())
            local.value = local.value.copy(history = h, historyBusy = false)
        }
    }

    fun closeHistory() { local.value = local.value.copy(historyOpen = false, viewDoc = null, historyQuery = "") }
    fun setHistoryQuery(q: String) { local.value = local.value.copy(historyQuery = q) }
    fun closeViewDoc() { local.value = local.value.copy(viewDoc = null) }

    /** Rebuild a past sale's slip from the server's stored lines + payments and show it. */
    fun viewHistoryReceipt(h: SaleHistoryDto) {
        viewModelScope.launch {
            fun incl(l: SaleHistoryLineDto) = rupeesToCents(l.lineTotalExcl) + rupeesToCents(l.lineVat)
            val sorted = h.lines.sortedBy { it.sortOrder }
            val positives = sorted.filter { incl(it) >= 0 }
            val pay = h.payments.filter { it.reversesPaymentId == null }.maxByOrNull { it.receivedAt ?: "" }
            val doc = ReceiptDoc(
                biz = catalog.receiptBiz(),
                invoiceNo = h.number,
                dateTime = runCatching {
                    java.time.OffsetDateTime.parse(h.issuedAt)
                        .atZoneSameInstant(ZoneOffset.ofHours(4))
                        .format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm"))
                }.getOrDefault(h.issuedAt?.take(10) ?: "—"),
                cashier = h.creator?.displayName?.replace(Regex("\\s*\\(.*\\)$"), "") ?: "—",
                customer = h.customers?.name ?: "Walk-in",
                lines = positives.map { ReceiptLine(it.title, it.qty, incl(it)) },
                subtotalCents = positives.sumOf { incl(it) },
                vatRatePct = catalog.vatDefault().toInt(),
                vatCents = rupeesToCents(h.vatTotal),
                discountCents = -sorted.filter { incl(it) < 0 }.sumOf { incl(it) },
                totalCents = rupeesToCents(h.totalIncl),
                payLabel = pay?.let { p -> PayMethod.entries.firstOrNull { it.rpcValue == p.method }?.label ?: p.method },
                paidCents = pay?.tendered?.let { rupeesToCents(it) } ?: rupeesToCents(h.amountPaid),
                changeCents = pay?.changeGiven?.let { rupeesToCents(it) } ?: 0L,
                onAccount = pay == null,
            )
            local.value = local.value.copy(viewDoc = doc)
        }
    }

    /** Reprint the previewed past-sale slip. */
    fun printViewDoc() {
        val doc = local.value.viewDoc ?: return
        viewModelScope.launch { runCatching { printer.printReceipt(ReceiptText.render(doc)) } }
        local.value = local.value.copy(notice = "Receipt sent to the printer")
    }

    private fun correction(label: String, block: suspend () -> Unit) {
        if (local.value.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { local.value = local.value.copy(busy = false, padOpen = false, collect = null, paymentAction = null, done = null, notice = label); loadLists() }
                .onFailure { e ->
                    val msg = if (e.message?.contains("privileges", true) == true) "Only an owner or manager can do that" else e.uiMessage("Couldn’t complete that — try again")
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
        else correction("Refunded — credit note issued for ${r.number ?: "the sale"}") { api.issueCreditNote(r.invoiceId, restock = true, stockLocationId = api.fetchShopLocationId()) }
    }

    fun voidInvoice(bill: OutstandingInvoiceDto) = correction("${bill.number ?: "Invoice"} voided") { api.voidDocument(bill.id, "Voided at POS") }
    /** Reason is REQUIRED — the owner reads it in Activity/Traceability/Cash Flow. */
    fun reverseThisPayment(p: TodayPaymentDto, reason: String) = correction("Payment reversed") { api.reversePayment(p.id, reason) }
    fun refundInvoice(p: TodayPaymentDto) = correction("Credit note issued — ${p.documents?.number ?: "invoice"}") { api.issueCreditNote(p.documentId, restock = true, stockLocationId = api.fetchShopLocationId()) }

    /** Tap an outstanding invoice → open the pad to collect its balance. */
    fun collectOn(bill: OutstandingInvoiceDto) {
        // Starting a new collection would rotate saleKey and abandon an in-flight settle.
        if (frozenBySettle()) return
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
                    val printed = runCatching {
                        printer.printReceipt(ReceiptText.render(receipt)) // instant payment slip
                    }.isSuccess
                    if (s.method == PayMethod.CASH) runCatching { drawer.kick() }
                    logReceiptOutcome(bill.number, printed)
                }
                local.value = local.value.copy(busy = false, padOpen = false, collect = null, done = result, receipt = receipt, pendingSettle = null)
                loadLists()
            } catch (e: Exception) {
                // A collect that reached record_payment may have committed; freeze exactly like a
                // walk-in settle so the retry replays under the same key instead of re-charging.
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    /** Re-reads the device's session; the `till.current` collector in `init` applies it. */
    fun refreshTill() = viewModelScope.launch { runCatching { till.openSession() } }

    // ── cart ──────────────────────────────────────────────────────────────────
    fun setQuery(q: String) { local.value = local.value.copy(query = q) }

    fun add(p: ProductEntity) {
        val target = (local.value.cart.firstOrNull { it.product.id == p.id }?.qty ?: 0.0) + 1
        if (needsOversellPrompt(p, target)) { local.value = local.value.copy(oversell = OversellPrompt(p, target)); return }
        mutateCart { cart ->
            val i = cart.indexOfFirst { it.product.id == p.id }
            if (i >= 0) cart.toMutableList().also { it[i] = it[i].copy(qty = it[i].qty + 1) }
            else cart + CartLine(p, 1.0)
        }
    }

    fun setQty(productId: String, qty: Double) {
        val cur = local.value.cart.firstOrNull { it.product.id == productId }
        if (cur != null && qty > cur.qty && needsOversellPrompt(cur.product, qty)) {
            local.value = local.value.copy(oversell = OversellPrompt(cur.product, qty)); return
        }
        mutateCart { cart ->
            if (qty <= 0) cart.filterNot { it.product.id == productId }
            else cart.map { if (it.product.id == productId) it.copy(qty = qty) else it }
        }
    }

    /** True when selling [targetQty] would drive stock negative and the cashier hasn't OK'd it yet. */
    private fun needsOversellPrompt(p: ProductEntity, targetQty: Double): Boolean {
        if (!p.isStocked) return false // services / ad-hoc lines don't track stock
        if (local.value.cart.firstOrNull { it.product.id == p.id }?.oversellOk == true) return false
        return (local.value.onHand[p.id] ?: 0) - targetQty < 0
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
        local.value = local.value.withBasket(mode, "")
    }

    fun setBasketText(text: String) {
        val s = local.value
        local.value = s.withBasket(s.basketMode, text.filter { c -> c.isDigit() || c == '.' })
    }

    private fun mutateCart(f: (List<CartLine>) -> List<CartLine>) {
        val s = local.value
        val next = s.withCart(f(s.cart))
        // An emptied cart ends the ticket. Mint a fresh idempotency namespace so the next basket
        // can never replay this one's invoice.
        if (next.cart.isEmpty() && s.cart.isNotEmpty()) saleKey = UUID.randomUUID().toString()
        local.value = next
    }

    // ── customer ─────────────────────────────────────────────────────────────
    fun setCustomerText(t: String) {
        if (frozenBySettle()) return
        local.value = local.value.copy(customerText = t, customerId = null)
    }
    fun pickCustomer(c: CustomerEntity) {
        if (frozenBySettle()) return
        local.value = local.value.copy(customerText = c.name, customerId = c.id)
    }

    /** Who the invoice bills is baked into the issued document, so it freezes with the basket. */
    private fun frozenBySettle(): Boolean {
        if (local.value.pendingSettle == null) return false
        local.value = local.value.copy(notice = SETTLE_LOCK_NOTICE)
        return true
    }

    // ── payment pad ──────────────────────────────────────────────────────────
    fun openPad() {
        if (local.value.cart.isEmpty()) { local.value = local.value.copy(error = "Add at least one product."); return }
        // A pending settle pins method/tender/ref to what the frozen request already sent — the
        // retry MUST replay identically, so reopening the pad must NOT reset them (the server
        // ignores a retry's arguments; a reset would print a receipt that lies about the tender).
        if (local.value.pendingSettle != null) { local.value = local.value.copy(padOpen = true, error = settleError()); return }
        local.value = local.value.copy(padOpen = true, method = PayMethod.CASH, tenderText = "", refText = "", error = null)
    }
    fun closePad() {
        // Keep the settle context (collect + method/tender) so reopening resumes the same retry.
        if (local.value.pendingSettle != null) { local.value = local.value.copy(padOpen = false); return }
        local.value = local.value.copy(padOpen = false, collect = null)
    }
    fun setMethod(m: PayMethod) { if (frozenBySettle()) return; local.value = local.value.copy(method = m, error = settleError()) }

    /** An unresolved settle keeps its message: it is the cashier's only instruction for getting out. */
    private fun settleError(): String? = local.value.error.takeIf { local.value.pendingSettle != null }
    fun setRef(t: String) { if (frozenBySettle()) return; local.value = local.value.copy(refText = t) }
    fun setTenderCents(cents: Long) { if (frozenBySettle()) return; local.value = local.value.copy(tenderText = (cents / 100).toString() + if (cents % 100 != 0L) "." + (cents % 100).toString().padStart(2, '0') else "") }

    /** Spec numpad rules: digits append; one '.'; ≤2 decimals; ≤7 integer digits; ⌫ deletes. */
    fun padKey(key: String) {
        if (frozenBySettle()) return
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
                    val printed = runCatching {
                        printer.printReceipt(ReceiptText.render(receipt)) // prints the moment the sale completes
                    }.isSuccess
                    if (s.method == PayMethod.CASH) runCatching { drawer.kick() }
                    logReceiptOutcome(result.number, printed)
                }
                local.value = local.value.copy(busy = false, padOpen = false, done = result, receipt = receipt, pendingSettle = null)
            } catch (e: Exception) {
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    fun newSale() {
        // Never discard an unresolved settle — it may hold a committed invoice under saleKey.
        if (local.value.pendingSettle != null) { local.value = local.value.copy(notice = SETTLE_LOCK_NOTICE); return }
        saleKey = UUID.randomUUID().toString()
        val cur = local.value
        local.value = CounterUiState(till = cur.till, mode = cur.mode, bills = cur.bills, paidToday = cur.paidToday)
        refreshTill()
    }

    fun signOut() = viewModelScope.launch { session.signOut() }

    /**
     * Traceability: record whether the customer walked away with a printed slip
     * (Cashmag's "non édition d'une note"). Fire-and-forget — a sale must never
     * fail on its audit trail.
     */
    private fun logReceiptOutcome(number: String?, printed: Boolean) {
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: return@launch
                api.insertAuditEvent(
                    tenantId = tenant,
                    eventType = if (printed) "receipt_printed" else "receipt_skipped",
                    deviceId = session.deviceId(),
                    payload = buildJsonObject { if (number != null) put("number", number) },
                )
            }
        }
    }
}
