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
import mu.carfection.pos.core.data.saleReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptDoc
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.network.DocumentSendApi
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
import java.time.ZoneId
import java.time.ZoneOffset
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

/** How long a handed-over car stays visible on the board before it ages off by itself. */
const val DELIVERED_WINDOW_MS = 48L * 60 * 60 * 1000

/** Timestamps come back as ISO instants or offset date-times depending on the column. */
private fun epochOrNull(iso: String): Long? =
    runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()

data class JobsState(
    val loading: Boolean = true,
    val jobs: List<JobBoardDto> = emptyList(),
    val technicians: List<TechnicianDto> = emptyList(),
    // Everyone ON the open job, not just its lead. jobs.technician_id stays the lead (every
    // report and the web read it); job_technicians carries the rest of the crew.
    val crew: List<String> = emptyList(), // app_user ids
    // The open job's comment thread — dated and attributed, unlike jobs.notes which is the
    // job's standing description.
    val comments: List<mu.carfection.pos.core.network.JobCommentDto> = emptyList(),
    val commentDraft: String = "",
    val commentBusy: Boolean = false,
    val activeJobId: String? = null,
    // The shop quotes VAT-inclusive shelf prices — show gross in the product picker. Display only.
    val pricesInclVat: Boolean = false,
    val busy: Boolean = false,
    val toast: String? = null,
    /** False on reception's tablet — a ready job's invoice is raised here, collected there. */
    val takesPayments: Boolean = true,
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
    // What the customer actually ordered — the service lines off the job's quote, so the work
    // order says what to do instead of making the tech open the quote to find out.
    val detailLines: List<mu.carfection.pos.core.network.QuoteLineDto> = emptyList(),
    // "View invoice": the job's bill, rebuilt from what the server stored — read it here,
    // print it, or send it. It is NOT in checkout's TO COLLECT once it is paid, which is why
    // sending the operator there showed them an empty screen.
    val viewInvoice: ReceiptDoc? = null,
    val viewInvoiceId: String? = null,
    val viewInvoiceBusy: Boolean = false,
    val viewCustEmail: String? = null,
    val viewCustPhone: String? = null,
    val sendBusy: Boolean = false,
    val sendDone: String? = null,
    val sendError: String? = null,
    // Reschedule a booking's start time: date first, then time (same two-step as the
    // quote screen's "booked in for").
    val reschedDateOpen: Boolean = false,
    val reschedTimeOpen: Boolean = false,
    val reschedDayMs: Long? = null, // the day picked, waiting on a time
)

