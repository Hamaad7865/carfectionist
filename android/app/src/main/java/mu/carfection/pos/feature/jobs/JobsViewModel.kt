package mu.carfection.pos.feature.jobs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.ChecklistItemDto
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.NewCertificateDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.TechnicianDto
import mu.carfection.pos.core.sync.OutboxRepository
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject

/** The four kanban columns, in order, with the handoff's dot colours. */
enum class JobCol(val key: String, val label: String, val dot: Long) {
    SCHEDULED("scheduled", "Scheduled", 0xFF5A67D8),
    IN_PROGRESS("in_progress", "In progress", 0xFFC17A00),
    READY("ready", "Ready", 0xFF1FA361),
    DELIVERED("delivered", "Delivered", 0xFF68788A),
}

val CERT_TERMS = listOf(12 to "1 year", 36 to "3 years", 60 to "5 years", 120 to "10 years")

data class JobsState(
    val loading: Boolean = true,
    val jobs: List<JobBoardDto> = emptyList(),
    val technicians: List<TechnicianDto> = emptyList(),
    val activeJobId: String? = null,
    val busy: Boolean = false,
    val toast: String? = null,
    val error: String? = null,
    // certificate issuing (from a finished ceramic job)
    val products: List<ProductEntity> = emptyList(),
    val certOpen: Boolean = false,
    val certProductId: String? = null,
    val certTermMonths: Int = 36,
    val certBusy: Boolean = false,
    // invoice a finished job
    val invoiceOpen: Boolean = false,
    val invoiceService: String = "",
    val invoiceAmountText: String = "",
    val invoiceBusy: Boolean = false,
)

