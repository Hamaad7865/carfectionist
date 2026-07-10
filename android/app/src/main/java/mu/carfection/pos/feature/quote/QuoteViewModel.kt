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
import mu.carfection.pos.core.data.IntakeHandoff
import mu.carfection.pos.core.data.IntakeHandoffBus
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.DocTotals
import mu.carfection.pos.core.money.LineInput
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.computeTotals
import mu.carfection.pos.core.money.rupeesToCents
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.QuoteRowDto
import mu.carfection.pos.core.network.TechnicianDto
import javax.inject.Inject

enum class QuoteMode { LIST, BUILDER }

data class QuoteLine(
    val productId: String?,
    val title: String,
    val unitCents: Long,
    val vatRate: Double,
    val qty: Int = 1,
    val discountPct: Int = 0,
    val expanded: Boolean = false,
)

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
    val tab: String = "All",
    val products: List<ProductEntity> = emptyList(),
    val lines: List<QuoteLine> = emptyList(),
    val technicians: List<TechnicianDto> = emptyList(),
    val acceptOpen: Boolean = false,
    val techId: String? = null,
    val time: String? = null,
    val busy: Boolean = false,
    val adhocOpen: Boolean = false,
    val savedRef: String? = null,
    val createdJobId: String? = null,
    val createdInvoiceRef: String? = null,
    val error: String? = null,
    // carried from reception: stamped onto the job when this quote is accepted
    val intake: IntakeHandoff? = null,
)

val QUOTE_TIMES = listOf("Now", "13:30", "14:30", "15:30", "Tomorrow")

