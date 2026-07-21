package mu.carfection.pos.feature.counter

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
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
import mu.carfection.pos.core.data.SERVICES_TAB
import mu.carfection.pos.core.data.SaleRepository
import mu.carfection.pos.core.data.SaleResult
import mu.carfection.pos.core.data.expandSaleLines
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.CashDrawer
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptLine
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.money.DocTotals
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.lineExclCents
import mu.carfection.pos.core.money.netFromGrossCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.core.network.JobServiceDetailDto
import mu.carfection.pos.core.network.OutstandingInvoiceDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.data.saleReceiptDoc
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
    val onHand: Map<String, Int> = emptyMap(), // productId → stock at the selling floor, where this till sells from
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
    // How much of the bill is being settled now. Empty = all of it. Only a collect can
    // carry a balance, so only a collect can type here.
    val payText: String = "",
    val padField: PadField = PadField.TENDER, // which display the numpad is typing into
    val refText: String = "",
    val comment: String = "", // internal note for the sale — shown in the back office, never on the receipt
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
    // Split bill: an allocation table — how much the customer pays on each method. Off by
    // default; the amounts are typed per row (splitFocus is the row the numpad types into).
    val splitMode: Boolean = false,
    val splitFocus: PayMethod = PayMethod.CASH,
    val splitText: Map<PayMethod, String> = emptyMap(),
    // studio identity for the payment screen's bill panel (Cashmag-style header)
    val bizName: String = "",
    val bizAddress: String? = null,
    // The shop quotes VAT-INCLUSIVE shelf prices — show gross on screen. Prices stay stored
    // net and the totals below stay net + VAT; this only changes what staff read.
    val pricesInclVat: Boolean = false,
    // The bill panel's real detail for a collect: the invoice's own lines + (for a job) the
    // service performed. Fetched when the pad opens; empty while in flight or for a walk-in.
    val collectLines: List<SaleHistoryLineDto> = emptyList(),
    val collectJob: JobServiceDetailDto? = null,
    val collectDetailFailed: Boolean = false, // the item fetch errored — offer a retry, not a forever "loading"
) {
    /** The whole balance the pad COULD settle: an invoice's outstanding, or the cart total. */
    val dueCents: Long get() = collect?.let { rupeesToCents(it.totalIncl) - rupeesToCents(it.amountPaid) } ?: totals.totalCents

    /**
     * What is being taken RIGHT NOW in single-method mode — a deposit, or the lot. Capped at
     * the balance. Empty = the whole balance, so an untouched walk-in still settles in full.
     */
    val payCents: Long
        get() {
            val typed = if (payText.isBlank()) null else parseMoneyToCents(payText)
            return (typed ?: dueCents).coerceIn(0, dueCents.coerceAtLeast(0))
        }

    /** Money still owed after this entry lands — what stays in TO COLLECT. */
    val balanceAfterCents: Long get() = (dueCents - payCents).coerceAtLeast(0)
    val isPartPayment: Boolean get() = collect != null && payCents in 1 until dueCents

    val tenderCents: Long? get() = if (tenderText.isBlank()) null else parseMoneyToCents(tenderText)
    val effectiveTenderCents: Long get() = tenderCents ?: payCents // pad opens "exact"
    val changeCents: Long get() = (effectiveTenderCents - payCents).coerceAtLeast(0)

    // ── split allocation (Cash / Card / Juice / Bank — never Credit) ────────────
    /** Cents allocated to a method in the split table (0 if blank). */
    fun splitCents(m: PayMethod): Long = (splitText[m]?.let { if (it.isBlank()) null else parseMoneyToCents(it) } ?: 0L).coerceAtLeast(0)
    /** Total allocated across every split row. */
    val allocatedCents: Long get() = SPLIT_METHODS.sumOf { splitCents(it) }
    /** What is still unallocated — the split's running balance. */
    val splitBalanceCents: Long get() = dueCents - allocatedCents
    /** The split is ready when its rows sum EXACTLY to the bill and a till is open. */
    val splitCanRecord: Boolean get() = !busy && till != null && dueCents > 0 && allocatedCents == dueCents

    /** Does the current single entry satisfy its method's rules (till, tender, customer)? */
    private val entryValid: Boolean
        get() = when (method) {
            PayMethod.CASH -> effectiveTenderCents >= payCents && till != null
            PayMethod.CREDIT -> (collect == null && customerId != null) || (collect?.customers != null)
            else -> till != null // card/juice/bank
        }

    val canRecord: Boolean
        get() = !busy && (collect != null || cart.isNotEmpty()) && when (method) {
            PayMethod.CREDIT -> dueCents > 0 && entryValid
            // A COLLECT may take a partial (a deposit); a WALK-IN must be settled in full.
            else -> payCents > 0 && entryValid && (collect != null || payCents == dueCents)
        }

    /** Why the pay button is dead, when the reason is the till and not the basket. */
    val cashNeedsTill: Boolean get() = (splitMode || method != PayMethod.CREDIT) && till == null && (payCents > 0 || allocatedCents > 0)

    /** Quick-tender chips: the round-ups a customer actually hands over, above what is being paid. */
    val quickTenders: List<Long>
        get() {
            val t = payCents
            fun up(step: Long) = ((t + step - 1) / step) * step
            return listOf(up(100_00), up(500_00), up(1000_00), up(5000_00))
                .filter { it > t }.distinct().take(3)
        }

    /** Deposit chips — half or three-quarters of the balance (a collect deposit). */
    val depositChips: List<Long>
        get() = if (dueCents <= 0) emptyList()
        else listOf(dueCents / 2, dueCents / 4 * 3).map { it / 100 * 100 }.filter { it in 1 until dueCents }.distinct()

    // ── basket discount, derived from the raw input ─────────────────────────────
    val basketPct: Int get() = if (basketMode == DiscountMode.PCT) (basketText.toIntOrNull() ?: 0).coerceIn(0, 100) else 0
    val basketAmtCents: Long get() = if (basketMode == DiscountMode.AMT) (parseMoneyToCents(basketText) ?: 0L).coerceAtLeast(0) else 0

    /** What the basket discount actually takes off (post-clamp, post-apportionment). */
    val basketAppliedCents: Long
        get() = specs.filter { it.productId == null && it.title.startsWith("Basket discount") }.sumOf { -it.unitCents }

    /** Subtotal before the basket discount — what the "Subtotal" row shows. */
    val preBasketSubtotalCents: Long get() = totals.subtotalCents + basketAppliedCents

    /**
     * Subtotal on a gross-quoting shop: the sum of the very line amounts printed in the cart,
     * so the footer can never disagree with the list above it. Derived from the lines rather
     * than from `total + basketApplied` — that shortcut assumed the basket discount was
     * VAT-inclusive (true of the documents order-discount, false here, where the counter emits
     * the discount as a net line) and showed a Subtotal 15% of the discount short of the lines.
     */
    val grossSubtotalCents: Long get() = cart.sumOf { it.rowGrossCents }

    /**
     * What the basket discount actually takes off the bill the customer pays. Taken as the gap
     * between the lines and the TOTAL rather than the typed figure, so Subtotal − Discount =
     * TOTAL always holds. On a Rs discount this reads higher than the cashier typed, because
     * the discount line carries VAT (see SaleRepository) — the footer states what really came
     * off rather than repeating the request back.
     */
    val basketAppliedGrossCents: Long get() = (grossSubtotalCents - totals.totalCents).coerceAtLeast(0)
}

