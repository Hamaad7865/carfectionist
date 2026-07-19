package mu.carfection.pos.core.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.storage.storage
import kotlin.time.Duration.Companion.minutes
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The POS ↔ backend seam. Every write goes through the SAME security-definer
 * RPCs the web app uses — the POS never re-implements an invariant, and the
 * idempotency keys make each call safe to replay (the outbox depends on this).
 */
@Singleton
class PosApi @Inject constructor(private val client: SupabaseClient) {

    // ── Reads (catalogue sync; RLS scopes everything to the tenant) ──────────
    suspend fun fetchProducts(): List<ProductDto> =
        client.postgrest.from("products")
            .select(Columns.raw("id, name, kind, selling_price, vat_rate, barcode, is_stocked, category, low_stock_threshold")) {
                filter { eq("is_active", true) }
            }
            .decodeList()

    suspend fun fetchCustomers(): List<CustomerDto> =
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone"))
            .decodeList()

    suspend fun fetchSettings(): BusinessSettingsDto =
        client.postgrest.from("business_settings")
            .select(Columns.raw("id, vat_rate, trading_name, brn, vat_number, address, phone, receipt_logo_path, receipt_footer_text")) { limit(1) }
            .decodeSingle()

    suspend fun findCustomerByName(name: String): CustomerDto? =
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone")) {
                filter { eq("name", name) }
                limit(1)
            }
            .decodeList<CustomerDto>()
            .firstOrNull()

    suspend fun insertCustomer(row: NewCustomerDto): CustomerDto =
        client.postgrest.from("customers")
            .insert(row) { select(Columns.raw("id, name, phone")) }
            .decodeSingle()

    suspend fun fetchVehicles(customerId: String): List<VehicleDto> =
        client.postgrest.from("vehicles")
            .select(Columns.raw("id, plate, make, model, color")) {
                filter { eq("customer_id", customerId) }
                order("plate", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    suspend fun insertVehicle(row: NewVehicleDto): VehicleDto =
        client.postgrest.from("vehicles")
            .insert(row) { select(Columns.raw("id, plate, make, model, color")) }
            .decodeSingle()

    // documents→documents is self-referencing, and PostgREST will NOT take a constraint-name
    // hint for that ("no relationship … using the hint documents_source_document_id_fkey") —
    // it wants the COLUMN. Getting this wrong 400s the whole call, and the quotes list just
    // renders empty. documents→jobs is a different pair and does need its FK named.
    // The job embed tells the list which quotes are finished business: once its car is
    // delivered, a quote drops out of the working list.
    suspend fun fetchQuotes(): List<QuoteRowDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("id, number, status, customer_id, vehicle_id, total_incl, updated_at, job_id, discount_kind, discount_value, intake, accepted_signature, invoices:documents!source_document_id(id, number, doc_type, status), job:jobs!documents_job_id_fkey(status), customers(name, email, phone), vehicles(plate, make, model)")) {
                filter { eq("doc_type", "quote") }
                order("updated_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(120) // deep enough that the search bar reaches past the last few days
            }
            .decodeList()

    suspend fun fetchQuoteLines(quoteId: String): List<QuoteLineDto> =
        client.postgrest.from("document_lines")
            .select(Columns.raw("product_id, title, description, qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate")) {
                filter { eq("document_id", quoteId) }
                order("sort_order", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    // ── Dashboard ─────────────────────────────────────────────────────────────────
    suspend fun fetchPaymentsSince(sinceIso: String): List<PaymentRowDto> =
        client.postgrest.from("payments")
            .select(Columns.raw("method, amount, received_at")) { filter { gte("received_at", sinceIso) } }
            .decodeList()

    suspend fun fetchOpenInvoices(): List<OpenInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("total_incl, amount_paid")) {
                filter { eq("doc_type", "invoice"); isIn("status", listOf("issued", "partly_paid")) }
            }
            .decodeList()

    suspend fun fetchPaidInvoicesWithLines(sinceIso: String): List<PaidInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("total_incl, job_id, origin, issued_at, document_lines(title, qty, unit_price, discount_pct, products(kind))")) {
                filter { eq("doc_type", "invoice"); eq("status", "paid"); gte("issued_at", sinceIso) }
            }
            .decodeList()

    // ── Certificates ──────────────────────────────────────────────────────────────
    /** Existing certificate numbers (to compute the next CERT-#### client-side). */
    suspend fun fetchCertNumbers(): List<CertNumberRow> =
        client.postgrest.from("certificates").select(Columns.raw("number")).decodeList()

    /** Issue a ceramic certificate (direct insert — the web app does the same; RLS scopes tenant). */
    suspend fun insertCertificate(row: NewCertificateDto): CertNumberRow =
        client.postgrest.from("certificates").insert(row) { select(Columns.raw("number")) }.decodeSingle()

    suspend fun fetchCertificates(): List<CertificateDto> =
        client.postgrest.from("certificates")
            .select(Columns.raw("id, number, applied_at, warranty_months, expires_at, notes, job_id, customers(name), vehicles(plate, make, model, color), products(name), applied_by:app_users!certificates_created_by_fkey(display_name)")) {
                order("applied_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
            }
            .decodeList()

    // ── Stock ─────────────────────────────────────────────────────────────────────
    suspend fun fetchStockProducts(): List<StockProductDto> =
        client.postgrest.from("products")
            .select(Columns.raw("id, name, category, barcode, selling_price, low_stock_threshold")) {
                filter { eq("is_active", true); eq("is_stocked", true) }
                order("name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    /**
     * On-hand per product. Pass [locationId] to see what is actually THERE.
     *
     * This used to sum every location, which reads as a bigger number than the
     * cashier can reach: the tablet sells from — and adjusts — the selling floor
     * only, so 5 at the Shop and 35 in the Warehouse showed as 40, and the
     * oversell warning stayed quiet while the Shop went negative. A second
     * warehouse would only widen that gap.
     */
    suspend fun fetchStockOnHand(locationId: String? = null): List<StockOnHandDto> =
        client.postgrest.from("stock_on_hand")
            .select(Columns.raw("product_id, location_id, qty_on_hand")) {
                if (locationId != null) filter { eq("location_id", locationId) }
            }
            .decodeList()

    /**
     * The selling-floor location id — the single resolver the counter write path
     * AND the shop-floor stock screen share, so every client moves the SAME
     * on-hand.
     *
     * is_sales_floor is asked FIRST because it is the only answer that is a fact:
     * matching the name 'Shop' meant renaming the location in the back office
     * would silently redirect the till's stock, and "the first non-default one"
     * became a coin flip the moment a second warehouse existed. Both survive
     * behind it only as fallbacks for a tenant whose flag was never set.
     *
     * Mirrors the web resolver in apps/web/src/lib/supabase/locations.ts.
     */
    suspend fun fetchShopLocationId(): String? {
        val locs = client.postgrest.from("stock_locations")
            .select(Columns.raw("id, name, is_default, is_sales_floor, is_active"))
            .decodeList<StockLocationDto>()
        return (locs.firstOrNull { it.isSalesFloor }
            ?: locs.firstOrNull { it.name == "Shop" }
            ?: locs.firstOrNull { !it.isDefault }
            ?: locs.firstOrNull { it.isDefault })?.id
    }

    /** Insert a signed adjustment movement (sm_insert RLS: adjustment + owner/manager). */
    suspend fun adjustStock(row: NewStockMovementDto) {
        client.postgrest.from("stock_movements").insert(row)
    }

    // ── Point of Sale device registry ────────────────────────────────────────────
    /**
     * Self-register this tablet (devices table). Launch → heartbeat=false, which
     * audits "terminal started" (+ "version changed" when the APK was updated);
     * the periodic foreground ping passes heartbeat=true and only touches
     * last_seen — that freshness drives the module's online dot.
     */
    suspend fun registerDevice(code: String, model: String?, version: String?, heartbeat: Boolean) {
        client.postgrest.rpc("register_device", buildJsonObject {
            put("p_code", code)
            if (model != null) put("p_model", model) else put("p_model", JsonNull)
            if (version != null) put("p_version", version) else put("p_version", JsonNull)
            put("p_heartbeat", heartbeat)
        })
    }

    /**
     * Petty cash out of the open till (Cashmag's "Autre" rows). The RPC enforces
     * the rules — open session, positive amount, reason, never more than the
     * drawer holds — and audits it with the device stamp. Idempotent.
     */
    suspend fun recordTillCashOut(sessionId: String, amountRupees: Double, reason: String, idempotencyKey: String) {
        client.postgrest.rpc("record_till_cash_out", buildJsonObject {
            put("p_session_id", sessionId)
            put("p_amount", amountRupees)
            put("p_reason", reason)
            put("p_idempotency_key", idempotencyKey)
        })
    }

    /**
     * Traceability event (ai_insert RLS: any tenant member may insert).
     * [id] makes a replay idempotent — the second insert of the same UUID hits the
     * primary key and proves the first landed. [createdAt] keeps the event stamped
     * at the moment it HAPPENED, not the moment a flaky network finally let it through.
     */
    suspend fun insertAuditEvent(
        tenantId: String,
        eventType: String,
        deviceId: String?,
        payload: JsonObject,
        id: String? = null,
        createdAt: String? = null,
    ) {
        client.postgrest.from("audit_events").insert(buildJsonObject {
            if (id != null) put("id", id)
            put("tenant_id", tenantId)
            put("event_type", eventType)
            if (deviceId != null) put("device_id", deviceId) else put("device_id", JsonNull)
            put("payload", payload)
            if (createdAt != null) put("created_at", createdAt)
        })
    }

    // ── Jobs board ──────────────────────────────────────────────────────────────
    // documents↔jobs have TWO relationships (documents.job_id AND
    // jobs.source_quote_id) — every embed between them MUST name its FK or
    // PostgREST refuses with "more than one relationship was found".
    suspend fun fetchJobs(): List<JobBoardDto> =
        client.postgrest.from("jobs")
            .select(Columns.raw("id, status, customer_id, vehicle_id, scheduled_at, started_at, ready_at, delivered_at, board_dismissed_at, paused_at, paused_ms, estimated_minutes, technician_id, notes, checklist, damage_markers, source_quote_id, customers(name, phone), vehicles(plate, make, model, color), technician:app_users!jobs_technician_id_fkey(display_name), source_quote:documents!jobs_source_quote_id_fkey(number, status, accepted_signature), invoices:documents!documents_job_id_fkey(id, number, doc_type, status), certificates(number, expires_at)")) {
                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
            }
            .decodeList()

    /**
     * When the car is booked in for, and how long it should take. Written when a quote
     * is accepted; drives the scheduled card, the estimated finish and the tablet's alarms.
     */
    suspend fun setJobSchedule(jobId: String, scheduledAtIso: String, estimatedMinutes: Int? = null) {
        client.postgrest.from("jobs").update({
            set("scheduled_at", scheduledAtIso)
            if (estimatedMinutes != null) set("estimated_minutes", estimatedMinutes)
        }) { filter { eq("id", jobId) } }
    }

    suspend fun setJobEstimate(jobId: String, estimatedMinutes: Int?) {
        client.postgrest.from("jobs").update({
            set("estimated_minutes", estimatedMinutes)
        }) { filter { eq("id", jobId) } }
    }

    /** The columns the alerts reason about — no embeds, so this stays cheap enough to run from a receiver. */
    private val ALERT_COLS = Columns.raw(
        "id, status, scheduled_at, started_at, ready_at, delivered_at, paused_at, paused_ms, " +
            "estimated_minutes, customers(name, phone), vehicles(plate, make, model, color)",
    )

    /**
     * One job, re-read at the moment an alarm fires. The alarm is only a trigger — this
     * is the truth. Without it a job started at 14:25 would still be announced as "due to
     * start" at 14:30, and staff would learn to ignore the alerts.
     */
    suspend fun fetchJobForAlert(jobId: String): JobBoardDto? =
        client.postgrest.from("jobs")
            .select(ALERT_COLS) { filter { eq("id", jobId) } }
            .decodeList<JobBoardDto>()
            .firstOrNull()

    /** Live work worth arming an alarm for: still to start, or running and not yet finished. */
    suspend fun fetchAlertableJobs(): List<JobBoardDto> =
        client.postgrest.from("jobs")
            .select(ALERT_COLS) {
                filter { isIn("status", listOf("scheduled", "in_progress")) }
            }
            .decodeList()

    /** Swipe a delivered card off the board. Board-only — the job, its invoice and its history stay. */
    suspend fun dismissJobCard(jobId: String, atIso: String) {
        client.postgrest.from("jobs").update({ set("board_dismissed_at", atIso) }) { filter { eq("id", jobId) } }
    }

    /** Scheduled → in progress. Stamps started_at once (RLS scopes the tenant). */
    suspend fun startJob(jobId: String, startedAtIso: String) {
        client.postgrest.from("jobs").update({
            set("status", "in_progress")
            set("started_at", startedAtIso)
        }) { filter { eq("id", jobId) } }
    }

    suspend fun assignTechnician(jobId: String, technicianId: String) {
        client.postgrest.from("jobs").update({ set("technician_id", technicianId) }) { filter { eq("id", jobId) } }
    }

    /**
     * Pause/resume the job timer. Pausing stamps paused_at; resuming clears it with the
     * finished pause folded into paused_ms (computed by the caller, so the write is idempotent).
     */
    suspend fun setJobPause(jobId: String, pausedAtIso: String?, pausedMs: Long) {
        client.postgrest.from("jobs").update({
            set("paused_at", pausedAtIso)
            set("paused_ms", pausedMs)
        }) { filter { eq("id", jobId) } }
    }

    suspend fun setChecklist(jobId: String, checklist: JsonArray) {
        client.postgrest.from("jobs").update({ set("checklist", checklist) }) { filter { eq("id", jobId) } }
    }

    // ── Job photos (before/after) ─────────────────────────────────────────────
    private val photoBucket get() = client.storage.from("vehicle-photos")

    suspend fun fetchJobPhotos(jobId: String): List<JobPhotoDto> =
        client.postgrest.from("job_photos")
            .select(Columns.raw("id, storage_path, phase, caption")) {
                filter { eq("job_id", jobId) }
                order("created_at", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    /** Upload bytes to `<tenant>/jobs/<jobId>/<phase>-<uuid>.jpg`, then record the row. */
    suspend fun uploadJobPhoto(tenantId: String, jobId: String, phase: String, bytes: ByteArray): JobPhotoDto {
        val path = "$tenantId/jobs/$jobId/$phase-${java.util.UUID.randomUUID()}.jpg"
        photoBucket.upload(path, bytes) { upsert = false }
        return client.postgrest.from("job_photos")
            .insert(NewJobPhotoDto(tenantId, jobId, path, phase)) { select(Columns.raw("id, storage_path, phase, caption")) }
            .decodeSingle()
    }

    /** Short-lived signed URL for the private bucket, so Coil can render the thumbnail. */
    suspend fun signedPhotoUrl(storagePath: String): String =
        photoBucket.createSignedUrl(storagePath, 60.minutes)

    /**
     * Intake condition photo — uploaded under the vehicle (there is no job yet); the
     * returned path is carried through the quote and rowed as a 'before' job photo when
     * the quote is accepted. Same bucket, same tenant-first RLS path rule.
     */
    suspend fun uploadIntakePhoto(tenantId: String, vehicleId: String, bytes: ByteArray): String {
        val path = "$tenantId/vehicles/$vehicleId/intake-${java.util.UUID.randomUUID()}.jpg"
        photoBucket.upload(path, bytes) { upsert = false }
        return path
    }

    /** Row an already-uploaded photo against a job (used when a quote becomes a job). */
    suspend fun insertJobPhotoRecord(tenantId: String, jobId: String, storagePath: String, phase: String) {
        client.postgrest.from("job_photos").insert(NewJobPhotoDto(tenantId, jobId, storagePath, phase))
    }

    /**
     * Client acceptance signature (PNG drawn on the tablet) — same private bucket
     * and tenant-first path rule as photos; the path is stamped onto the quote by
     * convert_quote_to_job in the acceptance transaction.
     */
    suspend fun uploadSignature(tenantId: String, bytes: ByteArray): String {
        val path = "$tenantId/signatures/sig-${java.util.UUID.randomUUID()}.png"
        photoBucket.upload(path, bytes) { upsert = false }
        return path
    }

    /** Stamp intake damage markers onto the job created from a quote. */
    suspend fun setJobDamageMarkers(jobId: String, markers: JsonArray) {
        client.postgrest.from("jobs").update({ set("damage_markers", markers) }) { filter { eq("id", jobId) } }
    }

    /** In progress → ready (complete_job also records any stock consumption). */
    suspend fun markJobReady(jobId: String) {
        client.postgrest.rpc("complete_job", buildJsonObject {
            put("p_job_id", jobId); put("p_location", JsonNull); put("p_consumptions", JsonArray(emptyList()))
        })
    }

    suspend fun fetchTechnicians(): List<TechnicianDto> =
        client.postgrest.from("app_users")
            .select(Columns.raw("id, display_name")) {
                filter { eq("role", "technician"); eq("is_active", true) }
            }
            .decodeList()

    /** Save the quote as a draft document (save_draft RPC). p_lines carry rupee prices. */
    suspend fun saveQuoteDraft(
        existingId: String?,
        customerId: String,
        vehicleId: String?,
        lines: JsonArray,
        discountKind: String? = null, // order-level: "percent" | "amount" | null (none)
        discountValue: Double = 0.0, // % 0..100, or Rs (VAT-inclusive)
    ): SavedDoc {
        val doc = buildJsonObject {
            if (existingId != null) put("id", existingId)
            put("doc_type", "quote")
            put("customer_id", customerId)
            if (vehicleId != null) put("vehicle_id", vehicleId) else put("vehicle_id", JsonNull)
            put("origin", "standalone")
            // Keys always present: the builder is authoritative for the order discount
            // (save_draft preserves them only when the keys are absent).
            if (discountKind != null) put("discount_kind", discountKind) else put("discount_kind", JsonNull)
            put("discount_value", discountValue)
        }
        return client.postgrest.rpc("save_draft", buildJsonObject {
            put("p_doc", doc); put("p_lines", lines); put("p_expected_rev", JsonNull)
        }).decodeAs()
    }

    /** Copy a quote into a new draft invoice (priced lines carried over). */
    suspend fun convertQuoteToInvoice(quoteId: String): SavedDoc =
        client.postgrest.rpc("convert_quote_to_invoice", buildJsonObject { put("p_quote_id", quoteId) }).decodeAs()

    /**
     * A fresh draft carrying the quote's lines and discount, linked back to it. The
     * original is never touched — what the customer signed stays exactly as they signed it.
     */
    suspend fun reviseQuote(quoteId: String): SavedDoc =
        client.postgrest.rpc("revise_quote", buildJsonObject { put("p_quote_id", quoteId) }).decodeAs()

    /** Create a job-linked draft document (invoice/quote) — one live doc per job per type. */
    suspend fun createDocumentFromJob(jobId: String, docType: String): SavedDoc =
        client.postgrest.rpc("create_document_from_job", buildJsonObject {
            put("p_job_id", jobId); put("p_doc_type", docType)
        }).decodeAs()

    /** Intake → "Start quotation": atomic job for the customer+vehicle (create_job RPC). */
    suspend fun createJob(customerId: String, vehicleId: String, service: String?, technicianId: String? = null): String =
        client.postgrest.rpc("create_job", buildJsonObject {
            put("p_customer_id", customerId)
            put("p_new_customer_name", JsonNull); put("p_new_customer_phone", JsonNull)
            put("p_vehicle_id", vehicleId)
            put("p_new_vehicle_plate", JsonNull); put("p_new_vehicle_make", JsonNull)
            if (service != null) put("p_service", service) else put("p_service", JsonNull)
            if (technicianId != null) put("p_technician_id", technicianId) else put("p_technician_id", JsonNull)
            put("p_department", JsonNull)
            put("p_checklist", JsonArray(emptyList()))
        }).decodeAs<JobRow>().id

    /**
     * Accept a quote → issue+accept it and spawn the linked job in one txn
     * (convert_quote_to_job RPC). Idempotent: a re-tap returns the same job, so
     * a draft can't be accepted twice. The RPC owns the customer/vehicle guards.
     * [signaturePath]/[signedName] carry the client's acceptance signature —
     * stamped onto the quote in the same transaction (server adds the timestamp).
     */
    suspend fun convertQuoteToJob(
        quoteId: String,
        technicianId: String? = null,
        scheduledAt: String? = null,
        signaturePath: String? = null,
        signedName: String? = null,
    ): String =
        client.postgrest.rpc("convert_quote_to_job", buildJsonObject {
            put("p_quote_id", quoteId)
            if (technicianId != null) put("p_technician_id", technicianId) else put("p_technician_id", JsonNull)
            if (scheduledAt != null) put("p_scheduled_at", scheduledAt) else put("p_scheduled_at", JsonNull)
            if (signaturePath != null) {
                put("p_signature", buildJsonObject {
                    put("path", signaturePath)
                    if (signedName != null) put("name", signedName)
                })
            } else put("p_signature", JsonNull)
        }).decodeAs<JobRow>().id

    // ── Writes — the shared RPCs (all invariants live server-side) ───────────

    /** Atomic draft upsert (doc + lines). Lines carry rupee prices, DB re-rounds. */
    suspend fun saveDraft(doc: kotlinx.serialization.json.JsonObject, lines: JsonArray): DocumentDto =
        client.postgrest.rpc("save_draft", buildJsonObject {
            put("p_doc", doc)
            put("p_lines", lines)
            put("p_expected_rev", JsonNull)
        }).decodeAs()

    /**
     * Assigns the gapless INV number + fires sale stock movements. Idempotent.
     * [stockLocationId] is the location the sale debits — counter sales pass the Shop;
     * null lets the RPC coalesce to the tenant default (Warehouse), which is what the
     * workshop quote→invoice / job→invoice paths want.
     */
    // [sessionId] is the service that rang the ticket — it is what puts the sale under
    // "Service 2" on the cash-up. A ticket issued with no till (a job billed in the
    // workshop) still lands in the day, just not in a service.
    suspend fun issueDocument(
        documentId: String,
        idempotencyKey: String,
        stockLocationId: String? = null,
        sessionId: String? = null,
    ): DocumentDto =
        client.postgrest.rpc("issue_document", buildJsonObject {
            put("p_document_id", documentId)
            if (stockLocationId != null) put("p_stock_location_id", stockLocationId) else put("p_stock_location_id", JsonNull)
            put("p_idempotency_key", idempotencyKey)
            if (sessionId != null) put("p_session_id", sessionId) else put("p_session_id", JsonNull)
        }).decodeAs()

    /** Records a payment + recomputes status. Idempotent. */
    suspend fun recordPayment(
        invoiceId: String,
        method: String, // cash | card | juice | bank_transfer
        amountRupees: Double,
        tenderedRupees: Double?,
        externalRef: String?,
        cashSessionId: String?,
        idempotencyKey: String,
    ): PaymentDto =
        client.postgrest.rpc("record_payment", buildJsonObject {
            put("p_invoice_id", invoiceId)
            put("p_method", method)
            put("p_amount", amountRupees)
            if (tenderedRupees != null) put("p_tendered", tenderedRupees) else put("p_tendered", JsonNull)
            if (externalRef != null) put("p_external_ref", externalRef) else put("p_external_ref", JsonNull)
            if (cashSessionId != null) put("p_cash_session_id", cashSessionId) else put("p_cash_session_id", JsonNull)
            put("p_payment_id", JsonNull)
            put("p_idempotency_key", idempotencyKey)
        }).decodeAs()

    /**
     * The car leaves ON ACCOUNT: delivers the bill's READY job without touching money —
     * the invoice stays outstanding (the customer's receivable). Returns false when there
     * was no ready job to move (already delivered, or a jobless invoice).
     */
    suspend fun deliverOnAccount(invoiceId: String): Boolean =
        client.postgrest.rpc("deliver_on_account", buildJsonObject {
            put("p_invoice_id", invoiceId)
        }).decodeAs()

    /** Prepaid pickup: the bill was settled before the car was ready — record the handover. */
    suspend fun deliverPaidJob(jobId: String): Boolean =
        client.postgrest.rpc("deliver_paid_job", buildJsonObject {
            put("p_job_id", jobId)
        }).decodeAs()

    /**
     * Cancel a scheduled/in-progress job (owner/manager). The server resolves its bill in
     * the same transaction: a draft is deleted, an unpaid bill voided, money already taken
     * comes back as a credit note with the refund booked to a till.
     */
    suspend fun cancelJob(jobId: String, reason: String) {
        client.postgrest.rpc("cancel_job", buildJsonObject {
            put("p_job_id", jobId)
            put("p_reason", reason)
            put("p_restock", true)
            put("p_session_id", JsonNull) // refund falls back to the till that took the money
        })
    }

    /** Walk back a MISTAKEN on-account handover: job returns to READY, the bill stays open. */
    suspend fun undoOnAccount(invoiceId: String): Boolean =
        client.postgrest.rpc("undo_on_account", buildJsonObject {
            put("p_invoice_id", invoiceId)
        }).decodeAs()

    // ── Checkout · collect on invoice ────────────────────────────────────────
    /** Invoices awaiting payment (issued or partly paid) — the "TO COLLECT" list. */
    suspend fun fetchOutstandingInvoices(): List<OutstandingInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("id, number, total_incl, amount_paid, status, job_id, customers(name), vehicles(plate, make, model)")) {
                filter { eq("doc_type", "invoice"); isIn("status", listOf("issued", "partly_paid")) }
                order("issued_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                // Auto-invoicing on "ready" makes outstanding invoices longer-lived; a low
                // cap silently hid the OLDEST (most overdue) bills once exceeded. 1000 is
                // PostgREST's page ceiling — far above any plausible open-bill count here.
                limit(1000)
            }
            .decodeList()

    /** Payments received since [sinceIso] with their doc + customer — the "PAID TODAY" list. */
    /** Includes reversal mirrors (negative rows) — the caller collapses
     *  reversed pairs so PAID TODAY only shows money that actually stands. */
    suspend fun fetchTodayPayments(sinceIso: String): List<TodayPaymentDto> =
        client.postgrest.from("payments")
            .select(Columns.raw("id, method, amount, document_id, reverses_payment_id, documents(number, customers(name))")) {
                filter { gte("received_at", sinceIso) }
                order("received_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(60)
            }
            .decodeList()

    // The slip needs the lines, the payments and who served — and the send dialog needs the
    // customer's email/phone to prefill. One shape, two callers (history, and a job's invoice).
    private val SALE_COLS =
        "id, number, status, issued_at, total_incl, vat_total, amount_paid, " +
            "customers(name, phone, email), creator:app_users!documents_created_by_fkey(display_name), " +
            "document_lines(title, qty, line_total_excl, line_vat, sort_order), " +
            "payments(method, amount, tendered, change_given, reverses_payment_id, received_at)"

    /** Past sales with lines + payments — the history list and its reprints. */
    suspend fun fetchSalesHistory(limit: Long = 60): List<SaleHistoryDto> =
        client.postgrest.from("documents")
            .select(Columns.raw(SALE_COLS)) {
                filter { eq("doc_type", "invoice"); neq("status", "draft") }
                order("issued_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(limit)
            }
            .decodeList()

    /** One invoice, rebuilt for viewing/printing/sending — the job sheet's "View invoice". */
    suspend fun fetchInvoice(id: String): SaleHistoryDto? =
        client.postgrest.from("documents")
            .select(Columns.raw(SALE_COLS)) { filter { eq("id", id) } }
            .decodeList<SaleHistoryDto>()
            .firstOrNull()

    // ── Corrections (owner/manager per the RPCs' require_role) ────────────────
    /** Void an unpaid/issued document (voids stock movements too). */
    suspend fun voidDocument(documentId: String, reason: String) {
        client.postgrest.rpc("void_document", buildJsonObject {
            put("p_id", documentId); put("p_reason", reason)
        })
    }

    /** Reverse a single payment (inserts the negative mirror; guarded server-side). */
    suspend fun reversePayment(paymentId: String, reason: String) {
        client.postgrest.rpc("reverse_payment", buildJsonObject {
            put("p_payment_id", paymentId); put("p_reason", reason)
        })
    }

    /**
     * Full-reversal credit note against a paid/issued invoice (optional restock).
     * [stockLocationId] is where restocked units land — counter refunds pass the Shop so
     * they return to the same on-hand the sale drew from; null falls back to the tenant default.
     */
    suspend fun issueCreditNote(invoiceId: String, restock: Boolean, stockLocationId: String? = null, sessionId: String? = null) {
        client.postgrest.rpc("create_and_issue_credit_note", buildJsonObject {
            put("p_invoice_id", invoiceId)
            if (stockLocationId != null) put("p_stock_location_id", stockLocationId) else put("p_stock_location_id", JsonNull)
            put("p_restock", restock)
            // The till the refund comes out of — a paid invoice's credit note books
            // negative payment mirrors here so the drawer and the Z see the money leave.
            if (sessionId != null) put("p_session_id", sessionId) else put("p_session_id", JsonNull)
        })
    }

    // ── Till ──────────────────────────────────────────────────────────────────
    suspend fun openCashSession(deviceId: String, openingFloatRupees: Double): CashSessionDto =
        client.postgrest.rpc("open_cash_session", buildJsonObject {
            put("p_device_id", deviceId)
            put("p_opening_float", openingFloatRupees)
        }).decodeAs()

    suspend fun closeCashSession(sessionId: String, closingCountRupees: Double): CashSessionDto =
        client.postgrest.rpc("close_cash_session", buildJsonObject {
            put("p_id", sessionId)
            put("p_closing_count", closingCountRupees)
        }).decodeAs()

    // ── Cashmag close: check the register, close the service, close the day ─────
    /** "Check your cash register before closing": per method, what was taken and what has piled up. */
    suspend fun preCloseSummary(sessionId: String): kotlinx.serialization.json.JsonObject =
        client.postgrest.rpc("pre_close_summary", buildJsonObject {
            put("p_session_id", sessionId)
        }).decodeAs()

    /** Closes the service, banks the ticked methods, and cuts the Z. [remit] = ticked methods. */
    suspend fun closeService(
        sessionId: String,
        countedCashRupees: Double,
        remit: List<String>,
        note: String?,
    ): ZReportDto =
        client.postgrest.rpc("close_service", buildJsonObject {
            put("p_session_id", sessionId)
            put("p_counted_cash", countedCashRupees)
            put("p_remit", kotlinx.serialization.json.JsonArray(remit.map { kotlinx.serialization.json.JsonPrimitive(it) }))
            if (note.isNullOrBlank()) put("p_note", JsonNull) else put("p_note", note)
        }).decodeAs()

    /** Seals the day. Every till must be closed first; afterwards no money can be taken. */
    suspend fun closeDay(dayId: String): ZReportDto =
        client.postgrest.rpc("close_day", buildJsonObject { put("p_day_id", dayId) }).decodeAs()

    // ── Till Z-report (Clôture de période) ────────────────────────────────────
    /** Every payment of a till session with its document, lines and product categories. */
    suspend fun fetchSessionPayments(sessionId: String): List<ZPaymentDto> =
        client.postgrest.from("payments")
            .select(
                Columns.raw(
                    "id, method, amount, change_given, reverses_payment_id, received_by, " +
                        "documents(id, number, total_incl, vat_total, subtotal_excl, " +
                        "document_lines(qty, line_total_excl, line_vat, products(category)))",
                ),
            ) { filter { eq("cash_session_id", sessionId) } }
            .decodeList()

    suspend fun fetchUserNames(): List<UserNameDto> =
        client.postgrest.from("app_users").select(Columns.raw("id, display_name")).decodeList()

    /** Unpaid/partly-paid invoices issued inside the session window — the slip's on-account block. */
    suspend fun fetchOnAccountBetween(fromIso: String, toIso: String): List<OpenInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("total_incl, amount_paid")) {
                filter {
                    eq("doc_type", "invoice")
                    isIn("status", listOf("issued", "partly_paid"))
                    gte("created_at", fromIso)
                    lte("created_at", toIso)
                }
            }
            .decodeList()

    suspend fun openSessionForDevice(deviceId: String): CashSessionDto? =
        client.postgrest.from("cash_sessions")
            .select(Columns.raw("id, status, device_id, opening_float, opened_at, closing_count, expected_cash, variance")) {
                filter {
                    eq("status", "open")
                    eq("device_id", deviceId)
                }
                limit(1)
            }
            .decodeList<CashSessionDto>()
            .firstOrNull()
}
