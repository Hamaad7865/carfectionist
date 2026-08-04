package mu.carfection.pos.feature.quote

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.DiscountMode
import mu.carfection.pos.core.data.KindFilter
import mu.carfection.pos.core.data.IntakeHandoff
import mu.carfection.pos.core.data.IntakeHandoffBus
import mu.carfection.pos.core.data.OpenJobBus
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.DocDiscountTotals
import mu.carfection.pos.core.money.DocLineIn
import mu.carfection.pos.core.money.centsToPlainText
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.computeDocTotals
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.core.money.netFromGrossCents
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.QuoteRowDto
import mu.carfection.pos.core.network.SendOutcome
import mu.carfection.pos.core.network.TechnicianDto
import mu.carfection.pos.core.network.uiMessage
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject

enum class QuoteMode { LIST, BUILDER }

data class QuoteLine(
    val productId: String?,
    val title: String,
    val priceText: String, // unit price (Rs, excl VAT) — editable raw input
    val vatRate: Double,
    val qty: Int = 1,
    val discountMode: DiscountMode = DiscountMode.PCT,
    val discountPct: Int = 0,
    val discountAmtText: String = "", // Rs off, VAT-inclusive (matches the DB's semantics)
    val expanded: Boolean = false,
    // priceText is what staff SEE and TYPE. When the shop quotes gross that is the shelf
    // price, and unitCents converts it back to the net the ledger stores — one direction
    // only, so nothing drifts while the field is being edited.
    val priceIsGross: Boolean = false,
    // 'service' | 'product' — stated when the line was TYPED IN, because nothing else can
    // say what a line with no product behind it is. Null on a catalogue line: the product's
    // own kind answers, and copying it here would only let the two drift.
    val lineKind: String? = null,
) {
    val unitCents: Long get() {
        val typed = (parseMoneyToCents(priceText) ?: 0L).coerceAtLeast(0)
        return if (priceIsGross) netFromGrossCents(typed, vatRate) else typed
    }
    val discountAmtCents: Long get() = (parseMoneyToCents(discountAmtText) ?: 0L).coerceAtLeast(0)
}

/** A line at a given price in cents — keeps the constructor call sites readable. */
fun quoteLine(productId: String?, title: String, unitCents: Long, vatRate: Double, qty: Int = 1, gross: Boolean = false): QuoteLine =
    QuoteLine(
        productId, title,
        centsToPlainText(if (gross) grossCents(unitCents, vatRate) else unitCents),
        vatRate, qty, priceIsGross = gross,
    )

data class QuoteState(
    // The shop quotes VAT-inclusive shelf prices — show/accept gross. Display only; the
    // lines still save the net unit_price the ledger adds VAT to.
    val pricesInclVat: Boolean = false,
    val loading: Boolean = true,
    val mode: QuoteMode = QuoteMode.LIST,
    val quotes: List<QuoteRowDto> = emptyList(),
    val quoteId: String? = null,
    val ref: String = "New quote",
    val status: String = "draft",
    val who: String = "",
    val vehPlate: String? = null,
    val veh: String = "",
    val customerId: String? = null,
    val vehicleId: String? = null,
    // ── a quote started from nothing (no intake) ──────────────────────────────
    // Reception raises quotes over the phone and for walk-ins who are not dropping the car
    // off, so the builder has to be able to pick its own customer and car.
    val pickerOpen: Boolean = false,
    /** Confirming discard of this draft. Destructive, so it is never one tap. */
    val confirmDelete: Boolean = false,
    val pickQuery: String = "",
    val pickResults: List<mu.carfection.pos.core.database.CustomerEntity> = emptyList(),
    val pickSearching: Boolean = false,
    val pickVehicles: List<mu.carfection.pos.core.network.VehicleDto> = emptyList(),
    // Adding a customer without leaving the quote — quoting over the phone is exactly when
    // they are not on file yet, and sending staff to Intake and back loses the quote.
    val newCustOpen: Boolean = false,
    val newVehOpen: Boolean = false,
    val newVehPlate: String = "",
    val newVehMake: String = "",
    val newVehModel: String = "",
    val newCustName: String = "",
    val newCustPhone: String = "",
    val tab: String = "All", // the selected CATEGORY (same rail as Checkout)
    val kindFilter: KindFilter = KindFilter.ALL, // Products / Services toggle (mirrors the web builder)
    val query: String = "", // product search (name or scanned barcode)
    val catQuery: String = "", // narrows the category rail — 40+ categories aren't browsable
    val listQuery: String = "", // quote search on the list (customer, plate, vehicle, number)
    val products: List<ProductEntity> = emptyList(),
    val lines: List<QuoteLine> = emptyList(),
    // basket (order-level) discount — % of the inclusive total, or Rs off (VAT-inclusive)
    val basketMode: DiscountMode = DiscountMode.PCT,
    val basketText: String = "",
    val technicians: List<TechnicianDto> = emptyList(),
    val acceptOpen: Boolean = false,
    /** Ticked = the car is here and the work starts now. Unticked = signed, come back later. */
    val startJobNow: Boolean = true,
    // The crew, in the order they were picked. The FIRST is the lead — jobs.technician_id,
    // which the Z-report and the web both read — and the rest ride in job_technicians.
    val crew: List<String> = emptyList(),
    /** The lead — first of the crew. Kept as a property so every existing read still works. */
    // When the car is booked in for. null = start now; otherwise the picked date+time.
    val startAt: Long? = null,
    // How long the work should take. Null = nobody said; the board then shows no ETA
    // rather than inventing one.
    val estimateMinutes: Int? = null,
    // Money the customer leaves on signing. 0 = none. Taking one raises the bill, so it
    // also fixes the price — a change after that needs a credit note, not a quiet edit.
    val depositCents: Long = 0,
    val depositMode: DiscountMode = DiscountMode.PCT, // % chips, or a typed Rs amount
    val depositAmtText: String = "",                  // the typed Rs deposit (AMT mode)
    val depositPending: Boolean = false, // accepted with a deposit → the pad is waiting in Checkout
    /** False on reception's tablet — the deposit is collected at a paying terminal. */
    val takesPayments: Boolean = true,
    val datePickerOpen: Boolean = false,
    val timePickerOpen: Boolean = false,
    val busy: Boolean = false,
    val adhocOpen: Boolean = false,
    val savedRef: String? = null,
    val createdJobId: String? = null,
    val createdInvoiceRef: String? = null,
    val error: String? = null,
    // carried from reception: stamped onto the job when this quote is accepted
    val intake: IntakeHandoff? = null,
    // the job this quote is already linked to — when set, the quote is converted (view, don't re-create)
    val jobId: String? = null,
    // lifecycle flow strip: was there an intake, and has the client signed?
    val hasIntake: Boolean = false,
    val signed: Boolean = false,
    // a live invoice exists for this quote ("Bill now" / auto-billing on ready)
    val billed: Boolean = false,
    // "Send to customer" (post-accept): prefill + progress
    val customerEmail: String? = null,
    val customerPhone: String? = null,
    // Opened on demand for a quote that was already saved/accepted — a customer who lost the
    // WhatsApp, or wants it emailed too, should not need the quote re-accepted to get it again.
    val sendOpen: Boolean = false,
    val sendBusy: Boolean = false,
    val sendDone: String? = null,
    val sendError: String? = null,
    // False while an existing quote's lines are (re)loading or failed to load —
    // guards Save/Accept from persisting an empty basket over the real lines.
    val linesLoaded: Boolean = true,
)

