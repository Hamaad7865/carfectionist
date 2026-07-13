package mu.carfection.pos.feature.jobs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.OpenJobBus
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.database.ProductEntity
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.core.money.centsToRupees
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.ChecklistItemDto
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.JobPhotoDto
import mu.carfection.pos.core.network.NewCertificateDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.TechnicianDto
import mu.carfection.pos.core.sync.OutboxRepository
import java.time.Instant
import java.time.LocalDate
import mu.carfection.pos.core.network.uiMessage
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
    // checklist add
    val addChecklistOpen: Boolean = false,
    // before/after photos for the open job (id → signed thumbnail URL)
    val photos: List<JobPhotoDto> = emptyList(),
    val photoUrls: Map<String, String> = emptyMap(),
    val photoUploading: String? = null, // "before" | "after" while a capture uploads
)

@HiltViewModel
class JobsViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val outbox: OutboxRepository,
    private val captures: CaptureBus,
    private val session: SessionRepository,
    private val openJobBus: OpenJobBus,
) : ViewModel() {
    private val _s = MutableStateFlow(JobsState())
    val state = _s.asStateFlow()
    private val checklistJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** The camera round-trip is coordinated by [CaptureBus] — see its docs. */
    fun beginCapture(phase: String, file: File) = captures.begin("jobs:$phase", file)

    init {
        load()
        viewModelScope.launch { runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } } }
        viewModelScope.launch { catalog.products.collect { p -> _s.update { it.copy(products = p) } } }
        viewModelScope.launch {
            captures.results.collect { r ->
                if (r.target.startsWith("jobs:")) {
                    addPhoto(r.target.substringAfter(':'), r.file.readBytes())
                    runCatching { r.file.delete() }
                }
            }
        }
        // The quote builder's "View job" asks the board to open a specific job (latched, so it
        // arrives even though this ViewModel is created only when the shell navigates to Jobs).
        viewModelScope.launch {
            openJobBus.pending.collect { jobId -> if (jobId != null) { openJobBus.consume(); open(jobId) } }
        }
        // Activity-scoped: close one operator's open work order + half-typed invoice/cert dialogs
        // on sign-out, so the next operator can't issue a stale amount under their own session.
        viewModelScope.launch {
            session.isLoggedIn.collect {
                if (it == false) _s.update { st ->
                    st.copy(
                        activeJobId = null, certOpen = false, certProductId = null,
                        invoiceOpen = false, invoiceService = "", invoiceAmountText = "",
                        addChecklistOpen = false, photos = emptyList(), photoUrls = emptyMap(),
                        photoUploading = null, error = null, toast = null,
                    )
                }
            }
        }
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
                .onFailure { e -> _s.update { it.copy(certBusy = false, toast = e.uiMessage("Couldn’t issue the certificate")) } }
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
                api.issueDocument(draft.id, "job-inv:${job.id}")
            }.onSuccess { d -> _s.update { it.copy(invoiceBusy = false, invoiceOpen = false, toast = "${d.number ?: "Invoice"} created — collect it in Checkout") } }
                .onFailure { e ->
                    val msg = if (e.message?.contains("already has", true) == true) "This job already has an invoice — collect it in Checkout" else e.uiMessage("Couldn’t create the invoice")
                    _s.update { it.copy(invoiceBusy = false, toast = msg) }
                }
        }
    }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchJobs() }
                .onSuccess { j ->
                    // Overlay writes still sitting in the outbox — otherwise this server snapshot,
                    // which is behind the queue, would revert a checklist/assign edit the tech just
                    // made offline (and the next edit would be built on the reverted state).
                    val overlays = runCatching { outbox.pendingJobOverlays() }.getOrDefault(emptyMap())
                    val merged = if (overlays.isEmpty()) j else j.map { job ->
                        val o = overlays[job.id] ?: return@map job
                        job.copy(
                            checklist = o.checklist?.let { runCatching { checklistJson.decodeFromString<List<ChecklistItemDto>>(it.toString()) }.getOrNull() } ?: job.checklist,
                            technicianId = o.technicianId ?: job.technicianId,
                        )
                    }
                    _s.update { it.copy(loading = false, jobs = merged) }
                }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    fun jobsFor(s: JobsState, col: JobCol): List<JobBoardDto> = s.jobs.filter { it.status == col.key }
    fun active(s: JobsState): JobBoardDto? = s.jobs.firstOrNull { it.id == s.activeJobId }

    // Clear photoUploading too: it isn't job-scoped, so leaving it set would show a phantom
    // "Uploading…" (and a disabled capture button) on the next job opened.
    fun open(id: String) { _s.update { it.copy(activeJobId = id, photos = emptyList(), photoUrls = emptyMap(), photoUploading = null) }; loadPhotos(id) }
    fun close() = _s.update { it.copy(activeJobId = null, photos = emptyList(), photoUrls = emptyMap(), photoUploading = null) }
    fun clearToast() = _s.update { it.copy(toast = null) }
    fun note(msg: String) = _s.update { it.copy(toast = msg) }

    // ── checklist add ──────────────────────────────────────────────────────────
    fun openAddChecklist() = _s.update { it.copy(addChecklistOpen = true) }
    fun closeAddChecklist() = _s.update { it.copy(addChecklistOpen = false) }

    fun addChecklistItem(label: String) {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id } ?: return
        val text = label.trim()
        if (text.isBlank()) { _s.update { it.copy(addChecklistOpen = false) }; return }
        val updated = job.checklist + ChecklistItemDto(text, false)
        _s.update { st -> st.copy(addChecklistOpen = false, jobs = st.jobs.map { if (it.id == id) it.copy(checklist = updated) else it }) }
        val json = buildJsonArray { updated.forEach { add(buildJsonObject { put("label", it.label); put("done", it.done) }) } }
        viewModelScope.launch { outbox.enqueueSetChecklist(id, json, "Checklist +\"${text.take(20)}\"") }
    }

    fun removeChecklistItem(index: Int) {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id } ?: return
        val updated = job.checklist.filterIndexed { i, _ -> i != index }
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(checklist = updated) else it }) }
        val json = buildJsonArray { updated.forEach { add(buildJsonObject { put("label", it.label); put("done", it.done) }) } }
        viewModelScope.launch { outbox.enqueueSetChecklist(id, json, "Checklist −1") }
    }

    // ── before/after photos ─────────────────────────────────────────────────────
    private fun loadPhotos(jobId: String) = viewModelScope.launch {
        val list = runCatching { api.fetchJobPhotos(jobId) }.getOrDefault(emptyList())
        _s.update { it.copy(photos = list) }
        list.forEach { p ->
            runCatching { api.signedPhotoUrl(p.storagePath) }.onSuccess { url ->
                _s.update { st -> st.copy(photoUrls = st.photoUrls + (p.id to url)) }
            }
        }
    }

    /** Called after the camera writes the JPEG; uploads it and records the photo row. */
    fun addPhoto(phase: String, bytes: ByteArray) {
        val jobId = _s.value.activeJobId ?: return
        _s.update { it.copy(photoUploading = phase) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("Not synced yet")
                api.uploadJobPhoto(tenant, jobId, phase, bytes)
            }.onSuccess { p ->
                val url = runCatching { api.signedPhotoUrl(p.storagePath) }.getOrNull()
                // The row is correctly tagged to jobId server-side; only reflect it in the on-screen
                // gallery if that job is still open (the user may have switched during the upload).
                _s.update { st ->
                    if (st.activeJobId != jobId) st
                    else st.copy(photoUploading = null, photos = st.photos + p, photoUrls = if (url != null) st.photoUrls + (p.id to url) else st.photoUrls, toast = "${phase.replaceFirstChar { it.uppercase() }} photo added")
                }
            }.onFailure { e ->
                _s.update { st -> if (st.activeJobId != jobId) st else st.copy(photoUploading = null, toast = "Couldn’t save the photo — ${e.uiMessage("try again")}") }
            }
        }
    }

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
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    // ── job timer pause/resume ─────────────────────────────────────────────────
    private fun isoToInstant(iso: String?): Instant? =
        iso?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant() }.getOrNull() }

    /** Pause when running, resume when paused — optimistic, then persisted. */
    fun togglePause() {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id } ?: return
        if (job.status != "in_progress") return
        val now = Instant.now()
        val pausedSince = isoToInstant(job.pausedAt)
        val (at, ms, note) =
            if (pausedSince == null) Triple(now.toString(), job.pausedMs, "Timer paused")
            else Triple(null, job.pausedMs + (now.toEpochMilli() - pausedSince.toEpochMilli()).coerceAtLeast(0), "Timer running")
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == id) it.copy(pausedAt = at, pausedMs = ms) else it }, toast = note) }
        viewModelScope.launch {
            runCatching { api.setJobPause(id, at, ms) }
                .onFailure { e -> _s.update { it.copy(error = e.uiMessage()) }; load() }
        }
    }

    fun markReady() {
        val id = _s.value.activeJobId ?: return
        val job = _s.value.jobs.firstOrNull { it.id == id }
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching {
                // A job marked ready while paused: close the open pause first, so the
                // recorded time-on-job stops at the pause, not at collection.
                val pausedSince = isoToInstant(job?.pausedAt)
                if (job != null && pausedSince != null) {
                    val folded = job.pausedMs + (Instant.now().toEpochMilli() - pausedSince.toEpochMilli()).coerceAtLeast(0)
                    api.setJobPause(id, null, folded)
                }
                api.markJobReady(id)
            }
                .onSuccess {
                    // The bill exists the moment the car is ready: a quote-backed job's
                    // priced invoice is created + issued NOW (idempotent), so checkout's
                    // TO COLLECT already has it when the customer walks up.
                    val quoteId = job?.sourceQuoteId
                    val invoiced = quoteId != null && runCatching { ensureQuoteInvoice(quoteId) }.isSuccess
                    _s.update {
                        it.copy(
                            busy = false,
                            toast = when {
                                invoiced -> "Ready — invoice waiting at checkout"
                                quoteId != null -> "Ready — invoice pending; Go to checkout will retry"
                                else -> "Marked ready for collection"
                            },
                        )
                    }
                    load()
                }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /**
     * The quote's priced invoice, created + issued exactly once. Both layers are
     * replay-safe: convert_quote_to_invoice hands back the existing live invoice
     * (one per quote — DB unique index), and issue_document replays on the same
     * "quote-inv:<quoteId>" key the quote builder's "Bill now" uses. An invoice
     * already issued elsewhere is left untouched (only drafts get issued).
     */
    private suspend fun ensureQuoteInvoice(quoteId: String) {
        val inv = api.convertQuoteToInvoice(quoteId)
        if (inv.status == null || inv.status == "draft") api.issueDocument(inv.id, "quote-inv:$quoteId")
    }

    /**
     * READY job → make sure its bill is waiting at checkout, then navigate.
     * Covers jobs marked ready before auto-invoicing existed, and retries a
     * mark-ready whose invoice step failed — all idempotent, never a duplicate.
     */
    fun goToCheckout(onGo: () -> Unit) {
        val job = active(_s.value) ?: run { onGo(); return }
        val quoteId = job.sourceQuoteId
        val hasLiveInvoice = job.invoices.any { it.docType == "invoice" && it.status != "void" && it.status != "draft" }
        if (quoteId == null || hasLiveInvoice) { close(); onGo(); return }
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { ensureQuoteInvoice(quoteId) }
                .onSuccess { _s.update { it.copy(busy = false) }; close(); onGo() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage("Couldn't create the invoice — check the connection and try again")) } }
        }
    }
}
