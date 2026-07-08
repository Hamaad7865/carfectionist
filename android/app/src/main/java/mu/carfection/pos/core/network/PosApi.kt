package mu.carfection.pos.core.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
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
            .select(Columns.raw("id, vat_rate, trading_name, brn, vat_number, address")) { limit(1) }
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

    suspend fun fetchQuotes(): List<QuoteRowDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("id, number, status, customer_id, vehicle_id, total_incl, updated_at, customers(name), vehicles(plate, make, model)")) {
                filter { eq("doc_type", "quote") }
                order("updated_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(30)
            }
            .decodeList()

    suspend fun fetchQuoteLines(quoteId: String): List<QuoteLineDto> =
        client.postgrest.from("document_lines")
            .select(Columns.raw("product_id, title, description, qty, unit_price, discount_pct, vat_rate")) {
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
            .select(Columns.raw("total_incl, job_id, document_lines(title, qty, unit_price, discount_pct)")) {
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
            .select(Columns.raw("id, name, category, selling_price, low_stock_threshold")) {
                filter { eq("is_active", true); eq("is_stocked", true) }
                order("name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    suspend fun fetchStockOnHand(): List<StockOnHandDto> =
        client.postgrest.from("stock_on_hand")
            .select(Columns.raw("product_id, qty_on_hand"))
            .decodeList()

    suspend fun fetchDefaultLocationId(): String? =
        client.postgrest.from("stock_locations")
            .select(Columns.raw("id")) { filter { eq("is_default", true) }; limit(1) }
            .decodeList<StockLocationDto>()
            .firstOrNull()?.id

    /** Insert a signed adjustment movement (sm_insert RLS: adjustment + owner/manager). */
    suspend fun adjustStock(row: NewStockMovementDto) {
        client.postgrest.from("stock_movements").insert(row)
    }

    // ── Jobs board ──────────────────────────────────────────────────────────────
    suspend fun fetchJobs(): List<JobBoardDto> =
        client.postgrest.from("jobs")
            .select(Columns.raw("id, status, customer_id, vehicle_id, scheduled_at, started_at, ready_at, delivered_at, technician_id, notes, checklist, damage_markers, customers(name, phone), vehicles(plate, make, model, color), technician:app_users!jobs_technician_id_fkey(display_name)")) {
                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
            }
            .decodeList()

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

    suspend fun setChecklist(jobId: String, checklist: JsonArray) {
        client.postgrest.from("jobs").update({ set("checklist", checklist) }) { filter { eq("id", jobId) } }
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
    suspend fun saveQuoteDraft(existingId: String?, customerId: String, vehicleId: String?, lines: JsonArray): SavedDoc {
        val doc = buildJsonObject {
            if (existingId != null) put("id", existingId)
            put("doc_type", "quote")
            put("customer_id", customerId)
            if (vehicleId != null) put("vehicle_id", vehicleId) else put("vehicle_id", JsonNull)
            put("origin", "standalone")
        }
        return client.postgrest.rpc("save_draft", buildJsonObject {
            put("p_doc", doc); put("p_lines", lines); put("p_expected_rev", JsonNull)
        }).decodeAs()
    }

    /** Copy a quote into a new draft invoice (priced lines carried over). */
    suspend fun convertQuoteToInvoice(quoteId: String): SavedDoc =
        client.postgrest.rpc("convert_quote_to_invoice", buildJsonObject { put("p_quote_id", quoteId) }).decodeAs()

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

    // ── Writes — the shared RPCs (all invariants live server-side) ───────────

    /** Atomic draft upsert (doc + lines). Lines carry rupee prices, DB re-rounds. */
    suspend fun saveDraft(doc: kotlinx.serialization.json.JsonObject, lines: JsonArray): DocumentDto =
        client.postgrest.rpc("save_draft", buildJsonObject {
            put("p_doc", doc)
            put("p_lines", lines)
            put("p_expected_rev", JsonNull)
        }).decodeAs()

    /** Assigns the gapless INV number + fires sale stock movements. Idempotent. */
    suspend fun issueDocument(documentId: String, idempotencyKey: String): DocumentDto =
        client.postgrest.rpc("issue_document", buildJsonObject {
            put("p_document_id", documentId)
            put("p_stock_location_id", JsonNull)
            put("p_idempotency_key", idempotencyKey)
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

    // ── Checkout · collect on invoice ────────────────────────────────────────
    /** Invoices awaiting payment (issued or partly paid) — the "TO COLLECT" list. */
    suspend fun fetchOutstandingInvoices(): List<OutstandingInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("id, number, total_incl, amount_paid, status, job_id, customers(name), vehicles(plate, make, model)")) {
                filter { eq("doc_type", "invoice"); isIn("status", listOf("issued", "partly_paid")) }
                order("issued_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(40)
            }
            .decodeList()

    /** Payments received since [sinceIso] with their doc + customer — the "PAID TODAY" list. */
    suspend fun fetchTodayPayments(sinceIso: String): List<TodayPaymentDto> =
        client.postgrest.from("payments")
            .select(Columns.raw("id, method, amount, document_id, reverses_payment_id, documents(number, customers(name))")) {
                filter { gte("received_at", sinceIso); gt("amount", 0) }
                order("received_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(30)
            }
            .decodeList()

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

    /** Full-reversal credit note against a paid/issued invoice (optional restock). */
    suspend fun issueCreditNote(invoiceId: String, restock: Boolean) {
        client.postgrest.rpc("create_and_issue_credit_note", buildJsonObject {
            put("p_invoice_id", invoiceId); put("p_stock_location_id", JsonNull); put("p_restock", restock)
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