enum class CheckoutMode { LIST, WALKIN }

/** The methods a split bill can be allocated across — Credit is a receivable, not a tender. */
val SPLIT_METHODS = listOf(PayMethod.CASH, PayMethod.CARD, PayMethod.JUICE, PayMethod.BANK)

/** Which figure the numpad is editing: what we're taking, or what the customer handed over. */
enum class PadField { AMOUNT, TENDER }

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
        // A retry may re-fail without knowing the number — never forget one we had.
        pendingSettle = PendingSettle(e.invoiceId, e.number ?: pendingSettle?.number),
        error = "${e.number?.let { "Invoice $it" } ?: "The invoice"} was issued but the payment " +
            "didn't confirm. Tap Record payment again — retrying can never charge twice. " +
            "Cancelling leaves it on the server.",
    )
    is SaleIssueUncertain -> copy(
        busy = false,
        // Keep a known invoiceId: overwriting it with nulls used to send the retry back
        // through draft+issue, which the idempotency guard rightly refused forever.
        pendingSettle = pendingSettle ?: PendingSettle(null, null),
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
    private val outbox: mu.carfection.pos.core.sync.OutboxRepository,
    private val collectBus: mu.carfection.pos.core.data.CollectBus,
) : ViewModel() {

    private val local = MutableStateFlow(CounterUiState())

    val state: StateFlow<CounterUiState> =
        combine(local, catalog.products, catalog.customers) { s, products, customers ->
            // "All" always survives the rail search, so there is always a way back out.
            // "Services" is pinned beside it — same rule as the quote builder's rail.
            val catQ = s.catQuery.trim()
            val cats = listOf("All", SERVICES_TAB) + products.mapNotNull { it.category }.distinct().sorted()
                .filter { catQ.isEmpty() || it.contains(catQ, ignoreCase = true) }
            val counts = products.mapNotNull { it.category }.groupingBy { it }.eachCount() +
                ("All" to products.size) + (SERVICES_TAB to products.count { it.kind == "service" })
            val q = s.query.trim().lowercase()
            val filtered = products
                .filter {
                    when (s.tab) {
                        "All" -> true
                        SERVICES_TAB -> it.kind == "service"
                        else -> it.category == s.tab
                    }
                }
                .filter { q.isEmpty() || it.name.lowercase().contains(q) || (it.barcode ?: "").contains(q) }
            val cq = s.customerText.trim().lowercase()
            val matches = if (cq.isEmpty() || s.customerId != null) emptyList()
            else customers.filter { it.name.lowercase().contains(cq) }.take(6)
            s.copy(products = filtered, categories = cats, catCounts = counts, customerMatches = matches)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CounterUiState())

    // The whole catalogue, unfiltered — the scanner must find a barcode even while
    // the visible grid is filtered down by category tab or a half-typed search.
    private var allProducts: List<ProductEntity> = emptyList()

    init {
        refreshTill()
        loadLists()
        refreshStock()
        watchCollectRequests() // a deposit agreed at signing lands the pad on its bill
        viewModelScope.launch { catalog.products.collect { allProducts = it } }
        // Studio identity for the payment screen's bill panel (Cashmag-style header).
        viewModelScope.launch {
            runCatching { catalog.receiptBiz() }.getOrNull()?.let { biz ->
                local.value = local.value.copy(bizName = biz.name, bizAddress = biz.address)
            }
        }
        // Does the shop quote gross? Collected, not read once — the settings sync below writes
        // this flag, and a snapshot would lose the race on the first launch after an update.
        viewModelScope.launch {
            catalog.pricesInclVatFlow.collect { incl -> local.value = local.value.copy(pricesInclVat = incl) }
        }
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
        // Studio identity is not per-operator — keep it so the next login's payment screen
        // doesn't fall back to the hardcoded name (the ViewModel is activity-scoped; init
        // won't re-run to re-fetch it).
        val cur = local.value
        local.value = CounterUiState(till = cur.till, bizName = cur.bizName, bizAddress = cur.bizAddress, pricesInclVat = cur.pricesInclVat)
    }

    // ── checkout list: TO COLLECT + PAID TODAY ─────────────────────────────────
    fun loadLists() {
        local.value = local.value.copy(listBusy = true)
        viewModelScope.launch {
            val start = LocalDate.now(ZoneOffset.ofHours(4)).atStartOfDay(ZoneOffset.ofHours(4))
                .toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            // Only invoices with money actually owed: a zero-total (or fully settled)
            // issued invoice has nothing to collect — offering it opened a Rs 0.00
            // payment pad that could never succeed.
            val bills = runCatching { api.fetchOutstandingInvoices() }.getOrDefault(emptyList())
                .filter { rupeesToCents(it.totalIncl) - rupeesToCents(it.amountPaid) > 0 }
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

    /** On-hand counts for the product tiles (stock line + low-stock badge) and
     *  the oversell prompt — counted at the SELLING FLOOR, because that is the
     *  only stock this till can actually sell. Cached: the floor doesn't move
     *  between refreshes. */
    private var salesFloorId: String? = null
    private fun refreshStock() = viewModelScope.launch {
        runCatching {
            val floor = salesFloorId ?: api.fetchShopLocationId()?.also { salesFloorId = it }
            api.fetchStockOnHand(floor)
        }.onSuccess { rows ->
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
            // When the shop quotes gross, staff type what the customer pays — store the NET,
            // because the ledger adds VAT on top of whatever unit price it is handed.
            val unit = if (catalog.pricesInclVat()) netFromGrossCents(priceCents, vat) else priceCents
            val p = ProductEntity(
                id = CartLine.ADHOC_PREFIX + UUID.randomUUID(),
                name = name.trim(), kind = "adhoc", sellingPriceCents = unit,
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
                voided = h.status == "void",
            )
            local.value = local.value.copy(viewDoc = doc)
        }
    }

    /** Reprint the previewed past-sale slip. */
    fun printViewDoc() {
        val doc = local.value.viewDoc ?: return
        viewModelScope.launch { runCatching { printer.printDoc(doc) } }
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
        viewModelScope.launch { runCatching { printer.printDoc(doc) } }
        local.value = local.value.copy(notice = "Receipt sent to the printer")
    }

    /**
     * Void the sale just completed: unpaid/on-account → void; paid → credit note (restocks).
     * [reason] is REQUIRED where it lands in the books (void_document / reverse_payment) —
     * the owner reads it in Activity/Traceability; "Voided at POS" told them nothing.
     */
    fun voidCompletedSale(reason: String?) {
        val r = local.value.done ?: return
        val why = reason?.trim().takeUnless { it.isNullOrEmpty() }
        newSale() // clear the finished cart first; the sale itself is already committed
        when {
            // A SPLIT COLLECT: reverse each of THIS transaction's payments (not a credit note
            // over the whole invoice — that would refund a prior deposit too, audit #6).
            r.paymentIds.isNotEmpty() && r.fromCollect -> correction("Split reversed — ${r.number ?: "invoice"}") {
                r.paymentIds.forEach { api.reversePayment(it, why ?: "Reversed at POS") }
            }
            // A COLLECT (deposit / part payment on an existing invoice): reverse just THIS
            // payment. Credit-noting the whole invoice here would refund and restock an
            // entire live job after only a deposit was taken (audit #6).
            r.paymentId != null -> correction("Payment reversed — ${r.number ?: "invoice"}") {
                // 2-arg form: reverse_payment falls back to the device's open till for a cash
                // refund, which is the till this collect was just taken on.
                api.reversePayment(r.paymentId, why ?: "Reversed at POS")
            }
            // An on-account COLLECT's undo walks the HANDOVER back — the job returns to
            // READY and the bill stays open. Voiding here erased the receivable for a car
            // that had already left (and the job stayed delivered).
            r.onAccount && r.fromCollect -> correction("Handover walked back — ${r.number ?: "the bill"} stays owed") { api.undoOnAccount(r.invoiceId) }
            r.onAccount -> correction("${r.number ?: "Invoice"} voided") { api.voidDocument(r.invoiceId, why ?: "Voided at POS") }
            else -> correction("Refunded — credit note issued for ${r.number ?: "the sale"}") {
                // This till takes the refund out of its drawer (booked mirrors on the CN).
                api.issueCreditNote(r.invoiceId, restock = true, stockLocationId = api.fetchShopLocationId(), sessionId = local.value.till?.id)
            }
        }
    }

    fun voidInvoice(bill: OutstandingInvoiceDto, reason: String) =
        correction("${bill.number ?: "Invoice"} voided") { api.voidDocument(bill.id, reason.trim().ifEmpty { "Voided at POS" }) }
    /** Reason is REQUIRED — the owner reads it in Activity/Traceability/Cash Flow. */
    fun reverseThisPayment(p: TodayPaymentDto, reason: String) = correction("Payment reversed") { api.reversePayment(p.id, reason) }
    fun refundInvoice(p: TodayPaymentDto) = correction("Credit note issued — ${p.documents?.number ?: "invoice"}") {
        api.issueCreditNote(p.documentId, restock = true, stockLocationId = api.fetchShopLocationId(), sessionId = local.value.till?.id)
    }

    /** Tap an outstanding invoice → open the pad to collect its balance. */
    fun collectOn(bill: OutstandingInvoiceDto, amountCents: Long? = null) {
        // Starting a new collection would rotate saleKey and abandon an in-flight settle.
        if (frozenBySettle()) return
        saleKey = UUID.randomUUID().toString()
        local.value = local.value.copy(
            collect = bill, padOpen = true, method = PayMethod.CASH,
            collectLines = emptyList(), collectJob = null, collectDetailFailed = false,
            // Every bill opens at its full balance — unless a deposit was agreed at signing,
            // which dials the pad in for the cashier. A part payment typed for the LAST
            // customer must never ride along into this one's.
            tenderText = "",
            payText = amountCents?.let { centsToText(it) } ?: "",
            padField = PadField.TENDER,
            refText = "", error = null, splitMode = false, splitText = emptyMap(),
        )
        loadCollectDetail(bill)
    }

    /**
     * Fill the bill panel with what the client actually took: the invoice's own line items,
     * plus — for a job/service invoice — the service performed (its checklist). Best-effort;
     * the amount/customer/vehicle already render from the DTO in hand, so a failure just leaves
     * the itemised detail blank rather than blocking the collection.
     */
    private fun loadCollectDetail(bill: OutstandingInvoiceDto) {
        viewModelScope.launch {
            val fetched = runCatching { api.fetchInvoice(bill.id)?.lines.orEmpty().sortedBy { it.sortOrder } }
            val job = bill.jobId?.let { jid -> runCatching { api.fetchJobDetail(jid) }.getOrNull() }
            val st = local.value
            if (st.collect?.id != bill.id) return@launch // a newer bill (or none) is on the pad now
            local.value = st.copy(
                collectLines = fetched.getOrDefault(emptyList()),
                collectJob = job,
                collectDetailFailed = fetched.isFailure,
            )
        }
    }

    /** The item fetch failed (bad connection) — try again for the bill still on the pad. */
    fun retryCollectDetail() {
        val bill = local.value.collect ?: return
        local.value = local.value.copy(collectDetailFailed = false)
        loadCollectDetail(bill)
    }

    /**
     * A customer just signed a quote and left a deposit: the bill is waiting, the figure is
     * agreed. Land on it with the pad already open. Latched, so it survives the navigation
     * that creates this ViewModel in the first place.
     */
    private fun watchCollectRequests() {
        viewModelScope.launch {
            collectBus.pending.collect { req ->
                if (req == null) return@collect
                val bills = runCatching { api.fetchOutstandingInvoices() }.getOrDefault(emptyList())
                val bill = bills.firstOrNull { it.id == req.invoiceId }
                if (bill != null) {
                    local.value = local.value.copy(mode = CheckoutMode.LIST, bills = bills)
                    collectOn(bill, req.amountCents)
                }
                // Consume either way: a bill already settled (or a failed fetch) must not leave
                // the pad springing open on the next unrelated visit to Checkout.
                collectBus.consume()
            }
        }
    }

    /** The pad's confirm button: split allocation, collect on an invoice, or settle the cart. */
    fun confirm() = when {
        local.value.splitMode -> recordSplit()
        local.value.collect != null -> recordCollect()
        else -> record()
    }

    /**
     * Commit the SPLIT allocation: one tender per non-zero row. Walk-in → issue once then
     * record each; collect → record each against the bill. The receipt is rebuilt from the
     * server invoice, so it shows every tender line.
     */
    private fun recordSplit() {
        val s = state.value
        if (!s.splitCanRecord || s.busy) return
        val bill = s.collect
        // One tender per method that has money on it, in a stable order (idempotency keys are
        // per-index, so the same allocation always maps to the same keys on a retry).
        val allTenders = SPLIT_METHODS.mapNotNull { m ->
            s.splitCents(m).takeIf { it > 0 }?.let { cents ->
                mu.carfection.pos.core.data.Tender(
                    method = m,
                    amountCents = cents,
                    tenderedCents = if (m == PayMethod.CASH) cents else null, // split rows are exact
                    ref = if (m == PayMethod.CASH) null else "POS",
                )
            }
        }
        if (allTenders.isEmpty()) return
        val anyCash = allTenders.any { it.method == PayMethod.CASH }
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val result = if (bill != null) {
                    sales.collectSplit(bill.id, bill.number, allTenders, s.till?.id, saleKey)
                } else {
                    sales.completeSaleSplit(
                        cart = s.cart, tenders = allTenders, customerId = s.customerId, walkInName = s.customerText,
                        cashSessionId = s.till?.id, saleKey = saleKey,
                        basketMode = s.basketMode, basketPct = s.basketPct, basketAmtCents = s.basketAmtCents,
                        comment = s.comment, knownInvoiceId = s.pendingSettle?.invoiceId,
                    )
                }
                // Rebuild the slip from the server invoice — it now carries every tender row.
                val receipt = runCatching {
                    api.fetchInvoice(result.invoiceId)?.let {
                        saleReceiptDoc(it, catalog.receiptBiz(), catalog.vatDefault().toInt()).copy(isPayment = bill != null)
                    }
                }.getOrNull()
                launch {
                    val printed = receipt != null && runCatching { printer.printDoc(receipt) }.isSuccess
                    if (anyCash) runCatching { drawer.kick() }
                    logReceiptOutcome(result.number, printed)
                }
                local.value = local.value.copy(
                    busy = false, padOpen = false, collect = null, pendingSettle = null,
                    splitMode = false, splitText = emptyMap(),
                    done = result.copy(fromCollect = bill != null, debtor = bill?.customers?.name),
                    receipt = receipt,
                )
                loadLists()
            } catch (e: Exception) {
                local.value = local.value.withSettleFailure(e)
            }
        }
    }

    private fun recordCollect() {
        val s = state.value
        val bill = s.collect ?: return
        if (!s.canRecord || s.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                // Credit on a collect: the customer takes the balance on their account. Record no
                // payment — the invoice simply stays outstanding (their receivable, on the
                // statement). Show the slip with what it was for, stamped "on account".
                if (s.method == PayMethod.CREDIT) {
                    // The handover happens NOW: the bill's READY job moves to delivered, on
                    // account. If the server refuses, the collect fails loudly — printing paper
                    // for a handover the server never saw is how a car leaves while its job
                    // sits at READY forever (the original bug).
                    try {
                        api.deliverOnAccount(bill.id)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        local.value = local.value.copy(busy = false, error = "Couldn't record the handover — ${e.message ?: "try again"}")
                        return@launch
                    }
                    val creditSlip = runCatching {
                        api.fetchInvoice(bill.id)?.let {
                            saleReceiptDoc(it, catalog.receiptBiz(), catalog.vatDefault().toInt())
                                // A deposit on the bill makes the builder read it as a payment
                                // slip — this slip records credit, whatever came before.
                                .copy(isPayment = true, onAccount = true)
                        }
                    }.getOrNull()
                    launch {
                        val printed = creditSlip != null && runCatching { printer.printDoc(creditSlip) }.isSuccess
                        logReceiptOutcome(bill.number, printed)
                    }
                    local.value = local.value.copy(
                        busy = false, padOpen = false, collect = null, pendingSettle = null,
                        done = SaleResult(bill.id, bill.number, s.dueCents, 0L, onAccount = true,
                            fromCollect = true, debtor = bill.customers?.name),
                        receipt = creditSlip,
                    )
                    loadLists()
                    return@launch
                }
                val result = sales.collectOnInvoice(
                    invoiceId = bill.id,
                    number = bill.number,
                    amountCents = s.payCents, // a deposit or a part payment, not always the lot
                    method = s.method,
                    tenderCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else null,
                    externalRef = s.refText,
                    cashSessionId = s.till?.id,
                    payKey = saleKey,
                )
                // The bill's items live on the server — the counter never held them, so this
                // slip carried a total and nothing else: the customer paid Rs 38,000 and the
                // paper never said what for. Rebuild it from the invoice that was just paid,
                // through the same builder the job screen and the reprint use, so all three
                // agree. If the line is down, fall back to the bare total — a slip without
                // items still beats no slip at all.
                val receipt = runCatching {
                    api.fetchInvoice(bill.id)?.let {
                        saleReceiptDoc(it, catalog.receiptBiz(), catalog.vatDefault().toInt())
                            .copy(isPayment = true)
                    }
                }.getOrNull() ?: ReceiptDoc(
                    biz = catalog.receiptBiz(),
                    invoiceNo = bill.number,
                    dateTime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm")),
                    cashier = session.userName,
                    customer = bill.customers?.name ?: "Walk-in",
                    lines = emptyList(),
                    subtotalCents = s.dueCents, vatRatePct = catalog.vatDefault().toInt(),
                    vatCents = 0L, discountCents = 0L, totalCents = s.dueCents,
                    payLabel = s.method.label,
                    paidCents = if (s.method == PayMethod.CASH) s.effectiveTenderCents else s.payCents,
                    changeCents = s.changeCents,
                    onAccount = false, isPayment = true,
                    balanceDueCents = s.balanceAfterCents,
                )
                launch {
                    val printed = runCatching {
                        printer.printDoc(receipt) // instant payment slip
                    }.isSuccess
                    if (s.method == PayMethod.CASH) runCatching { drawer.kick() }
                    logReceiptOutcome(bill.number, printed)
                }
                local.value = local.value.copy(
                    busy = false, padOpen = false, collect = null, pendingSettle = null,
                    done = result.copy(fromCollect = true, debtor = bill.customers?.name), receipt = receipt,
                )
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
    /**
     * The search box is also the barcode scanner's landing strip (the small checkout
     * tablet drives sales by scanner): a scanner is a keyboard that types the whole code
     * in one burst, so an EXACT barcode match rings the item straight into the cart and
     * clears the box — no tap, next scan ready. Typed text never equals a barcode, so
     * ordinary searching is untouched.
     */
    fun setQuery(q: String) {
        val code = q.trim()
        val hit = if (code.length >= 4) allProducts.firstOrNull { it.barcode == code } else null
        if (hit != null) {
            add(hit) // oversell prompt and settle-freeze rules apply exactly as a tap would
            local.value = local.value.copy(query = "", notice = "Scanned — ${hit.name}")
        } else {
            local.value = local.value.copy(query = q)
        }
    }

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

    /**
     * Create a brand-new customer from the typed name and select them — for an on-account
     * (credit) sale to someone not in the book yet, right from the payment screen.
     */
    fun createCustomer(name: String) {
        if (frozenBySettle()) return
        val clean = name.trim()
        if (clean.isEmpty() || local.value.busy) return
        local.value = local.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching {
                val tenant = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
                // Reuse an existing customer of the same name rather than minting a duplicate.
                api.findCustomerByName(clean)?.id ?: api.insertCustomer(NewCustomerDto(tenantId = tenant, name = clean)).id
            }.onSuccess { id ->
                runCatching { catalog.refresh() } // so the new customer shows in later searches
                local.value = local.value.copy(busy = false, customerText = clean, customerId = id, customerMatches = emptyList())
            }.onFailure { e ->
                local.value = local.value.copy(busy = false, error = e.uiMessage("Couldn't create the customer"))
            }
        }
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
        local.value = local.value.copy(padOpen = true, method = PayMethod.CASH, tenderText = "", refText = "", payText = "", error = null, splitMode = false, splitText = emptyMap())
    }
    fun closePad() {
        val st = local.value
        if (st.pendingSettle != null) {
            if (st.collect != null) {
                // A frozen COLLECTION is safe to cancel: there is no basket to mis-ring —
                // the invoice lives on the server, so drop the freeze and re-read the list.
                // If the payment did commit despite the lost response, the refreshed
                // balance shows it (and the bill leaves TO COLLECT); the idempotency key
                // is never reused, so a later retry can only collect what remains.
                local.value = st.copy(
                    padOpen = false, collect = null, pendingSettle = null, error = null,
                    collectLines = emptyList(), collectJob = null, collectDetailFailed = false,
                    notice = "Collection cancelled — list refreshed",
                )
                loadLists()
                return
            }
            // A frozen WALK-IN keeps its context: the retry must replay the identical basket.
            local.value = st.copy(padOpen = false)
            return
        }
        local.value = st.copy(padOpen = false, collect = null, collectLines = emptyList(), collectJob = null, collectDetailFailed = false)
    }
    fun setMethod(m: PayMethod) { if (frozenBySettle()) return; local.value = local.value.copy(method = m, error = settleError()) }

    // ── split bill: the allocation table ────────────────────────────────────────
    /** Open / close the split table. Turning it on clears any single-method entry. */
    fun toggleSplit() {
        if (frozenBySettle()) return
        val s = local.value
        local.value = if (s.splitMode) s.copy(splitMode = false, splitText = emptyMap(), error = null)
        else s.copy(splitMode = true, splitFocus = PayMethod.CASH, splitText = emptyMap(),
            payText = "", tenderText = "", refText = "", error = null)
    }

    /** Focus a method row so the numpad types into it. */
    fun setSplitFocus(m: PayMethod) { if (frozenBySettle()) return; local.value = local.value.copy(splitFocus = m) }

    /** Type into the focused split row (same numpad grammar as the pad). */
    fun splitPadKey(key: String) {
        if (frozenBySettle()) return
        val s = local.value
        val cur = s.splitText[s.splitFocus] ?: ""
        val next = when (key) {
            "⌫" -> cur.dropLast(1)
            "." -> if (cur.contains('.')) cur else if (cur.isEmpty()) "0." else "$cur."
            else -> {
                val (int, dec) = cur.split('.').let { it[0] to it.getOrNull(1) }
                when { dec != null && dec.length >= 2 -> cur; dec == null && int.length >= 7 -> cur; else -> cur + key }
            }
        }
        local.value = s.copy(splitText = s.splitText + (s.splitFocus to next))
    }

    /** Fill the focused row with whatever is still unallocated (the "Rest" shortcut). */
    fun fillSplitRest() {
        if (frozenBySettle()) return
        val s = local.value
        val already = SPLIT_METHODS.filter { it != s.splitFocus }.sumOf { s.splitCents(it) }
        val rest = (s.dueCents - already).coerceAtLeast(0)
        local.value = s.copy(splitText = s.splitText + (s.splitFocus to centsToText(rest)))
    }

    /** An unresolved settle keeps its message: it is the cashier's only instruction for getting out. */
    private fun settleError(): String? = local.value.error.takeIf { local.value.pendingSettle != null }
    fun setRef(t: String) { if (frozenBySettle()) return; local.value = local.value.copy(refText = t) }
    fun setComment(t: String) { if (frozenBySettle()) return; local.value = local.value.copy(comment = t) }
    private fun centsToText(cents: Long) =
        (cents / 100).toString() + if (cents % 100 != 0L) "." + (cents % 100).toString().padStart(2, '0') else ""

    fun setTenderCents(cents: Long) { if (frozenBySettle()) return; local.value = local.value.copy(tenderText = centsToText(cents)) }

    /**
     * Take part of the bill now and leave the rest owing — a deposit at booking, a customer
     * paying half today. Only a collect reaches here; a counter sale has no balance to carry.
     * Clearing the field means the whole balance again.
     */
    fun setPayCents(cents: Long?) {
        if (frozenBySettle()) return
        local.value = local.value.copy(
            payText = cents?.let { centsToText(it) } ?: "",
            tenderText = "", // the tender was for the old figure; re-open it at "exact"
        )
    }

    fun focusPad(f: PadField) { if (frozenBySettle()) return; local.value = local.value.copy(padField = f) }

    /** Spec numpad rules: digits append; one '.'; ≤2 decimals; ≤7 integer digits; ⌫ deletes. */
    fun padKey(key: String) {
        if (frozenBySettle()) return
        val st = local.value
        // Which field the keys type into. Non-cash has no tender to count out, so the keys
        // always mean the amount; cash types the tender unless the AMOUNT card is focused.
        // (This is method-driven now — a WALK-IN can type an amount too, for a split. The old
        // `collect != null` guard silently routed a walk-in's typed amount into the tender.)
        val onAmount = st.padField == PadField.AMOUNT || st.method != PayMethod.CASH
        val t = if (onAmount) st.payText else st.tenderText
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
        local.value = if (onAmount) st.copy(payText = next, tenderText = "") else st.copy(tenderText = next)
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
                    comment = s.comment,
                    // Retry of a settle that already issued: go straight to the payment.
                    knownInvoiceId = s.pendingSettle?.invoiceId,
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
                        printer.printDoc(receipt) // prints the moment the sale completes
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
        local.value = CounterUiState(
            till = cur.till, mode = cur.mode, bills = cur.bills, paidToday = cur.paidToday,
            bizName = cur.bizName, bizAddress = cur.bizAddress, pricesInclVat = cur.pricesInclVat, // studio identity is not per-sale
        )
        refreshTill()
    }

    fun signOut() = viewModelScope.launch { session.signOut() }

    /**
     * Traceability: record whether the customer walked away with a printed slip
     * (Cashmag's "non édition d'une note"). Queued through the outbox, not fired
     * at the network: a sale must never fail on its audit trail, but the trail
     * must also never silently LOSE an event to a Wi-Fi blip — the owner reads
     * this history as fact. The enqueue is a local Room write (fast, offline-safe);
     * the outbox retries delivery until it lands.
     */
    private fun logReceiptOutcome(number: String?, printed: Boolean) {
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: return@launch
                outbox.enqueueAuditEvent(
                    tenantId = tenant,
                    eventType = if (printed) "receipt_printed" else "receipt_skipped",
                    deviceId = session.deviceId(),
                    payload = buildJsonObject { if (number != null) put("number", number) },
                    label = "Receipt trace · ${number ?: "sale"}",
                )
            }
        }
    }
}
