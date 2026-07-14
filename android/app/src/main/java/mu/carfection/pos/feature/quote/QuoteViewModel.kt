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
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.QuoteRowDto
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
) {
    val unitCents: Long get() = (parseMoneyToCents(priceText) ?: 0L).coerceAtLeast(0)
    val discountAmtCents: Long get() = (parseMoneyToCents(discountAmtText) ?: 0L).coerceAtLeast(0)
}

/** A line at a given price in cents — keeps the constructor call sites readable. */
fun quoteLine(productId: String?, title: String, unitCents: Long, vatRate: Double, qty: Int = 1): QuoteLine =
    QuoteLine(productId, title, centsToPlainText(unitCents), vatRate, qty)

data class QuoteState(
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
    val tab: String = "All", // the selected CATEGORY (same rail as Checkout)
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
    val techId: String? = null,
    // When the car is booked in for. null = start now; otherwise the picked date+time.
    val startAt: Long? = null,
    // How long the work should take. Null = nobody said; the board then shows no ETA
    // rather than inventing one.
    val estimateMinutes: Int? = null,
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
    val sendBusy: Boolean = false,
    val sendDone: String? = null,
    val sendError: String? = null,
    // False while an existing quote's lines are (re)loading or failed to load —
    // guards Save/Accept from persisting an empty basket over the real lines.
    val linesLoaded: Boolean = true,
)