@HiltViewModel
class JobsViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val outbox: OutboxRepository,
    private val captures: CaptureBus,
    private val session: SessionRepository,
    private val openJobBus: OpenJobBus,
    private val printer: ReceiptPrinter,
    private val sendApi: DocumentSendApi,
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
) : ViewModel() {
    private var appUserId: String? = null
    private val _s = MutableStateFlow(JobsState())
    val state = _s.asStateFlow()
    private val checklistJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** The camera round-trip is coordinated by [CaptureBus] — see its docs. */
    fun beginCapture(phase: String, file: File) = captures.begin("jobs:$phase", file)

    init {
        viewModelScope.launch { deviceRole.takesPayments.collect { t -> _s.update { it.copy(takesPayments = t) } } }
    }

    init {
        load()
        loadTechnicians()
        viewModelScope.launch { catalog.products.collect { p -> _s.update { it.copy(products = p) } } }
        viewModelScope.launch {
            catalog.pricesInclVatFlow.collect { incl -> _s.update { it.copy(pricesInclVat = incl) } }
        }
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
    /**
     * A quoted job's bill is its quote — already priced, already signed. Raise it as-is
     * rather than opening a pad that asks the operator to retype what the customer has
     * agreed to. Only a job with no quote (a walk-in booked straight onto the board) has
     * nothing to inherit, and only that job gets the typed dialog.
     */
    fun openInvoice() {
        val j = active(_s.value) ?: return
        val quoteId = j.sourceQuoteId
        if (quoteId != null) {
            _s.update { it.copy(invoiceBusy = true) }
            viewModelScope.launch {
                runCatching { ensureQuoteInvoice(quoteId) }
                    .onSuccess {
                        _s.update { it.copy(invoiceBusy = false, toast = "Invoice raised from the quote — collect it in Checkout") }
                        load()
                    }
                    .onFailure { e -> _s.update { it.copy(invoiceBusy = false, toast = e.uiMessage("Couldn’t raise the invoice")) } }
            }
            return
        }
        _s.update { it.copy(invoiceOpen = true, invoiceService = j.notes?.ifBlank { null } ?: "Detailing service", invoiceAmountText = "") }
    }
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
                // The server, not this screen, knows whether the job has a signed quote —
                // a job can acquire one (an accepted revision) without its own immutable
                // source_quote_id ever changing, and this pad would then overwrite a bill
                // the customer signed with a figure someone typed. If it came priced from a
                // quote, leave every line exactly as agreed and just issue it.
                if (draft.sourceDocumentId == null) {
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
                }
                if (draft.status == null || draft.status == "draft") api.issueDocument(draft.id, "inv:${draft.id}").number
                else draft.number
            }.onSuccess { n -> _s.update { it.copy(invoiceBusy = false, invoiceOpen = false, toast = "${n ?: "Invoice"} created — collect it in Checkout") } }
                .onFailure { e ->
                    val msg = if (e.message?.contains("already has", true) == true) "This job already has an invoice — collect it in Checkout" else e.uiMessage("Couldn’t create the invoice")
                    _s.update { it.copy(invoiceBusy = false, toast = msg) }
                }
        }
    }

    /**
     * The assignable roster. Re-read on every board load, not once at construction: this
     * ViewModel outlives tab switches, so a technician added in Settings never appeared on a
     * job until the whole app was restarted.
     */
    fun loadTechnicians() {
        viewModelScope.launch {
            runCatching { api.fetchTechnicians() }.onSuccess { t -> _s.update { it.copy(technicians = t) } }
        }
    }

    fun load() {
        loadTechnicians()
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
                            technicianId = if (o.technicianQueued) o.technicianId else job.technicianId,
                        )
                    }
                    _s.update { it.copy(loading = false, jobs = merged) }
                }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    // A delivered card leaves the board two ways: swiped away by staff, or aged off 48h
    // after the handover. Either way only the CARD goes — the job, its invoice and its
    // history are permanent (Documents/Reports).
    fun jobsFor(s: JobsState, col: JobCol): List<JobBoardDto> = s.jobs.filter { job ->
        job.status == col.key && (col != JobCol.DELIVERED || run {
            if (job.boardDismissedAt != null) return@run false
            val at = job.deliveredAt ?: return@run true
            val ms = epochOrNull(at) ?: return@run true
            System.currentTimeMillis() - ms < DELIVERED_WINDOW_MS
        })
    }

    // ── the job's invoice: read it, print it, send it ───────────────────────────
    /** The bill this job was charged on — the live one, never a voided or draft copy. */
    private fun liveInvoiceOf(j: JobBoardDto) =
        j.invoices.lastOrNull { it.docType == "invoice" && it.status != "void" && it.status != "draft" }

    fun openInvoiceView() {
        val job = active(_s.value) ?: return
        val inv = liveInvoiceOf(job) ?: run { _s.update { it.copy(toast = "This job has no invoice yet") }; return }
        _s.update { it.copy(viewInvoiceBusy = true, viewInvoiceId = inv.id, sendDone = null, sendError = null) }
        viewModelScope.launch {
            runCatching { api.fetchInvoice(inv.id) ?: error("not found") }
                .onSuccess { h ->
                    val doc = saleReceiptDoc(h, catalog.receiptBiz(), catalog.vatDefault().toInt())
                    _s.update {
                        it.copy(
                            viewInvoiceBusy = false, viewInvoice = doc,
                            viewCustEmail = h.customers?.email, viewCustPhone = h.customers?.phone,
                        )
                    }
                }
                .onFailure { e ->
                    _s.update { it.copy(viewInvoiceBusy = false, viewInvoiceId = null, error = e.uiMessage("Couldn’t load the invoice")) }
                }
        }
    }

    fun closeInvoiceView() = _s.update {
        it.copy(viewInvoice = null, viewInvoiceId = null, viewInvoiceBusy = false, sendBusy = false, sendDone = null, sendError = null)
    }

    /** Reprint the same slip the till prints — the printer is the only side effect. */
    fun printInvoice() {
        val doc = _s.value.viewInvoice ?: return
        viewModelScope.launch {
            runCatching { printer.printDoc(doc) }
                .onSuccess { _s.update { it.copy(toast = "Sent to the printer") } }
                .onFailure { e -> _s.update { it.copy(toast = e.uiMessage("Couldn’t print — check the printer in Settings")) } }
        }
    }

    /** The server renders the invoice PDF and delivers it as the operator (email or WhatsApp). */
    fun sendInvoice(channel: String, to: String, note: String = "") {
        val id = _s.value.viewInvoiceId ?: return
        if (to.isBlank() || _s.value.sendBusy) return
        _s.update { it.copy(sendBusy = true, sendDone = null, sendError = null) }
        viewModelScope.launch {
            val err = runCatching { sendApi.send(id, channel, to.trim(), note.trim().take(300), session.deviceId()) }
                .getOrElse { it.message ?: "Network error" }
            _s.update { cur ->
                // A late reply must never stamp a different invoice's dialog.
                if (cur.viewInvoiceId != id) cur
                else if (err == null) cur.copy(sendBusy = false, sendDone = if (channel == "email") "Sent by email ✓" else "Sent on WhatsApp ✓")
                else cur.copy(sendBusy = false, sendError = err)
            }
        }
    }

    /** Swipe a delivered card off the board. Optimistic: the card goes now, the write follows. */
    fun dismissDelivered(jobId: String) {
        val now = Instant.now().toString()
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == jobId) it.copy(boardDismissedAt = now) else it }, toast = "Cleared from the board") }
        viewModelScope.launch {
            runCatching { api.dismissJobCard(jobId, now) }
                .onFailure { e ->
                    // Put it back — a card that silently reappears on the next load is worse
                    // than one that never left.
                    _s.update { st ->
                        st.copy(
                            jobs = st.jobs.map { if (it.id == jobId) it.copy(boardDismissedAt = null) else it },
                            toast = e.uiMessage("Couldn’t clear the card — check the connection"),
                        )
                    }
                }
        }
    }
    fun active(s: JobsState): JobBoardDto? = s.jobs.firstOrNull { it.id == s.activeJobId }

    // Clear photoUploading too: it isn't job-scoped, so leaving it set would show a phantom
    // "Uploading…" (and a disabled capture button) on the next job opened.
    fun open(id: String) {
        // Clear the PREVIOUS job's crew and comments as well — showing one car's notes under
        // another's would be worse than showing none.
        _s.update {
            it.copy(
                activeJobId = id, photos = emptyList(), photoUrls = emptyMap(), photoUploading = null,
                detailLines = emptyList(), crew = emptyList(), comments = emptyList(), commentDraft = "",
            )
        }
        loadPhotos(id)
        loadJobDetail(id)
        // Pull the ordered services off the job's quote so the work order is detailed.
        _s.value.jobs.firstOrNull { it.id == id }?.sourceQuoteId?.let { quoteId ->
            viewModelScope.launch {
                runCatching { api.fetchQuoteLines(quoteId) }
                    .onSuccess { lines -> _s.update { if (it.activeJobId == id) it.copy(detailLines = lines) else it } }
            }
        }
    }
    fun close() = _s.update { it.copy(activeJobId = null, photos = emptyList(), photoUrls = emptyMap(), photoUploading = null) }
    fun clearToast() = _s.update { it.copy(toast = null, error = null) }
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

    // ── crew + comments for the open job ──────────────────────────────────────
    /** Load both when a job is opened — they are what the detail sheet shows. */
    fun loadJobDetail(jobId: String) {
        viewModelScope.launch {
            val fetched = runCatching { api.fetchJobCrew(jobId) }.getOrDefault(emptyList()).map { it.appUserId }
            // Fold in anything still queued on this device — the server snapshot is behind the
            // outbox, so without this a crew change made on a dropped connection reads as lost.
            val crew = runCatching { outbox.overlayCrew(jobId, fetched) }.getOrDefault(fetched)
            val comments = runCatching { api.fetchJobComments(jobId) }.getOrDefault(emptyList())
            _s.update { it.copy(crew = crew, comments = comments) }
        }
    }

    /**
     * Everyone on the job, lead first. The lead lives on jobs.technician_id and the rest in
     * job_technicians, never both — the filter is defensive, so a stray duplicate row can't
     * show someone twice.
     */
    fun roster(jobId: String): List<String> {
        val lead = _s.value.jobs.firstOrNull { it.id == jobId }?.technicianId
        return listOfNotNull(lead) + _s.value.crew.filter { it != lead }
    }

    /**
     * One tap puts someone on the job or takes them off — the same rule as the quote's accept
     * panel, so the two screens behave alike. First on is the lead; take the lead off and the
     * next person is promoted, because a job with a crew should never be leaderless.
     */
    fun tapTech(jobId: String, appUserId: String) {
        val current = roster(jobId)
        when {
            appUserId !in current -> if (current.isEmpty()) setLead(jobId, appUserId) else addToCrew(jobId, appUserId)
            appUserId == current.first() -> promote(jobId, appUserId, current.getOrNull(1))
            else -> removeFromCrew(jobId, appUserId)
        }
    }

    private fun setLead(jobId: String, techId: String?) {
        val name = _s.value.technicians.firstOrNull { it.id == techId }?.displayName ?: "technician"
        _s.update { st -> st.copy(jobs = st.jobs.map { if (it.id == jobId) it.copy(technicianId = techId) else it }) }
        // Durable + idempotent: survives a dropped connection, replays safely on reconnect.
        viewModelScope.launch {
            outbox.enqueueAssignTech(jobId, techId, if (techId == null) "Unassign job" else "Assign $name")
        }
    }

    /**
     * Same rule as [setLead]: optimistic update, then a durably-queued write — a crew chip and
     * the lead picker are the same kind of action to the operator, so a dropped connection must
     * not make one of them stick and the other vanish.
     */
    private fun addToCrew(jobId: String, appUserId: String) {
        val name = _s.value.technicians.firstOrNull { it.id == appUserId }?.displayName ?: "technician"
        _s.update { it.copy(crew = it.crew + appUserId) }
        viewModelScope.launch {
            val tenant = catalog.tenantId() ?: return@launch
            outbox.enqueueAddCrew(jobId, appUserId, tenant, "Add $name")
        }
    }

    private fun removeFromCrew(jobId: String, appUserId: String) {
        val name = _s.value.technicians.firstOrNull { it.id == appUserId }?.displayName ?: "technician"
        _s.update { it.copy(crew = it.crew - appUserId) }
        viewModelScope.launch { outbox.enqueueRemoveCrew(jobId, appUserId, "Remove $name") }
    }

    /**
     * The lead steps off. Whoever is next moves out of job_technicians and onto the job itself —
     * their crew row goes FIRST, so a failure there leaves the old lead in place rather than
     * booking one person into both seats.
     */
    private fun promote(jobId: String, outgoing: String, next: String?) {
        if (next == null) {
            setLead(jobId, null)
            // Defensive: a job carrying the duplicated backfilled crew row the 29 July migration
            // is cleaning up (job_technicians used to gain a row for the lead too) would otherwise
            // have the outgoing lead reappear on the next refresh — roster() folds job_technicians
            // back in once the lead slot is empty. The composite key (job_id, app_user_id) makes
            // a redundant delete harmless when no such row exists.
            _s.update { it.copy(crew = it.crew - outgoing) }
            viewModelScope.launch { outbox.enqueueRemoveCrew(jobId, outgoing, "Remove technician") }
            return
        }
        _s.update { it.copy(crew = it.crew - next) }
        viewModelScope.launch {
            runCatching { api.removeJobTechnician(jobId, next) }
                .onSuccess { setLead(jobId, next) }
                .onFailure { e -> _s.update { st -> st.copy(crew = st.crew + next, error = e.uiMessage()) } }
        }
    }

    fun setCommentDraft(v: String) = _s.update { it.copy(commentDraft = v) }

    fun addComment(jobId: String) {
        val body = _s.value.commentDraft.trim()
        if (body.isBlank()) return
        _s.update { it.copy(commentBusy = true) }
        viewModelScope.launch {
            val tenant = catalog.tenantId()
            runCatching {
                requireNotNull(tenant) { "not synced" }
                api.addJobComment(
                    mu.carfection.pos.core.network.NewJobCommentDto(
                        tenantId = tenant, jobId = jobId, body = body,
                        createdBy = appUserId ?: api.currentAppUserId()?.also { appUserId = it },
                    ),
                )
            }.onSuccess {
                _s.update { it.copy(commentDraft = "", commentBusy = false) }
                loadJobDetail(jobId)
            }.onFailure { e -> _s.update { it.copy(commentBusy = false, error = e.uiMessage()) } }
        }
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
        if (_s.value.busy) return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.startJob(id, Instant.now().toString()) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Job started") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    // ── Reschedule a booking (date → time, same two-step as the quote screen) ───
    fun openReschedule() = _s.update { it.copy(reschedDateOpen = true, reschedDayMs = null) }
    fun closeReschedule() = _s.update { it.copy(reschedDateOpen = false, reschedTimeOpen = false, reschedDayMs = null) }

    /** Day chosen — the DatePicker hands back UTC midnight; keep just the calendar day. */
    fun pickRescheduleDate(utcMillis: Long) = _s.update {
        it.copy(reschedDayMs = utcMillis, reschedDateOpen = false, reschedTimeOpen = true)
    }

    /** Time chosen — combine with the held day in the device's zone, send to the server,
     *  reload (which re-arms the alarms from the new scheduled_at). */
    fun pickRescheduleTime(hour: Int, minute: Int) {
        val jobId = _s.value.activeJobId ?: return
        val dayMs = _s.value.reschedDayMs ?: return
        val day = Instant.ofEpochMilli(dayMs).atZone(ZoneOffset.UTC).toLocalDate()
        val iso = day.atTime(hour, minute).atZone(ZoneId.systemDefault()).toInstant().toString()
        _s.update { it.copy(reschedTimeOpen = false, reschedDayMs = null, busy = true) }
        viewModelScope.launch {
            runCatching { api.setJobSchedule(jobId, iso) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Rescheduled") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /**
     * Cancel a scheduled/in-progress job (owner/manager — the server enforces it). The
     * bill resolves in the same transaction: draft deleted, unpaid voided, paid money
     * refunded by a booked credit note.
     */
    fun cancelJob(reason: String) {
        val id = _s.value.activeJobId ?: return
        if (_s.value.busy) return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.cancelJob(id, reason) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Job cancelled — bill resolved") }; load() }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /**
     * Prepaid pickup: the bill was settled while the car was still being worked on, so
     * checkout has nothing left to collect — the handover is recorded straight from the
     * card. The server refuses unless the job is READY and its invoice is PAID.
     */
    fun deliverPaidJob() {
        val id = _s.value.activeJobId ?: return
        if (_s.value.busy) return
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.deliverPaidJob(id) }
                .onSuccess { _s.update { it.copy(busy = false, toast = "Delivered — car collected") }; load() }
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
        if (_s.value.busy) return
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
        if (_s.value.busy) return
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
                .onFailure { e ->
                    _s.update { it.copy(busy = false, error = e.uiMessage()) }
                    load() // re-sync: a half-applied sequence (pause folded, ready failed) must not retry from stale local state
                }
        }
    }

    /**
     * The job's priced invoice, created + issued exactly once.
     *
     * The quote id here is only a way in, never the price: convert_quote_to_invoice
     * re-resolves it to the quote the customer signed LAST for this job, so a car whose
     * quote was revised is billed at the figure they agreed, not the one they refused.
     *
     * Replay-safe on both layers: convert_quote_to_invoice hands back the live invoice if
     * there already is one, and the issue is keyed on the DOCUMENT rather than the quote.
     * Keying it on the quote meant that voiding a bill — an ordinary correction at the
     * counter — burned the key: the fresh invoice could never be issued under it, and the
     * job became permanently un-billable from the tablet.
     */
    private suspend fun ensureQuoteInvoice(quoteId: String) {
        val inv = api.convertQuoteToInvoice(quoteId)
        if (inv.status == null || inv.status == "draft") api.issueDocument(inv.id, "inv:${inv.id}")
    }

    /**
     * The ready job's bill. On a till this ensures the invoice exists and then walks the
     * operator to Checkout. On a quotation tablet the invoice is raised exactly the same —
     * that is reception's step, and it is what puts the bill in TO COLLECT — but there is
     * nowhere to walk to, so it says where the money is taken instead.
     */
    fun goToCheckout(onGo: () -> Unit) {
        val quotationOnly = !_s.value.takesPayments
        // On a till: close the sheet and walk to Checkout, exactly as before. On a quotation
        // tablet: stay put and say where the money is taken — closing the sheet would hide
        // the confirmation the operator needs to read.
        fun finish(closeSheet: Boolean) {
            // "The bill is at the till", not "invoice raised": two of the three paths here reach
            // this with an invoice that already existed, and the common one (a job marked ready
            // already auto-invoices) never raises anything. Both are true of the bill's location.
            if (quotationOnly) _s.update { it.copy(toast = "The bill is at the till — collect it there.") }
            else { if (closeSheet) close(); onGo() }
        }
        val job = active(_s.value) ?: run { finish(closeSheet = false); return }
        val quoteId = job.sourceQuoteId
        val hasLiveInvoice = job.invoices.any { it.docType == "invoice" && it.status != "void" && it.status != "draft" }
        if (quoteId == null || hasLiveInvoice) { finish(closeSheet = true); return }
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { ensureQuoteInvoice(quoteId) }
                .onSuccess { _s.update { it.copy(busy = false) }; finish(closeSheet = true) }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage("Couldn't create the invoice — check the connection and try again")) } }
        }
    }
}