@HiltViewModel
class JobsViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val outbox: OutboxRepository,
) : ViewModel() {
    private val _s = MutableStateFlow(JobsState())
    val state = _s.asStateFlow()

    init {
        load()
        viewModelScope.launch { runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } } }
        viewModelScope.launch { catalog.products.collect { p -> _s.update { it.copy(products = p) } } }
    }

    // ── certificate issuing ────────────────────────────────────────────────────
    /** Ceramic-ish products for the picker; falls back to all if nothing matches. */
    fun certProducts(s: JobsState): List<ProductEntity> {
        val hit = s.products.filter { p -> listOf("ceramic", "diamondbrite", "coat", "ppf", "graphene").any { p.name.contains(it, true) } }
        return hit.ifEmpty { s.products }
    }

    fun openCertIssue() = _s.update { it.copy(certOpen = true, certProductId = null, certTermMonths = 36) }
    fun closeCertIssue() = _s.update { it.copy(certOpen = false) }
    fun pickCertProduct(id: String) = _s.update { it.copy(certProductId = id) }
    fun pickCertTerm(months: Int) = _s.update { it.copy(certTermMonths = months) }

    fun issueCert() {
        val s = _s.value
        val job = active(s) ?: return
        val cid = job.customerId ?: run { _s.update { it.copy(toast = "This job has no customer") }; return }
        val vid = job.vehicleId ?: run { _s.update { it.copy(toast = "This job has no vehicle") }; return }
        _s.update { it.copy(certBusy = true) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("Not synced")
                val next = nextCertNumber(runCatching { api.fetchCertNumbers() }.getOrDefault(emptyList()).map { it.number })
                val applied = LocalDate.now()
                val expires = applied.plusMonths(s.certTermMonths.toLong())
                api.insertCertificate(
                    NewCertificateDto(
                        tenantId = tenant, number = next, customerId = cid, vehicleId = vid,
                        productId = s.certProductId, jobId = job.id,
                        appliedAt = applied.toString(), warrantyMonths = s.certTermMonths, expiresAt = expires.toString(),
                    ),
                ).number
            }.onSuccess { num -> _s.update { it.copy(certBusy = false, certOpen = false, toast = "Certificate $num issued") } }
                .onFailure { e -> _s.update { it.copy(certBusy = false, toast = e.message ?: "Couldn't issue the certificate") } }
        }
    }

    private fun nextCertNumber(existing: List<String>): String {
        val max = existing.mapNotNull { Regex("(\\d+)$").find(it)?.groupValues?.get(1)?.toIntOrNull() }.maxOrNull() ?: 0
        return "CERT-" + (max + 1).toString().padStart(4, '0')
    }

    // ── invoice a finished job (create_document_from_job → price → issue) ──────
    fun openInvoice() { val j = active(_s.value); _s.update { it.copy(invoiceOpen = true, invoiceService = j?.notes?.ifBlank { null } ?: "Detailing service", invoiceAmountText = "") } }
    fun closeInvoice() = _s.update { it.copy(invoiceOpen = false) }
    fun setInvoiceService(t: String) = _s.update { it.copy(invoiceService = t) }
    fun setInvoiceAmount(t: String) = _s.update { it.copy(invoiceAmountText = t.filter { c -> c.isDigit() || c == '.' }) }

    fun issueInvoice() {
        val s = _s.value
        val job = active(s) ?: return
        val cid = job.customerId ?: run { note("This job has no customer"); return }
        val cents = parseMoneyToCents(s.invoiceAmountText)
        if (cents == null || cents <= 0) { note("Enter an amount"); return }
        _s.update { it.copy(invoiceBusy = true) }
        viewModelScope.launch {
            runCatching {
                val draft = api.createDocumentFromJob(job.id, "invoice")
                val doc = buildJsonObject {
                    put("id", draft.id); put("doc_type", "invoice"); put("customer_id", cid)
                    if (job.vehicleId != null) put("vehicle_id", job.vehicleId) else put("vehicle_id", JsonNull)
                    put("origin", "from_job")
                }
                val lines = buildJsonArray {
                    add(buildJsonObject {
                        put("product_id", JsonNull); put("title", s.invoiceService.ifBlank { "Detailing service" })
                        put("qty", 1); put("unit_price", centsToRupees(cents)); put("discount_pct", 0); put("vat_rate", 15); put("sort_order", 0)
                    })
                }
                api.saveDraft(doc, lines)
                // Workshop stock, not the shop floor: a job invoice keeps the default location.
                api.issueDocument(draft.id, null, "job-inv:${job.id}")
            }.onSuccess { d -> _s.update { it.copy(invoiceBusy = false, invoiceOpen = false, toast = "${d.number ?: "Invoice"} created — collect it in Checkout") } }
                .onFailure { e ->
                    val msg = if (e.message?.contains("already has", true) == true) "This job already has an invoice — collect it in Checkout" else (e.message ?: "Couldn't create the invoice")
                    _s.update { it.copy(invoiceBusy = false, toast = msg) }
                }
        }
    }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchJobs() }
                .onSuccess { j -> _s.update { it.copy(loading = false, jobs = j) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun jobsFor(s: JobsState, col: JobCol): List<JobBoardDto> = s.jobs.filter { it.status == col.key }
    fun active(s: JobsState): JobBoardDto? = s.jobs.firstOrNull { it.id == s.activeJobId }

    fun open(id: String) = _s.update { it.copy(activeJobId = id) }
    fun close() = _s.update { it.copy(activeJobId = null) }
    fun clearToast() = _s.update { it.copy(toast = null) }
    fun note(msg: String) = _s.update { it.copy(toast = msg) }

    fun assignTech(techId: String) {
        val id = _s.value.activeJobId ?: return
        val tech = _s.value.technicians.firstOrNull { it.id == techId }?.displayName ?: "technician"
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(technicianId = techId) else it }) }
        // Durable + idempotent: survives a dropped connection, replays safely on reconnect.
        viewModelScope.launch { outbox.enqueueAssignTech(id, techId, "Assign $tech") }
    }

    fun toggleChecklist(index: Int) {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id } ?: return
        if (job.status == "delivered") { _s.update { it.copy(toast = "Job already delivered") }; return }
        val updated = job.checklist.mapIndexed { i, c -> if (i == index) c.copy(done = !c.done) else c }
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(checklist = updated) else it }) }
        val json = buildJsonArray { updated.forEach { add(buildJsonObject { put("label", it.label); put("done", it.done) }) } }
        val done = updated.count { it.done }
        viewModelScope.launch { outbox.enqueueSetChecklist(id, json, "Checklist $done/${updated.size}") }
    }

    fun startJob() {
        val id = _s.value.activeJobId ?: return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.startJob(id, Instant.now().toString()) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Job started") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    fun markReady() {
        val id = _s.value.activeJobId ?: return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.markJobReady(id) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Marked ready for collection") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }
}