@HiltViewModel
class QuoteViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val api: PosApi,
    private val intakeBus: IntakeHandoffBus,
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
    }

    private fun beginFromIntake(h: IntakeHandoff) = _s.update {
        it.copy(
            mode = QuoteMode.BUILDER, quoteId = null, ref = "New quote", status = "draft",
            who = h.customerName, vehPlate = h.plate, veh = h.vehLabel,
            customerId = h.customerId, vehicleId = h.vehicleId,
            lines = emptyList(), acceptOpen = false, techId = null, time = null,
            savedRef = null, createdJobId = null, createdInvoiceRef = null, error = null,
            intake = h,
        )
    }

    fun loadQuotes() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchQuotes() }
                .onSuccess { q -> _s.update { it.copy(loading = false, quotes = q) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun tabs(s: QuoteState): List<String> =
        listOf("All") + s.products.map { it.kind.replaceFirstChar { c -> c.uppercase() } }.distinct()

    fun filteredProducts(s: QuoteState): List<ProductEntity> =
        if (s.tab == "All") s.products else s.products.filter { it.kind.equals(s.tab, true) }

    fun setTab(t: String) = _s.update { it.copy(tab = t) }

    fun openQuote(q: QuoteRowDto) {
        _s.update {
            it.copy(
                mode = QuoteMode.BUILDER, quoteId = q.id, ref = q.number ?: "Draft", status = q.status,
                who = q.customers?.name ?: "—", vehPlate = q.vehicles?.plate,
                veh = listOfNotNull(q.vehicles?.make, q.vehicles?.model).joinToString(" "),
                customerId = q.customerId, vehicleId = q.vehicleId,
                lines = emptyList(), acceptOpen = false, techId = null, time = null, savedRef = null, createdJobId = null, error = null,
            )
        }
        viewModelScope.launch {
            runCatching { api.fetchQuoteLines(q.id) }.onSuccess { ls ->
                _s.update { st -> st.copy(lines = ls.map { QuoteLine(it.productId, it.title, rupeesToCents(it.unitPrice), it.vatRate, it.qty.toInt().coerceAtLeast(1), it.discountPct.toInt()) }) }
            }
        }
    }

    fun back() { _s.update { it.copy(mode = QuoteMode.LIST) }; loadQuotes() }

    fun addProduct(p: ProductEntity) = _s.update { st ->
        val i = st.lines.indexOfFirst { it.productId == p.id }
        val lines = if (i >= 0) st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = l.qty + 1) else l }
        else st.lines + QuoteLine(p.id, p.name, p.sellingPriceCents, p.vatRatePct)
        st.copy(lines = lines)
    }

    fun openAdhoc() = _s.update { it.copy(adhocOpen = true) }
    fun closeAdhoc() = _s.update { it.copy(adhocOpen = false) }
    fun addAdhoc(name: String, priceCents: Long, vatRate: Double = 15.0) = _s.update { st ->
        if (name.isBlank() || priceCents <= 0) st.copy(adhocOpen = false)
        else st.copy(adhocOpen = false, lines = st.lines + QuoteLine(null, name.trim(), priceCents, vatRate))
    }

    /** Gross (pre-discount) subtotal in cents, for the "Subtotal" display row. */
    fun grossCents(s: QuoteState): Long = s.lines.sumOf { it.qty * it.unitCents }

    fun toggleLine(i: Int) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(expanded = !l.expanded) else l.copy(expanded = false) }) }
    fun setQty(i: Int, q: Int) = _s.update { st -> if (q <= 0) st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) else st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(qty = q) else l }) }
    fun setDiscount(i: Int, d: Int) = _s.update { st -> st.copy(lines = st.lines.mapIndexed { j, l -> if (j == i) l.copy(discountPct = d) else l }) }
    fun removeLine(i: Int) = _s.update { st -> st.copy(lines = st.lines.filterIndexed { j, _ -> j != i }) }

    fun totals(s: QuoteState): DocTotals = computeTotals(s.lines.map { LineInput(it.qty.toDouble(), it.unitCents, it.discountPct.toDouble(), it.vatRate) })

    fun openAccept() = _s.update { it.copy(acceptOpen = true) }
    fun closeAccept() = _s.update { it.copy(acceptOpen = false) }
    fun pickTech(id: String) = _s.update { it.copy(techId = id) }
    fun pickTime(t: String) = _s.update { it.copy(time = t) }

    private fun linesJson(s: QuoteState): JsonArray = buildJsonArray {
        s.lines.forEachIndexed { i, l ->
            add(buildJsonObject {
                if (l.productId != null) put("product_id", l.productId) else put("product_id", JsonNull)
                put("title", l.title)
                put("description", JsonNull)
                put("qty", l.qty)
                put("unit_price", centsToRupees(l.unitCents))
                put("discount_pct", l.discountPct)
                put("vat_rate", l.vatRate)
                put("sort_order", i)
            })
        }
    }

    fun saveDraft() {
        val s = _s.value
        val cid = s.customerId ?: run { _s.update { it.copy(error = "No customer on this quote") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching { api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s)) }
                .onSuccess { d -> _s.update { it.copy(busy = false, quoteId = d.id, savedRef = d.number ?: "Draft saved") } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    fun create() {
        val s = _s.value
        val cid = s.customerId ?: return
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                // Persist the builder's edits first, then convert atomically: the
                // RPC issues+accepts the quote and spawns the linked job in one txn
                // (idempotent, and it owns the customer/vehicle guards — no client
                // vehicle-less pre-check needed; a missing vehicle surfaces its error).
                val saved = api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s))
                saved to api.convertQuoteToJob(saved.id, s.techId)
            }.onSuccess { (saved, jobId) ->
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
                _s.update { it.copy(busy = false, quoteId = saved.id, status = "accepted", createdJobId = jobId, acceptOpen = false, intake = null) }
            }.onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    /** Bill the quote now: persist it, copy into a draft invoice, then issue for gapless INV#. */
    fun convertToInvoice() {
        val s = _s.value
        val cid = s.customerId ?: run { _s.update { it.copy(error = "No customer on this quote") }; return }
        if (s.lines.isEmpty()) { _s.update { it.copy(error = "Add a line before billing") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val quote = api.saveQuoteDraft(s.quoteId, cid, s.vehicleId, linesJson(s))
                val draft = api.convertQuoteToInvoice(quote.id)
                api.issueDocument(draft.id, "quote-inv:${quote.id}")
            }.onSuccess { d -> _s.update { it.copy(busy = false, acceptOpen = false, createdInvoiceRef = d.number ?: "Invoice issued") } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    fun clearToast() = _s.update { it.copy(savedRef = null, createdJobId = null, createdInvoiceRef = null) }
}