/** A quote whose car has already been handed over is finished business — off the working list. */
private fun QuoteRowDto.isDelivered(): Boolean = job?.status == "delivered"

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
    private val sendApi: mu.carfection.pos.core.network.DocumentSendApi,
) : ViewModel() {
    private val _s = MutableStateFlow(QuoteState())
    val state = _s.asStateFlow()

    init {
        viewModelScope.launch { catalog.products.collect { p -> _s.update { it.copy(products = p) } } }
        loadQuotes()
        viewModelScope.launch { runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } } }
        // Reception hands over a customer+vehicle (+condition) — open a fresh builder on it.
        viewModelScope.launch {
            intakeBus.pending.collect { h -> if (h != null) { intakeBus.consume(); beginFromIntake(h) } }
        }
        // Activity-scoped: drop one operator's in-progress builder (customer, lines, accept panel)
        // when they sign out, so the next operator can't issue against a stranger's draft.
        viewModelScope.launch {
            session.isLoggedIn.collect {
                if (it == false) _s.value = QuoteState(products = _s.value.products, technicians = _s.value.technicians)
            }
        }
    }

    private fun beginFromIntake(h: IntakeHandoff) = _s.update {
        it.copy(
            mode = QuoteMode.BUILDER, quoteId = null, ref = "New quote", status = "draft",
            who = h.customerName, vehPlate = h.plate, veh = h.vehLabel,
            customerId = h.customerId, vehicleId = h.vehicleId,
            lines = emptyList(), acceptOpen = false, techId = null, startAt = null,
            basketMode = DiscountMode.PCT, basketText = "", query = "",
            savedRef = null, createdJobId = null, createdInvoiceRef = null, error = null,
            intake = h, jobId = null,
            hasIntake = true, signed = false, billed = false,
            // Never carry a previously-opened customer's contact into this fresh
            // quote's send dialog — that would email/WhatsApp the signed quote to
            // the wrong person. Intake carries no contact; the operator fills it.
            customerEmail = null, customerPhone = null, sendBusy = false, sendDone = null, sendError = null,
        )
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
        return if (q.isEmpty()) s.quotes.filterNot { it.isDelivered() } else s.quotes.filter { it.matches(q) }
    }

    /** How many delivered quotes the empty search bar is hiding — shown as a hint on the list. */
    fun retiredCount(s: QuoteState): Int = s.quotes.count { it.isDelivered() }

    fun setListQuery(q: String) = _s.update { it.copy(listQuery = q) }

    /**
     * The category rail — the same one Checkout browses, because it is the same catalogue.
     * ("All" always survives the rail's own search, so there is always a way back out.)
     */
    fun tabs(s: QuoteState): List<String> {
        val q = s.catQuery.trim()
        return listOf("All") + s.products.mapNotNull { it.category }.distinct().sorted()
            .filter { q.isEmpty() || it.contains(q, ignoreCase = true) }
    }

    fun catCounts(s: QuoteState): Map<String, Int> =
        s.products.mapNotNull { it.category }.groupingBy { it }.eachCount() + ("All" to s.products.size)

    fun filteredProducts(s: QuoteState): List<ProductEntity> {
        val q = s.query.trim()
        return s.products
            .filter { s.tab == "All" || it.category == s.tab }
            .filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.barcode?.contains(q) == true }
    }

    fun setTab(t: String) = _s.update { it.copy(tab = t) }
    fun setQuery(q: String) = _s.update { it.copy(query = q) }
    fun setCatQuery(q: String) = _s.update { it.copy(catQuery = q) }

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
                lines = emptyList(), acceptOpen = false, techId = null, startAt = null, savedRef = null, createdJobId = null, error = null, intake = null, jobId = q.jobId, query = "",
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
                                priceText = centsToPlainText(rupeesToCents(it.unitPrice)),
                                vatRate = it.vatRate, qty = it.qty.toInt().coerceAtLeast(1),
                                discountMode = if (it.discountKind == "amount") DiscountMode.AMT else DiscountMode.PCT,
                                discountPct = it.discountPct.toInt(),
                                discountAmtText = if (it.discountKind == "amount" && it.discountAmount > 0) centsToPlainText(rupeesToCents(it.discountAmount)) else "",
                            )
                        })
                    }
                }
                .onFailure { e -> _s.update { it.copy(error = "Couldn't load the quote's items — reopen it before saving. (${e.uiMessage()})") } }
        }
    }

    fun back() { _s.update { it.copy(mode = QuoteMode.LIST) }; loadQuotes() }

    fun addProduct(p: ProductEntity) = _s.update { st ->
        val i = st.lines.indexOfFirst { it.productId == p.id }
        val lines = if (i >= 0) st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = l.qty + 1) else l }
        else st.lines + quoteLine(p.id, p.name, p.sellingPriceCents, p.vatRatePct)
        st.copy(lines = lines)
    }

    fun openAdhoc() = _s.update { it.copy(adhocOpen = true) }
    fun closeAdhoc() = _s.update { it.copy(adhocOpen = false) }
    fun addAdhoc(name: String, priceCents: Long, vatRate: Double = 15.0) = _s.update { st ->
        if (name.isBlank() || priceCents <= 0) st.copy(adhocOpen = false)
        else st.copy(adhocOpen = false, lines = st.lines + quoteLine(null, name.trim(), priceCents, vatRate))
    }

    /** Gross (pre-discount) subtotal in cents, for the "Subtotal" display row. */
    fun grossCents(s: QuoteState): Long = s.lines.sumOf { it.qty * it.unitCents }

    fun toggleLine(i: Int) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(expanded = !l.expanded) else l.copy(expanded = false) }) }
    fun setQty(i: Int, q: Int) = _s.update { st -> if (q <= 0) st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = q) else l }) }
    fun setDiscount(i: Int, d: Int) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountPct = d) else l }) }
    fun removeLine(i: Int) = _s.update { st -> st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) }

    // ── price + Rs-discount editing (raw text lives on the line; cents derived) ──
    private fun moneyText(t: String) = t.filter { it.isDigit() || it == '.' }
    fun setPrice(i: Int, t: String) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(priceText = moneyText(t)) else l }) }
    fun setLineDiscMode(i: Int, m: DiscountMode) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountMode = m) else l }) }
    fun setLineDiscAmt(i: Int, t: String) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountAmtText = moneyText(t)) else l }) }

    // ── basket (order-level) discount ────────────────────────────────────────────
    fun setBasketMode(m: DiscountMode) = _s.update { it.copy(basketMode = m, basketText = "") }
    fun setBasketText(t: String) = _s.update { it.copy(basketText = if (it.basketMode == DiscountMode.PCT) t.filter { c -> c.isDigit() } else moneyText(t)) }

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

    fun openAccept() = _s.update { it.copy(acceptOpen = true) }
    fun closeAccept() = _s.update { it.copy(acceptOpen = false) }
    fun pickTech(id: String) = _s.update { it.copy(techId = id) }

    // ── when the car is booked in for ────────────────────────────────────────────
    // startAt == null means "start now". Picking a date keeps the time already chosen
    // (or the next half-hour); picking a time keeps the date (or today).
    fun openDatePicker() = _s.update { it.copy(datePickerOpen = true) }
    fun openTimePicker() = _s.update { it.copy(timePickerOpen = true) }
    fun closePickers() = _s.update { it.copy(datePickerOpen = false, timePickerOpen = false) }
    fun startNow() = _s.update { it.copy(startAt = null, datePickerOpen = false, timePickerOpen = false) }

    /** How long the work should take. Null clears it — "we don't know yet" is a real answer. */
    fun pickEstimate(minutes: Int?) = _s.update { it.copy(estimateMinutes = minutes) }

    companion object {
        /** A wash to a full day's ceramic — the shop's real spread of jobs. */
        val ESTIMATE_CHOICES = listOf(30, 60, 120, 240, 480)

        /** 90 → "1h 30m". Nobody books a car in for "ninety minutes". */
        fun estimateLabel(minutes: Int): String {
            val h = minutes / 60
            val m = minutes % 60
            return when {
                h == 0 -> "${m}m"
                m == 0 -> "${h}h"
                else -> "${h}h ${m}m"
            }
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
            })
        }
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
                val jobId = api.convertQuoteToJob(quoteId, s.techId, signaturePath = sigPath, signedName = s.who.takeUnless { it.isBlank() || it == "—" })
                // Book the car in, with how long it should take. Safe to retry: the conversion
                // is idempotent, so a failed schedule write simply re-runs against the same job.
                api.setJobSchedule(jobId, scheduledIso(s), s.estimateMinutes)
                quoteId to jobId
            }.onSuccess { (quoteId, jobId) ->
                // Stamp what reception recorded onto the new job — best-effort; the
                // job exists either way and the board still opens it.
                s.intake?.let { h ->
                    viewModelScope.launch {
                        if (h.markerCount > 0) runCatching { api.setJobDamageMarkers(jobId, h.markers) }
                        h.photoPaths.forEach { p ->
                            runCatching {
                                val tenant = catalog.tenantId() ?: return@runCatching
                                api.insertJobPhotoRecord(tenant, jobId, p, "before")
                            }
                        }
                    }
                }
                // signed = true: the tablet's accept flow requires the client's signature.
                _s.update { it.copy(busy = false, quoteId = quoteId, status = "accepted", createdJobId = jobId, jobId = jobId, acceptOpen = false, intake = null, signed = true, sendBusy = false, sendDone = null, sendError = null) }
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
                api.issueDocument(draft.id, "quote-inv:$quoteId")
            }.onSuccess { d -> _s.update { it.copy(busy = false, acceptOpen = false, billed = true, createdInvoiceRef = d.number ?: "Invoice issued") } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    fun clearToast() = _s.update { it.copy(savedRef = null, createdJobId = null, createdInvoiceRef = null, sendDone = null, sendError = null, sendBusy = false) }

    /** Post-accept "Send to customer": the Worker renders the signed quotation PDF
     *  and delivers it by [channel] ("email" | "whatsapp"). */
    fun sendToCustomer(channel: String, to: String, note: String = "") {
        val quoteId = _s.value.quoteId ?: return
        if (to.isBlank() || _s.value.sendBusy) return
        _s.update { it.copy(sendBusy = true, sendError = null, sendDone = null) }
        viewModelScope.launch {
            val err = runCatching { sendApi.send(quoteId, channel, to.trim(), note.trim().take(300), session.deviceId()) }
                .getOrElse { it.message ?: "Network error" }
            _s.update { cur ->
                // A late result must not stamp a DIFFERENT quote's dialog (the
                // operator may have dismissed and accepted another quote meanwhile).
                if (cur.quoteId != quoteId) cur
                else if (err == null) cur.copy(
                    sendBusy = false,
                    sendDone = if (channel == "email") "Sent by email ✓" else "Sent on WhatsApp ✓",
                    // remember what worked so re-opening prefills the corrected value
                    customerEmail = if (channel == "email") to.trim() else cur.customerEmail,
                    customerPhone = if (channel == "whatsapp") to.trim() else cur.customerPhone,
                ) else cur.copy(sendBusy = false, sendError = err)
            }
        }
    }
}