/** A quote whose car was handed over — or whose job was CANCELLED — is finished
 *  business, off the working list. (Cancelled used to linger here forever.) */
/**
 * Is this quote finished business — off the working list?
 *
 * Delivered or cancelled work was already retired. Two more count as dead and were not:
 *  - the quote itself was VOIDED (cancel_job now does this to the quote that produced the job);
 *  - every invoice raised from it has been voided, which is the shop saying the billing was
 *    undone. A00023 sat in the live list on exactly that footing, with both its invoices void.
 *
 * A quote with NO invoices is untouched by the second rule — that is a quote nobody has billed
 * yet, which is the most live thing on the list.
 */
private fun QuoteRowDto.isRetired(): Boolean {
    if (status == "void") return true
    if (job?.status == "delivered" || job?.status == "cancelled") return true
    val bills = invoices.filter { it.docType == "invoice" }
    return bills.isNotEmpty() && bills.all { it.status == "void" }
}

private fun QuoteRowDto.matches(q: String): Boolean {
    val hay = listOfNotNull(
        number, customers?.name, customers?.phone,
        vehicles?.plate, vehicles?.make, vehicles?.model,
    ).joinToString(" ")
    return hay.contains(q, ignoreCase = true)
}

@HiltViewModel
class QuoteViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val api: PosApi,
    private val intakeBus: IntakeHandoffBus,
    private val session: SessionRepository,
    private val openJobBus: OpenJobBus,
    private val collectBus: mu.carfection.pos.core.data.CollectBus,
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
    private val sendApi: mu.carfection.pos.core.network.DocumentSendApi,
) : ViewModel() {
    private val _s = MutableStateFlow(QuoteState())
    val state = _s.asStateFlow()

    init {
        viewModelScope.launch { deviceRole.takesPayments.collect { t -> _s.update { it.copy(takesPayments = t) } } }
    }

    init {
        viewModelScope.launch { catalog.products.collect { p -> _s.update { it.copy(products = p) } } }
        // The standalone-quote picker searches the same cached customer book intake does.
        viewModelScope.launch { catalog.customers.collect { allCustomers = it } }
        // Pull the latest catalogue so SERVICES (and any newly-added products) show in the
        // grid even when the on-device cache predates them — stale-while-revalidate, the
        // observed flow above updates the grid the moment the fetch lands.
        viewModelScope.launch { runCatching { catalog.refresh() } }
        viewModelScope.launch {
            catalog.pricesInclVatFlow.collect { incl -> _s.update { it.copy(pricesInclVat = incl) } }
        }
        loadQuotes()
        loadTechnicians()
        // Reception hands over a customer+vehicle (+condition) — open a fresh builder on it.
        viewModelScope.launch {
            intakeBus.pending.collect { h -> if (h != null) { intakeBus.consume(); beginFromIntake(h) } }
        }
        // Activity-scoped: drop one operator's in-progress builder (customer, lines, accept panel)
        // when they sign out, so the next operator can't issue against a stranger's draft.
        viewModelScope.launch {
            session.isLoggedIn.collect {
                // Rebuilt, not copied — the point is to drop the builder wholesale. So anything
                // that describes the DEVICE rather than the operator has to be carried across by
                // hand, or it silently reverts to a default and stays wrong until whatever feeds
                // it happens to emit again. takesPayments is fed by a DataStore collector that
                // only re-emits when the role actually changes (the next heartbeat, up to four
                // minutes away): lose it here and a quotation tablet spends that window believing
                // it has a Checkout, which swallows the accept-with-deposit confirmation entirely.
                if (it == false) _s.value = QuoteState(
                    products = _s.value.products,
                    technicians = _s.value.technicians,
                    takesPayments = _s.value.takesPayments,
                    pricesInclVat = _s.value.pricesInclVat,
                )
            }
        }
    }

    // The phone rides in from intake so the WhatsApp field is prefilled on a brand-new quote,
    // exactly as it already is on one reopened from the list.
    private fun beginFromIntake(h: IntakeHandoff) = _s.update {
        it.copy(
            mode = QuoteMode.BUILDER, quoteId = null, ref = "New quote", status = "draft",
            who = h.customerName, vehPlate = h.plate, veh = h.vehLabel,
            customerId = h.customerId, vehicleId = h.vehicleId,
            lines = emptyList(), acceptOpen = false, crew = emptyList(), startAt = null,
            // A deposit % or time estimate picked on the PREVIOUS quote's accept panel must
            // not ride into this fresh one — it would raise a deposit invoice and stamp a job
            // ETA this customer never agreed to (audit #7).
            estimateMinutes = null, depositCents = 0, depositMode = DiscountMode.PCT, depositAmtText = "", depositPending = false,
            basketMode = DiscountMode.PCT, basketText = "", query = "",
            savedRef = null, createdJobId = null, createdInvoiceRef = null, error = null,
            intake = h, jobId = null,
            hasIntake = true, signed = false, billed = false,
            // Set from THIS handoff's customer, never left over from a previously-opened one —
            // carrying the last customer's contact would WhatsApp a signed quote to the wrong
            // person. Intake now passes the contact it captured, so the send dialog is prefilled
            // instead of making staff retype a number off the customer's card.
            customerEmail = h.customerEmail, customerPhone = h.customerPhone,
            sendBusy = false, sendDone = null, sendError = null,
        )
    }

    /** Same reason as the jobs board: the roster must be re-read, not cached for the session. */
    fun loadTechnicians() {
        viewModelScope.launch {
            runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } }
        }
    }

    fun loadQuotes() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchQuotes() }
                .onSuccess { q -> _s.update { it.copy(loading = false, quotes = q) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    /**
     * The working list: quotes whose car has been delivered are done and drop out — but a
     * search still finds them, so nothing is ever locked away, just out of the way.
     */
    fun filteredQuotes(s: QuoteState): List<QuoteRowDto> {
        val q = s.listQuery.trim()
        return if (q.isEmpty()) s.quotes.filterNot { it.isRetired() } else s.quotes.filter { it.matches(q) }
    }

    /** How many delivered quotes the empty search bar is hiding — shown as a hint on the list. */
    fun retiredCount(s: QuoteState): Int = s.quotes.count { it.isRetired() }

    fun setListQuery(q: String) = _s.update { it.copy(listQuery = q) }

    /** Does this product match the Products / Services toggle? */
    private fun QuoteState.kindMatch(p: ProductEntity) = when (kindFilter) {
        KindFilter.ALL -> true
        KindFilter.SERVICES -> p.kind == "service"
        KindFilter.PRODUCTS -> p.kind != "service"
    }

    /**
     * The category rail — the same one Checkout browses, because it is the same catalogue.
     * ("All" always survives the rail's own search, so there is always a way back out.)
     * The Products / Services split lives in a toggle above the rail now, not as a pinned
     * pseudo-category — a detailing quote usually starts with the WORK.
     */
    fun tabs(s: QuoteState): List<String> {
        val q = s.catQuery.trim()
        // Categories present in the current toggle (Products / Services / All) — so the
        // Services view doesn't list a wall of product-only categories all reading "0".
        val cats = s.products.filter { s.kindMatch(it) }.mapNotNull { it.category }.distinct().sorted()
            .filter { q.isEmpty() || it.contains(q, ignoreCase = true) }
        return listOf("All") + cats
    }

    /** Counts reflect the current toggle, so "CAR WASH EXPERTS 12" means 12 *services* there. */
    fun catCounts(s: QuoteState): Map<String, Int> {
        val inKind = s.products.filter { s.kindMatch(it) }
        return inKind.mapNotNull { it.category }.groupingBy { it }.eachCount() + ("All" to inKind.size)
    }

    fun filteredProducts(s: QuoteState): List<ProductEntity> {
        val q = s.query.trim()
        return s.products
            .filter { s.kindMatch(it) }
            .filter { s.tab == "All" || it.category == s.tab }
            .filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.barcode?.contains(q) == true }
    }

    fun setTab(t: String) = _s.update { it.copy(tab = t) }
    // Reset the category to "All": the old selection may not exist under the new toggle
    // (e.g. "AMPLIFIER" has no services), which would leave an empty grid and no highlight.
    fun setKindFilter(k: KindFilter) = _s.update { it.copy(kindFilter = k, tab = "All") }
    fun setQuery(q: String) = _s.update { it.copy(query = q) }
    fun setCatQuery(q: String) = _s.update { it.copy(catQuery = q) }

    // ── standalone quote ──────────────────────────────────────────────────────
    /** Start a quote with no intake behind it: pick the customer, then the car. */
    fun newQuote() = _s.update {
        it.copy(
            mode = QuoteMode.BUILDER, quoteId = null, ref = "New quote", status = "draft",
            who = "", vehPlate = null, veh = "", customerId = null, vehicleId = null,
            lines = emptyList(), acceptOpen = false, crew = emptyList(), startAt = null,
            estimateMinutes = null, depositCents = 0, depositMode = DiscountMode.PCT,
            depositAmtText = "", depositPending = false,
            basketMode = DiscountMode.PCT, basketText = "", query = "",
            savedRef = null, createdJobId = null, createdInvoiceRef = null, error = null,
            intake = null, jobId = null, hasIntake = false, signed = false, billed = false,
            customerEmail = null, customerPhone = null, sendBusy = false, sendDone = null, sendError = null,
            pickerOpen = true, pickQuery = "", pickResults = emptyList(), pickVehicles = emptyList(),
        )
    }

    private var pickJob: kotlinx.coroutines.Job? = null
    private var allCustomers: List<mu.carfection.pos.core.database.CustomerEntity> = emptyList()

    /** Same rule as intake: cache first, then the server, so a new customer is findable. */
    fun setPickQuery(q: String) {
        val query = q.trim().lowercase()
        val local = if (query.isBlank()) emptyList()
        else allCustomers.filter { it.name.lowercase().contains(query) || (it.phone ?: "").contains(query) }.take(6)
        _s.update { it.copy(pickQuery = q, pickResults = local, pickSearching = query.length >= 2 && local.isEmpty()) }
        pickJob?.cancel()
        if (query.length < 2) return
        pickJob = viewModelScope.launch {
            kotlinx.coroutines.delay(250)
            val remote = api.searchCustomers(query) + api.searchCustomersByPlate(query)
            val seen = local.map { it.id }.toMutableSet()
            val merged = local + remote.filter { seen.add(it.id) }
                .map { mu.carfection.pos.core.database.CustomerEntity(it.id, it.name, it.phone) }
            if (_s.value.pickQuery.trim().lowercase() == query) {
                _s.update { it.copy(pickResults = merged.take(8), pickSearching = false) }
            }
        }
    }

    fun pickQuoteCustomer(c: mu.carfection.pos.core.database.CustomerEntity) {
        _s.update {
            it.copy(
                customerId = c.id, who = c.name, customerPhone = c.phone,
                // The car MUST go with the customer. Changing who a draft is for while leaving
                // the previous customer's vehicle attached would save one person's quote against
                // another person's car — the same wrong-record failure that stranded a live job.
                vehicleId = null, vehPlate = null, veh = "",
                pickVehicles = emptyList(), pickResults = emptyList(), pickQuery = "",
            )
        }
        viewModelScope.launch {
            runCatching { api.fetchVehicles(c.id) }.onSuccess { vs -> _s.update { it.copy(pickVehicles = vs) } }
        }
    }

    /** A car is optional — plenty of quotes are for a customer before a car is nominated. */
    fun pickQuoteVehicle(v: mu.carfection.pos.core.network.VehicleDto?) = _s.update {
        it.copy(
            vehicleId = v?.id, vehPlate = v?.plate,
            veh = listOfNotNull(v?.make, v?.model).joinToString(" "),
            pickerOpen = false,
        )
    }

    /** Send (or re-send) a saved quotation, any time after it was raised. */
    fun openSend() = _s.update { it.copy(sendOpen = true, sendDone = null, sendError = null) }
    fun closeSend() = _s.update { it.copy(sendOpen = false, sendDone = null, sendError = null) }

    fun closePicker() = _s.update { it.copy(pickerOpen = false) }

    /** Step back to the customer list — the picked one was the wrong same-named record. */
    fun clearPickedCustomer() = _s.update {
        it.copy(customerId = null, who = "", customerPhone = null, vehicleId = null, vehPlate = null, veh = "",
            pickVehicles = emptyList(), pickResults = emptyList(), pickQuery = "")
    }
    fun reopenPicker() = _s.update { it.copy(pickerOpen = true, pickQuery = "", pickResults = emptyList()) }

    fun openQuote(q: QuoteRowDto) {
        _s.update {
            it.copy(
                mode = QuoteMode.BUILDER, quoteId = q.id, ref = q.number ?: "Draft", status = q.status,
                who = q.customers?.name ?: "—", vehPlate = q.vehicles?.plate,
                customerEmail = q.customers?.email, customerPhone = q.customers?.phone,
                veh = listOfNotNull(q.vehicles?.make, q.vehicles?.model).joinToString(" "),
                customerId = q.customerId, vehicleId = q.vehicleId,
                // The saved order discount comes back into the basket controls.
                basketMode = if (q.discountKind == "amount") DiscountMode.AMT else DiscountMode.PCT,
                basketText = when {
                    q.discountKind == "amount" && q.discountValue > 0 -> centsToPlainText(rupeesToCents(q.discountValue))
                    q.discountKind == "percent" && q.discountValue > 0 -> q.discountValue.toInt().toString()
                    else -> ""
                },
                // Clear any latched reception handoff — it belongs to a different, freshly-started
                // quote, not this existing one; otherwise its markers/photos land on the wrong job.
                // jobId carries the linked job (set once converted) so the builder shows "View job".
                lines = emptyList(), acceptOpen = false, crew = emptyList(), startAt = null, savedRef = null, createdJobId = null, error = null, intake = null, jobId = q.jobId, query = "",
                // Don't inherit the last quote's deposit/estimate into this one (audit #7).
                estimateMinutes = null, depositCents = 0, depositMode = DiscountMode.PCT, depositAmtText = "", depositPending = false,
                sendBusy = false, sendDone = null, sendError = null, // clear a prior quote's send state
                linesLoaded = false, // becomes true only when the lines actually load
                hasIntake = q.intake != null && q.intake !is kotlinx.serialization.json.JsonNull,
                signed = q.acceptedSignature != null && q.acceptedSignature !is kotlinx.serialization.json.JsonNull,
                billed = q.invoices.any { it.docType == "invoice" && it.status != "void" },
            )
        }
        viewModelScope.launch {
            runCatching { api.fetchQuoteLines(q.id) }
                .onSuccess { ls ->
                    _s.update { st ->
                        st.copy(linesLoaded = true, lines = ls.map {
                            QuoteLine(
                                productId = it.productId, title = it.title,
                                priceText = centsToPlainText(
                                    rupeesToCents(it.unitPrice).let { net -> if (st.pricesInclVat) grossCents(net, it.vatRate) else net },
                                ),
                                priceIsGross = st.pricesInclVat,
                                vatRate = it.vatRate, qty = it.qty.toInt().coerceAtLeast(1),
                                discountMode = if (it.discountKind == "amount") DiscountMode.AMT else DiscountMode.PCT,
                                discountPct = it.discountPct.toInt(),
                                discountAmtText = if (it.discountKind == "amount" && it.discountAmount > 0) centsToPlainText(rupeesToCents(it.discountAmount)) else "",
                                lineKind = it.lineKind,
                            )
                        })
                    }
                }
                .onFailure { e -> _s.update { it.copy(error = "Couldn't load the quote's items — reopen it before saving. (${e.uiMessage()})") } }
        }
    }

    /**
     * Leave the builder for the list.
     *
     * Every builder-owned dialog closes with it. The picker is mounted on the screen, not
     * inside the builder branch, so returning to the list while it was open left it sitting
     * over the list — Cancel appeared to do nothing at all, because the thing it dismissed was
     * still on screen. The rest are here so no builder modal can outlive the quote it belongs to.
     */
    fun back() {
        _s.update {
            it.copy(
                mode = QuoteMode.LIST,
                pickerOpen = false, confirmDelete = false, sendOpen = false,
                adhocOpen = false, acceptOpen = false,
                datePickerOpen = false, timePickerOpen = false,
                // busy belongs to work that was happening IN the builder. Carrying it out left
                // every control gated on !busy dead for the life of the screen — Back, Continue
                // to signature, Save draft, all of it — with nothing on screen explaining why.
                // Cleared here rather than in each caller, so no future one can strand it.
                busy = false,
                error = null,
            )
        }
        loadQuotes()
    }

    /**
     * Only a draft can be changed. Once a quote is issued the customer has been shown a
     * price, and once accepted they have signed it — save_draft refuses either, so every
     * keystroke past that point was work the operator would silently lose. Editing is
     * closed here instead, and "Revise" opens a fresh draft to change.
     */
    fun editable(s: QuoteState): Boolean = s.status == "draft"

    fun addProduct(p: ProductEntity) = _s.update { st ->
        if (!editable(st)) return@update st
        val i = st.lines.indexOfFirst { it.productId == p.id }
        val lines = if (i >= 0) st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = l.qty + 1) else l }
        else st.lines + quoteLine(p.id, p.name, p.sellingPriceCents, p.vatRatePct, gross = st.pricesInclVat)
        st.copy(lines = lines)
    }

    fun openAdhoc() = _s.update { if (editable(it)) it.copy(adhocOpen = true) else it }
    fun closeAdhoc() = _s.update { it.copy(adhocOpen = false) }
    /** [isService] is asked for every time: work on a car sends the accepted quote to the
     *  board, goods over the counter do not, and a typed-in line has no product to ask. */
    fun addAdhoc(name: String, priceCents: Long, vatRate: Double = 15.0, isService: Boolean = true) = _s.update { st ->
        if (!editable(st)) return@update st.copy(adhocOpen = false)
        if (name.isBlank() || priceCents <= 0) st.copy(adhocOpen = false)
        // priceCents is what was TYPED — already the shelf price when the shop quotes gross.
        else st.copy(
            adhocOpen = false,
            lines = st.lines + QuoteLine(
                null, name.trim(), centsToPlainText(priceCents), vatRate,
                priceIsGross = st.pricesInclVat, lineKind = if (isService) "service" else "product",
            ),
        )
    }

    /** Gross (pre-discount) subtotal in cents, for the "Subtotal" display row. */
    fun grossCents(s: QuoteState): Long = s.lines.sumOf { it.qty * it.unitCents }

    fun toggleLine(i: Int) = _s.update { st -> if (!editable(st)) st else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(expanded = !l.expanded) else l.copy(expanded = false) }) }
    fun setQty(i: Int, q: Int) = _s.update { st -> if (!editable(st)) st else if (q <= 0) st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = q) else l }) }
    fun setDiscount(i: Int, d: Int) = _s.update { st -> if (!editable(st)) st else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountPct = d) else l }) }
    fun removeLine(i: Int) = _s.update { st -> if (!editable(st)) st else st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) }

    /**
     * Change an issued or accepted quote: a NEW draft carrying its lines and discount,
     * linked back to it. The original is never rewritten — a signed price the customer
     * agreed to must still read, next year, exactly as they agreed it.
     */
    fun reviseQuote() {
        val s = _s.value
        val id = s.quoteId ?: return
        if (editable(s) || s.busy) return
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val rev = api.reviseQuote(id)
                // Re-read the list so the new draft arrives with its customer, vehicle and
                // number attached — the RPC hands back the row, not the joins the builder needs.
                val quotes = api.fetchQuotes()
                rev.id to quotes
            }.onSuccess { (newId, quotes) ->
                _s.update { it.copy(busy = false, quotes = quotes) }
                quotes.firstOrNull { it.id == newId }?.let { openQuote(it) }
                    ?: _s.update { it.copy(error = "The revision was created — reopen it from the list.") }
            }.onFailure { e ->
                _s.update { it.copy(busy = false, error = e.uiMessage("Couldn’t start a revision")) }
            }
        }
    }

    // ── price + Rs-discount editing (raw text lives on the line; cents derived) ──
    private fun moneyText(t: String) = t.filter { it.isDigit() || it == '.' }
    fun setPrice(i: Int, t: String) = _s.update { st -> if (!editable(st)) st else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(priceText = moneyText(t)) else l }) }
    fun setLineDiscMode(i: Int, m: DiscountMode) = _s.update { st -> if (!editable(st)) st else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountMode = m) else l }) }
    fun setLineDiscAmt(i: Int, t: String) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountAmtText = moneyText(t)) else l }) }

    // ── basket (order-level) discount ────────────────────────────────────────────
    fun setBasketMode(m: DiscountMode) = _s.update { if (!editable(it)) it else it.copy(basketMode = m, basketText = "") }
    fun setBasketText(t: String) = _s.update { if (!editable(it)) it else it.copy(basketText = if (it.basketMode == DiscountMode.PCT) t.filter { c -> c.isDigit() } else moneyText(t)) }

    private fun basketPct(s: QuoteState): Int = if (s.basketMode == DiscountMode.PCT) (s.basketText.toIntOrNull() ?: 0).coerceIn(0, 100) else 0
    private fun basketAmtCents(s: QuoteState): Long = if (s.basketMode == DiscountMode.AMT) (parseMoneyToCents(s.basketText) ?: 0L).coerceAtLeast(0) else 0
    private fun docDiscountKind(s: QuoteState): String? = when {
        s.basketMode == DiscountMode.AMT && basketAmtCents(s) > 0 -> "amount"
        s.basketMode == DiscountMode.PCT && basketPct(s) > 0 -> "percent"
        else -> null
    }
    private fun docDiscountValue(s: QuoteState): Double = when (docDiscountKind(s)) {
        "percent" -> basketPct(s).toDouble()
        "amount" -> centsToRupees(basketAmtCents(s))
        else -> 0.0
    }

    fun totals(s: QuoteState): DocDiscountTotals = computeDocTotals(
        s.lines.map {
            DocLineIn(
                qty = it.qty.toDouble(), unitCents = it.unitCents,
                discountKind = if (it.discountMode == DiscountMode.AMT) "amount" else "percent",
                discountPct = it.discountPct.toDouble(),
                discountAmtInclCents = if (it.discountMode == DiscountMode.AMT) it.discountAmtCents else 0L,
                vatRatePct = it.vatRate,
            )
        },
        orderKind = docDiscountKind(s), orderPct = basketPct(s).toDouble(), orderAmtInclCents = basketAmtCents(s),
    )

    // Turning it off drops any crew already picked — accept_quote has nowhere to put them,
    // and the picker itself is hidden while this is off, so a stale pick could only survive
    // by the operator flipping it back on, which would make it look kept when it never was.
    fun setStartJobNow(v: Boolean) = _s.update { it.copy(startJobNow = v, crew = if (v) it.crew else emptyList()) }

    fun toggleNewVeh(open: Boolean) = _s.update {
        it.copy(newVehOpen = open, newVehPlate = "", newVehMake = "", newVehModel = "", error = null)
    }
    fun setNewVehPlate(v: String) = _s.update { it.copy(newVehPlate = v) }
    fun setNewVehMake(v: String) = _s.update { it.copy(newVehMake = v) }
    fun setNewVehModel(v: String) = _s.update { it.copy(newVehModel = v) }

    /** Register the car and put the quote straight onto it. */
    fun saveNewVehicle() {
        val st = _s.value
        val plate = st.newVehPlate.trim()
        val cust = st.customerId ?: return
        if (plate.isBlank()) { _s.update { it.copy(error = "Enter a plate") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("Not synced — pull the catalogue first")
                api.insertVehicle(
                    mu.carfection.pos.core.network.NewVehicleDto(
                        tenant, cust, plate,
                        st.newVehMake.trim().ifBlank { null },
                        st.newVehModel.trim().ifBlank { null },
                    ),
                )
            }.onSuccess { v ->
                _s.update { it.copy(busy = false, newVehOpen = false, pickVehicles = it.pickVehicles + v) }
                pickQuoteVehicle(v)
            }.onFailure { e ->
                // Name the holder rather than dead-ending on "already exists" — that is what
                // drove staff to invent placeholder plates in the first place.
                val dup = (e.message ?: "").contains("duplicate", true) || (e.message ?: "").contains("plate", true)
                val owner = if (dup) api.vehicleOwnerByPlate(plate) else null
                _s.update {
                    it.copy(
                        busy = false,
                        error = when {
                            owner != null -> "$plate is already on $owner's card."
                            dup -> "$plate is already registered to another customer."
                            else -> e.uiMessage()
                        },
                    )
                }
            }
        }
    }

    fun toggleNewCust(open: Boolean) = _s.update {
        // Seed the name from whatever they already typed in the search box — they have just
        // told us who they are looking for.
        it.copy(newCustOpen = open, newCustName = if (open) it.pickQuery.trim() else "", newCustPhone = "", error = null)
    }
    fun setNewCustName(v: String) = _s.update { it.copy(newCustName = v) }
    fun setNewCustPhone(v: String) = _s.update { it.copy(newCustPhone = v) }

    /**
     * Create the customer and carry straight on to their car — the point is to not leave the
     * quote. The phone is captured here so the WhatsApp field is prefilled when it is sent.
     */
    fun saveNewCustomer(force: Boolean = false) {
        val st = _s.value
        val name = st.newCustName.trim()
        if (name.isBlank()) { _s.update { it.copy(error = "Enter a name") }; return }
        // Same guard Intake has: nothing in the schema stops a second copy of a person, and a
        // duplicate here is how a quote ends up on a record that holds none of the history.
        if (!force) {
            _s.update { it.copy(busy = true, error = null) }
            viewModelScope.launch {
                val hit = api.findExistingCustomer(name, st.newCustPhone.trim().ifBlank { null })
                if (hit != null) {
                    val entity = mu.carfection.pos.core.database.CustomerEntity(hit.id, hit.name, hit.phone)
                    runCatching { catalog.cacheCustomer(entity) }
                    _s.update { it.copy(busy = false, newCustOpen = false, newCustName = "", newCustPhone = "") }
                    pickQuoteCustomer(entity)
                } else {
                    _s.update { it.copy(busy = false) }
                    saveNewCustomer(force = true)
                }
            }
            return
        }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("Not synced — pull the catalogue first")
                api.insertCustomer(
                    mu.carfection.pos.core.network.NewCustomerDto(
                        tenantId = tenant, name = name,
                        phone = st.newCustPhone.trim().ifBlank { null },
                    ),
                )
            }.onSuccess { c ->
                val entity = mu.carfection.pos.core.database.CustomerEntity(c.id, c.name, c.phone)
                // Into the local cache too, so the very next search finds them instead of
                // inviting whoever is standing there to create them a second time.
                runCatching { catalog.cacheCustomer(entity) }
                _s.update { it.copy(busy = false, newCustOpen = false, newCustName = "", newCustPhone = "") }
                pickQuoteCustomer(entity)
            }.onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /**
     * The customer signed a while back and has now brought the car in.
     *
     * Converts the SAME quote they agreed to, so the price, the lines and the signature are the
     * ones on record. The RPC is idempotent — a second tap returns the same job rather than
     * putting the car on the board twice.
     */
    /** Void a signed quote the customer never returned for. Retires it from the list. */
    fun voidThisQuote() {
        val id = _s.value.quoteId ?: return
        if (_s.value.busy) return
        _s.update { it.copy(busy = true, error = null, confirmDelete = false) }
        viewModelScope.launch {
            runCatching { api.voidQuote(id) }
                .onSuccess { _s.update { it.copy(busy = false) }; back() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    fun createJobFromQuote() {
        val id = _s.value.quoteId ?: return
        if (_s.value.busy) return
        val crew = _s.value.crew
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching { api.convertQuoteToJob(id, crew.firstOrNull()) }
                .onSuccess { jobId ->
                    // convertQuoteToJob only sets the LEAD; the rest of the crew rides in
                    // job_technicians the same way the accept-and-start-now path attaches them —
                    // otherwise picking a crew here silently drops everyone but the first.
                    catalog.tenantId()?.let { tenant ->
                        crew.drop(1).forEach { uid -> runCatching { api.addJobTechnician(tenant, jobId, uid) } }
                    }
                    _s.update { it.copy(busy = false, jobId = jobId, createdJobId = jobId) }
                    loadQuotes()
                }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /**
     * Does this quote have WORK on it?
     *
     * Work on a car goes to the jobs board; goods over the counter are a sale and belong
     * nowhere near the bays. A typed-in line states which it is (the ad-hoc sheet asks
     * every time); a catalogue line is answered by its product. A line that states
     * neither is read as work — that is what ad-hoc lines were before the sheet asked,
     * and the same fallback the database uses. It errs towards a job on purpose: a job
     * card raised in error is dismissed in one tap, whereas work with no card is work
     * nobody is tracking.
     */
    fun hasService(s: QuoteState): Boolean = s.lines.any { l ->
        (l.lineKind ?: s.products.firstOrNull { it.id == l.productId }?.kind ?: "service") == "service"
    }

    // The panel opens on what the quote actually contains rather than on "yes" every time.
    // Still a toggle: a service quote signed today for work booked next month turns it off,
    // and the rare products-only job turns it on.
    fun openAccept() = _s.update { it.copy(acceptOpen = true, startJobNow = hasService(it)) }
    fun closeAccept() = _s.update { it.copy(acceptOpen = false) }
    /**
     * Tap a technician to put them on the job, tap again to take them off. The first one
     * picked is the lead; picking that one off promotes whoever is next, so the job always
     * has a lead as long as anyone is on it.
     */
    fun pickTech(id: String) = _s.update {
        it.copy(crew = if (id in it.crew) it.crew - id else it.crew + id)
    }

    // ── when the car is booked in for ────────────────────────────────────────────
    // startAt == null means "start now". Picking a date keeps the time already chosen
    // (or the next half-hour); picking a time keeps the date (or today).
    fun openDatePicker() = _s.update { it.copy(datePickerOpen = true) }
    fun openTimePicker() = _s.update { it.copy(timePickerOpen = true) }
    fun closePickers() = _s.update { it.copy(datePickerOpen = false, timePickerOpen = false) }
    fun startNow() = _s.update { it.copy(startAt = null, datePickerOpen = false, timePickerOpen = false) }

    /** How long the work should take. Null clears it — "we don't know yet" is a real answer. */
    fun pickEstimate(minutes: Int?) = _s.update { it.copy(estimateMinutes = minutes) }

    // ── days + hours estimate picker ──────────────────────────────────────────────
    fun estimateDays(s: QuoteState): Int = (s.estimateMinutes ?: 0) / 1440
    fun estimateHours(s: QuoteState): Int = ((s.estimateMinutes ?: 0) % 1440) / 60

    /** Set the estimate from a days + hours pick. 0/0 clears it. Capped at the DB's 30 days. */
    fun setEstimate(days: Int, hours: Int) = _s.update {
        val mins = (days.coerceIn(0, 30) * 1440) + (hours.coerceIn(0, 23) * 60)
        it.copy(estimateMinutes = if (mins <= 0) null else mins.coerceAtMost(43200))
    }
    fun bumpEstimateDays(s: QuoteState, delta: Int) = setEstimate(estimateDays(s) + delta, estimateHours(s))
    fun bumpEstimateHours(s: QuoteState, delta: Int) = setEstimate(estimateDays(s), estimateHours(s) + delta)

    /**
     * What the customer leaves on signing. Tapping the chosen share again clears it — no
     * deposit is the normal case, and the shop must never be nudged into asking for one.
     */
    fun pickDepositPct(pct: Int?) = _s.update { st ->
        if (pct == null) st.copy(depositCents = 0)
        else st.copy(depositCents = (totals(st).totalCents * pct / 100) / 100 * 100)
    }

    /** Switch the deposit input between % chips and a typed Rs amount; clears the current pick. */
    fun setDepositMode(m: DiscountMode) = _s.update { it.copy(depositMode = m, depositAmtText = "", depositCents = 0) }

    /** A typed Rs deposit — the amount is the source of truth, clamped to the bill total. */
    fun setDepositAmtText(t: String) = _s.update { st ->
        val txt = moneyText(t)
        val cents = (parseMoneyToCents(txt) ?: 0L).coerceIn(0L, totals(st).totalCents)
        st.copy(depositAmtText = txt, depositCents = cents)
    }

    /** The share of the total this deposit represents, for highlighting the chip that set it. */
    fun depositPct(s: QuoteState): Int? {
        val total = totals(s).totalCents
        if (s.depositCents <= 0 || total <= 0) return null
        return DEPOSIT_CHOICES.firstOrNull { (total * it / 100) / 100 * 100 == s.depositCents }
    }

    companion object {
        /** A wash to a full day's ceramic — the shop's real spread of jobs. */
        val ESTIMATE_CHOICES = listOf(30, 60, 120, 240, 480)

        /** The splits a detailing shop actually asks for on signing. */
        val DEPOSIT_CHOICES = listOf(25, 50, 75)

        /** 90 → "1h 30m"; 1560 → "1d 2h". Spoken in days/hours, never "ninety minutes". */
        fun estimateLabel(minutes: Int): String {
            val d = minutes / 1440
            val h = (minutes % 1440) / 60
            val m = minutes % 60
            return listOfNotNull(
                if (d > 0) "${d}d" else null,
                if (h > 0) "${h}h" else null,
                if (m > 0 && d == 0) "${m}m" else null,
            ).joinToString(" ").ifEmpty { "0" }
        }
    }

    private fun currentStart(s: QuoteState): ZonedDateTime =
        s.startAt?.let { Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()) }
            ?: ZonedDateTime.now().let { it.plusMinutes((30 - it.minute % 30).toLong()).withSecond(0).withNano(0) }

    /** [utcMillis] is what the Material date picker hands back: midnight UTC on the chosen day. */
    fun pickDate(utcMillis: Long) = _s.update { s ->
        val day = Instant.ofEpochMilli(utcMillis).atZone(ZoneOffset.UTC).toLocalDate()
        val at = currentStart(s)
        s.copy(
            startAt = day.atTime(at.hour, at.minute).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
            datePickerOpen = false,
        )
    }

    fun pickTime(hour: Int, minute: Int) = _s.update { s ->
        val at = currentStart(s)
        s.copy(
            startAt = at.withHour(hour).withMinute(minute).withSecond(0).withNano(0).toInstant().toEpochMilli(),
            timePickerOpen = false,
        )
    }

    /** Labels for the two picker buttons — "Today"/"Tomorrow" read better than a bare date. */
    fun startDateLabel(s: QuoteState): String {
        val at = s.startAt?.let { Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).toLocalDate() } ?: return "Today"
        val today = LocalDate.now()
        return when (at) {
            today -> "Today"
            today.plusDays(1) -> "Tomorrow"
            else -> at.format(DateTimeFormatter.ofPattern("EEE d MMM"))
        }
    }

    fun startTimeLabel(s: QuoteState): String =
        s.startAt?.let { Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm")) } ?: "Now"

    /** What gets written to jobs.scheduled_at — the picked moment, or now. */
    private fun scheduledIso(s: QuoteState): String =
        Instant.ofEpochMilli(s.startAt ?: System.currentTimeMillis()).toString()

    /** Open the job this quote already produced on the Jobs board (a quote maps to one job). */
    fun viewJob() { _s.value.jobId?.let { openJobBus.request(it) } }

    private fun linesJson(s: QuoteState): JsonArray = buildJsonArray {
        s.lines.forEachIndexed { i, l ->
            add(buildJsonObject {
                if (l.productId != null) put("product_id", l.productId) else put("product_id", JsonNull)
                put("title", l.title)
                put("description", JsonNull)
                put("qty", l.qty)
                put("unit_price", centsToRupees(l.unitCents))
                put("discount_pct", if (l.discountMode == DiscountMode.PCT) l.discountPct else 0)
                put("discount_kind", if (l.discountMode == DiscountMode.AMT) "amount" else "percent")
                put("discount_amount", if (l.discountMode == DiscountMode.AMT) centsToRupees(l.discountAmtCents) else 0.0)
                put("vat_rate", l.vatRate)
                put("sort_order", i)
                // Only a typed-in line states one; a catalogue line leaves it to the product.
                if (l.lineKind != null) put("line_kind", l.lineKind) else put("line_kind", JsonNull)
            })
        }
    }

    fun askDelete() = _s.update { it.copy(confirmDelete = true, error = null) }
    fun cancelDelete() = _s.update { it.copy(confirmDelete = false) }

    /**
     * Discard this draft. Only ever a draft: an issued or accepted quote is a document the
     * customer has been shown, and the DB refuses to delete one regardless of what is asked.
     * An unsaved draft (no id) has nothing on the server, so it just closes.
     */
    fun deleteDraft() {
        val s = _s.value
        if (s.status != "draft") { _s.update { it.copy(confirmDelete = false, error = "Only a draft can be discarded.") }; return }
        val id = s.quoteId
        if (id == null) { _s.update { it.copy(confirmDelete = false) }; back(); return }
        _s.update { it.copy(busy = true, confirmDelete = false, error = null) }
        viewModelScope.launch {
            runCatching { api.deleteDraftDocument(id) }
                .onSuccess {
                    _s.update { it.copy(busy = false) }
                    back()
                    loadQuotes()
                }
                .onFailure { e ->
                    // Something real was raised FROM this draft — a bill, a revision, a copy —
                    // and points back at it through documents.source_document_id. Say that,
                    // rather than leaking "violates foreign key constraint …" to the shop.
                    val fk = (e.message ?: "").contains("foreign key", true) || (e.message ?: "").contains("violates", true)
                    _s.update {
                        it.copy(busy = false, error = if (fk) "Another document was raised from this quote and still refers back to it, so it can't be discarded." else e.uiMessage())
                    }
                }
        }
    }

    /**
     * Change who a DRAFT is for. The picker is the same one a standalone quote starts from, and
     * the change persists on the next save — saveQuoteDraft already sends customer_id and
     * vehicle_id. Refused on anything issued: that document has been shown to a customer.
     */
    fun changeCustomer() {
        if (_s.value.status != "draft") { _s.update { it.copy(error = "This quote is already issued — its customer can't be changed.") }; return }
        reopenPicker()
    }

    fun saveDraft() {
        val s = _s.value
        if (s.busy) return // double-tap = two inserted drafts when quoteId is null
        if (!s.linesLoaded) { _s.update { it.copy(error = "Items still loading — wait a moment, or reopen the quote.") }; return }
        val cid = s.customerId ?: run { _s.update { it.copy(error = "No customer on this quote") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching { api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s), docDiscountKind(s), docDiscountValue(s)) }
                .onSuccess { d -> _s.update { it.copy(busy = false, quoteId = d.id, savedRef = d.number ?: "Draft saved") } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /** [signaturePng] is the client's acceptance signature drawn on the pad — required by the UI. */
    fun create(signaturePng: ByteArray?) {
        val s = _s.value
        if (s.busy) return // double-tap on a fresh quote = two quotes -> two jobs
        val cid = s.customerId ?: return
        if (s.status == "draft" && !s.linesLoaded) { _s.update { it.copy(error = "Items still loading — wait a moment before accepting.") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                // The signature uploads first — if it can't be stored, nothing is accepted.
                val sigPath = signaturePng?.let {
                    val tenant = catalog.tenantId() ?: error("Not synced — pull the catalogue first")
                    api.uploadSignature(tenant, it)
                }
                // A draft gets the builder's edits persisted first. An issued/accepted
                // quote is frozen — save_draft refuses "cannot edit an issued document" —
                // so it converts as-is; the RPC is idempotent and hands back the same job.
                val quoteId =
                    if (s.status == "draft") api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s), docDiscountKind(s), docDiscountValue(s)).id
                    else s.quoteId ?: error("This quote hasn't been saved yet")
                // Signed, but the work is not starting today — no job, no card on the board.
                // "Create job" on this quote raises it whenever the customer comes back.
                if (!s.startJobNow) {
                    api.acceptQuoteOnly(quoteId, sigPath, s.who.takeUnless { it.isBlank() || it == "—" })
                    // Finish the job the success path below would have done. Returning early
                    // from runCatching skips it entirely, which left busy stuck true — every
                    // control gated on it then read "Saving…"/"Working…" for ever, with the
                    // quote actually accepted on the server and no way to tell from the screen.
                    _s.update {
                        it.copy(
                            busy = false, quoteId = quoteId, status = "accepted",
                            acceptOpen = false, intake = null, signed = sigPath != null,
                            jobId = null, createdJobId = null, depositPending = false,
                            sendBusy = false, sendDone = null, sendError = null,
                        )
                    }
                    loadQuotes()
                    return@runCatching Triple(quoteId, null, null)
                }
                val jobId = api.convertQuoteToJob(quoteId, s.crew.firstOrNull(), signaturePath = sigPath, signedName = s.who.takeUnless { it.isBlank() || it == "—" })
                // Book the car in, with how long it should take. Safe to retry: the conversion
                // is idempotent, so a failed schedule write simply re-runs against the same job.
                api.setJobSchedule(jobId, scheduledIso(s), s.estimateMinutes)

                // convert_quote_to_job set the LEAD; everyone else picked on the accept panel
                // goes into job_technicians. Best-effort per person: a crew member failing to
                // attach must not fail an accepted quote that already has its job.
                catalog.tenantId()?.let { tenant ->
                    s.crew.drop(1).forEach { uid ->
                        runCatching { api.addJobTechnician(tenant, jobId, uid) }
                    }
                }

                // A deposit is money against a bill, and the bill is this quote. Raise it now so
                // there is something to pay into; the customer then settles the balance when they
                // collect the car. The money itself is NOT taken here — the pad takes it, with the
                // cash in hand, and the cashier can still change the figure.
                val depositInvoice = if (s.depositCents > 0) {
                    runCatching {
                        val inv = api.convertQuoteToInvoice(quoteId)
                        if (inv.status == null || inv.status == "draft") api.issueDocument(inv.id, "inv:${inv.id}")
                        inv.id
                    }.getOrNull()
                } else null

                Triple(quoteId, jobId, depositInvoice)
            }.onSuccess { (quoteId, jobId, depositInvoice) ->
                // Stamp what reception recorded onto the new job — best-effort; the
                // job exists either way and the board still opens it.
                // Only when a job was actually created. Accepting without starting the work
                // leaves the condition record on the quote; it lands on the job when one is
                // raised later.
                val stampOn = jobId
                if (stampOn != null) s.intake?.let { h ->
                    viewModelScope.launch {
                        if (h.markerCount > 0) runCatching { api.setJobDamageMarkers(stampOn, h.markers) }
                        h.photoPaths.forEach { p ->
                            runCatching {
                                val tenant = catalog.tenantId() ?: return@runCatching
                                api.insertJobPhotoRecord(tenant, stampOn, p, "before")
                            }
                        }
                    }
                }
                // Hand the bill to Checkout with the deposit already dialled in. The cashier
                // still presses the button — the customer's money is theirs to take, not ours.
                // On a quotation tablet there is no Checkout: the invoice is raised all the
                // same and waits in TO COLLECT on the paying till.
                if (_s.value.takesPayments) depositInvoice?.let { collectBus.request(it, _s.value.depositCents) }

                // signed = true: the tablet's accept flow requires the client's signature.
                _s.update {
                    it.copy(
                        busy = false, quoteId = quoteId, status = "accepted", createdJobId = jobId, jobId = jobId,
                        acceptOpen = false, intake = null, signed = true,
                        sendBusy = false, sendDone = null, sendError = null,
                        depositPending = depositInvoice != null,
                    )
                }
            }.onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /** Bill the quote now: persist it, copy into a draft invoice, then issue for gapless INV#. */
    fun convertToInvoice() {
        val s = _s.value
        if (s.busy) return // double-tap on a fresh quote = two quotes -> two invoices
        val cid = s.customerId ?: run { _s.update { it.copy(error = "No customer on this quote") }; return }
        if (s.lines.isEmpty()) { _s.update { it.copy(error = "Add a line before billing") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                // same freeze rule as accept: only drafts can be re-saved
                val quoteId =
                    if (s.status == "draft") api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s), docDiscountKind(s), docDiscountValue(s)).id
                    else s.quoteId ?: error("This quote hasn't been saved yet")
                val draft = api.convertQuoteToInvoice(quoteId)
                // Keyed on the document, not the quote: a voided bill must be re-issuable,
                // and a key spent on the void one would refuse its replacement forever.
                // One already issued (by the board, say) is handed back as it stands.
                if (draft.status == null || draft.status == "draft") api.issueDocument(draft.id, "inv:${draft.id}").number
                else draft.number
                // Raising the bill accepts the quote on the server too (convert_quote_to_invoice,
                // 20260804000010) — carry that here, or the screen keeps offering to re-save and
                // re-bill a draft the server no longer has.
            }.onSuccess { n -> _s.update { it.copy(busy = false, acceptOpen = false, status = "accepted", billed = true, createdInvoiceRef = n ?: "Invoice issued") } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    fun clearToast() = _s.update { it.copy(savedRef = null, createdJobId = null, createdInvoiceRef = null, sendDone = null, sendError = null, sendBusy = false) }

    /** "Send to customer": the Worker renders the quotation PDF and delivers it by
     *  [channel] ("email" | "whatsapp").
     *
     *  A DRAFT can be sent — that is the point of a quotation. The customer has to
     *  read a price before they can agree to one, so the server issues the draft on
     *  the way out and hands back the number it was given. Sending does NOT accept
     *  it: the signature pad still does that.
     *
     *  An unsaved builder saves first, exactly as [create] does, so Send and Accept
     *  behave alike from a fresh quote. */
    fun sendToCustomer(channel: String, to: String, note: String = "") {
        val s = _s.value
        if (to.isBlank() || s.sendBusy) return
        val cid = s.customerId ?: run { _s.update { it.copy(sendError = "No customer on this quote") }; return }
        if (s.quoteId == null && !s.linesLoaded) { _s.update { it.copy(sendError = "Items still loading — wait a moment.") }; return }
        if (s.quoteId == null && s.lines.isEmpty()) { _s.update { it.copy(sendError = "Add a line before sending.") }; return }
        _s.update { it.copy(sendBusy = true, sendError = null, sendDone = null) }
        viewModelScope.launch {
            val saved = runCatching {
                if (s.status == "draft") api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s), docDiscountKind(s), docDiscountValue(s)).id
                else s.quoteId ?: error("This quote hasn't been saved yet")
            }.getOrElse { e ->
                _s.update { it.copy(sendBusy = false, sendError = e.uiMessage()) }
                return@launch
            }
            val out = runCatching { sendApi.send(saved, channel, to.trim(), note.trim().take(300), session.deviceId()) }
                .getOrElse { SendOutcome(it.message ?: "Network error") }
            _s.update { cur ->
                // A late result must not stamp a DIFFERENT quote's dialog (the
                // operator may have dismissed and accepted another quote meanwhile).
                if (cur.quoteId != null && cur.quoteId != saved) cur
                else if (out.error == null) cur.copy(
                    sendBusy = false,
                    quoteId = saved,
                    sendDone = if (channel == "email") "Sent by email ✓" else "Sent on WhatsApp ✓",
                    // The send issued it: drop the DRAFT chip and show the number, or the
                    // builder stays editable over a quote the server has already frozen.
                    status = out.issuedStatus ?: cur.status,
                    ref = out.issuedNumber ?: cur.ref,
                    // remember what worked so re-opening prefills the corrected value
                    customerEmail = if (channel == "email") to.trim() else cur.customerEmail,
                    customerPhone = if (channel == "whatsapp") to.trim() else cur.customerPhone,
                ) else cur.copy(sendBusy = false, sendError = out.error, quoteId = saved)
            }
            if (out.error == null && out.issuedNumber != null) loadQuotes()
        }
    }
}
