package mu.carfection.pos.core.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
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
            .select(Columns.raw("id, name, kind, selling_price, vat_rate, barcode, is_stocked, category, low_stock_threshold, photo_path")) {
                filter { eq("is_active", true) }
            }
            .decodeList()

    suspend fun fetchCustomers(): List<CustomerDto> =
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone"))
            .decodeList()

    suspend fun fetchSettings(): BusinessSettingsDto =
        client.postgrest.from("business_settings")
            .select(Columns.raw("id, vat_rate, trading_name, brn, vat_number, address, phone, receipt_logo_path, receipt_footer_text, prices_vat_exclusive")) { limit(1) }
            .decodeSingle()

    /**
     * Customers matching free text, asked of the SERVER.
     *
     * The tablet searches its local cache first, but that cache is only as fresh as the last
     * sync — a customer added on the web, on the other tablet, or moments ago on this one
     * simply is not in it. Falling back here is what stops staff concluding "not in the
     * system" and creating a duplicate.
     */
    suspend fun searchCustomers(term: String, limit: Long = 8): List<CustomerDto> = runCatching {
        val safe = term.trim().replace("%", "").replace(",", " ")
        if (safe.length < 2) return@runCatching emptyList()
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone")) {
                filter { or { ilike("name", "%$safe%"); ilike("phone", "%$safe%") } }
                order("name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                limit(limit)
            }
            .decodeList<CustomerDto>()
    }.getOrDefault(emptyList())

    /**
     * Customers who own a vehicle matching this plate.
     *
     * Intake's search box has always invited "name, phone or plate", but only name and phone
     * were ever matched — so looking a returning customer up by the registration in front of
     * you found nothing, which is one way staff end up creating a duplicate.
     */
    suspend fun searchCustomersByPlate(plate: String, limit: Long = 6): List<CustomerDto> = runCatching {
        val safe = plate.trim().replace("%", "").replace(",", " ")
        if (safe.length < 2) return@runCatching emptyList()
        client.postgrest.from("vehicles")
            .select(Columns.raw("plate, customers(id, name, phone)")) {
                filter { ilike("plate", "%$safe%") }
                limit(limit)
            }
            .decodeList<PlateCustomerDto>()
            .mapNotNull { it.customers }
    }.getOrDefault(emptyList())

    /**
     * The customer already on file under this name or this phone, if there is one.
     *
     * Nothing in the schema stops the same person being created twice — the unique index is on
     * the PLATE, not the person — so the second attempt succeeds and only the car is refused.
     * That is what has produced every duplicate so far: staff get past the plate rejection by
     * typing one that is not real, and the job ends up on the wrong record. Asking first is what
     * stops it.
     *
     * Phone is the stronger signal and is matched exactly; the name is matched case- and
     * spacing-insensitively, because "Yan  Toinette" and "yan toinette" are one person.
     */
    suspend fun findExistingCustomer(name: String, phone: String?): CustomerDto? = runCatching {
        val n = name.trim()
        val p = phone?.trim()?.takeIf { it.isNotBlank() }
        if (n.isBlank() && p == null) return@runCatching null
        val hits = client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone")) {
                filter {
                    or {
                        if (p != null) eq("phone", p)
                        ilike("name", n)
                    }
                }
                limit(5)
            }
            .decodeList<CustomerDto>()
        val squash = { s: String -> s.trim().lowercase().replace(Regex("\\s+"), " ") }
        hits.firstOrNull { it.phone?.trim() == p && p != null } ?: hits.firstOrNull { squash(it.name) == squash(n) }
    }.getOrNull()

    /** Who already holds this plate — so a duplicate-plate error can name them. */
    suspend fun vehicleOwnerByPlate(plate: String): String? = runCatching {
        client.postgrest.from("vehicles")
            .select(Columns.raw("plate, customers(name)")) {
                filter { ilike("plate", plate.trim()) }
                limit(1)
            }
            .decodeList<PlateOwnerDto>().firstOrNull()?.customers?.name
    }.getOrNull()

    /**
     * The whole record behind a taken plate — the customer AND the car.
     *
     * Naming the owner in an error message was still a dead end: staff standing in front of a
     * customer are not going to back out of the form and search, they are going to type a plate
     * that gets accepted. Returning the ids lets the app just take them there.
     */
    suspend fun plateHolder(plate: String): PlateHolder? = runCatching {
        client.postgrest.from("vehicles")
            .select(Columns.raw("id, plate, make, model, color, category, customers(id, name, phone)")) {
                filter { ilike("plate", plate.trim()); eq("is_active", true) }
                limit(1)
            }
            .decodeList<PlateHolderDto>().firstOrNull()?.let { row ->
                val cust = row.customers ?: return@let null
                PlateHolder(
                    customer = cust,
                    vehicle = VehicleDto(row.id, row.plate ?: "", row.make, row.model, row.color, row.category),
                )
            }
    }.getOrNull()

    suspend fun findCustomerByName(name: String): CustomerDto? =
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone")) {
                filter { eq("name", name) }
                limit(1)
            }
            .decodeList<CustomerDto>()
            .firstOrNull()

    /**
     * Create a customer under an id the TABLET minted — the offline path, where the server
     * could not be asked for one. Explicit DTO rather than an optional id on [NewCustomerDto]
     * so the id is always on the wire and never depends on how defaults get encoded.
     * A replay collides with its own row on the primary key; the caller reads that as landed.
     */
    suspend fun insertCustomerWithId(id: String, tenantId: String, name: String): CustomerDto =
        client.postgrest.from("customers")
            .insert(NewCustomerWithIdDto(id = id, tenantId = tenantId, name = name)) {
                select(Columns.raw("id, name, phone, email"))
            }
            .decodeSingle()

    suspend fun insertCustomer(row: NewCustomerDto): CustomerDto =
        client.postgrest.from("customers")
            // email too — a business customer typed at Intake has to carry it into the
            // quote's send dialog, not just onto the record.
            .insert(row) { select(Columns.raw("id, name, phone, email")) }
            .decodeSingle()

    suspend fun fetchVehicles(customerId: String): List<VehicleDto> =
        client.postgrest.from("vehicles")
            .select(Columns.raw("id, plate, make, model, color, category")) {
                filter { eq("customer_id", customerId) }
                order("plate", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    suspend fun insertVehicle(row: NewVehicleDto): VehicleDto =
        client.postgrest.from("vehicles")
            .insert(row) { select(Columns.raw("id, plate, make, model, color, category")) }
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

    /**
     * Every column QuoteLineDto declares — and it must stay that way.
     *
     * PostgREST returns only what is asked for, so a field missing here decodes as
     * null, and save_draft then writes that null back over a real value. That is
     * exactly how description_richtext and unit_label were erased on the first
     * end-to-end run: the DTO knew about them, the payload carried them, and this
     * list did not mention them. QuoteLineColumnsTest pins the two together.
     */
    suspend fun fetchQuoteLines(quoteId: String): List<QuoteLineDto> =
        client.postgrest.from("document_lines")
            .select(Columns.raw(QUOTE_LINE_COLUMNS)) {
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
            .select(Columns.raw("id, name, category, barcode, selling_price, vat_rate, low_stock_threshold, photo_path")) {
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
    /**
     * Recent stock adjustments for the printable log — newest first, with the product,
     * the location and (where stamped) who made it.
     */
    suspend fun fetchStockAdjustments(
        limit: Long = 200,
        fromIso: String? = null,
        toIso: String? = null,
    ): List<StockAdjustmentDto> =
        client.postgrest.from("stock_movements")
            .select(
                Columns.raw(
                    "id, qty, note, moved_at, products(name), stock_locations(name), " +
                        "creator:app_users!stock_movements_created_by_fkey(display_name)",
                ),
            ) {
                filter {
                    eq("ref_type", "adjustment")
                    // Bounds are MU-local day edges resolved by the caller, so "today" means
                    // the shop's today rather than UTC's.
                    if (fromIso != null) gte("moved_at", fromIso)
                    if (toIso != null) lte("moved_at", toIso)
                }
                order("moved_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(limit)
            }
            .decodeList()

    /**
     * This operator's app_users row id, for stamping what they write. The JWT carries a
     * name and a role but not this id, so stock adjustments landed with created_by null
     * and the ledger could not say who moved the stock.
     */
    suspend fun currentAppUserId(): String? = runCatching {
        val uid = client.auth.currentUserOrNull()?.id ?: return@runCatching null
        client.postgrest.from("app_users")
            .select(Columns.raw("id")) { filter { eq("auth_user_id", uid) }; limit(1) }
            .decodeList<AppUserIdDto>().firstOrNull()?.id
    }.getOrNull()

    suspend fun adjustStock(row: NewStockMovementDto) {
        client.postgrest.from("stock_movements").insert(row)
    }

    // ── Point of Sale device registry ────────────────────────────────────────────
    /**
     * Self-register this tablet (devices table). Launch → heartbeat=false, which
     * audits "terminal started" (+ "version changed" when the APK was updated);
     * the periodic foreground ping passes heartbeat=true and only touches
     * last_seen — that freshness drives the module's online dot.
     *
     * Returns the device row so the caller can read its role (takes_payments). Decoding is
     * tolerant on purpose: registration is an observation and the row is written server-side
     * either way, so a shape we cannot parse must not read as a failed registration.
     */
    suspend fun registerDevice(
        code: String,
        model: String?,
        version: String?,
        heartbeat: Boolean,
    ): JsonObject? {
        val res = client.postgrest.rpc("register_device", buildJsonObject {
            put("p_code", code)
            if (model != null) put("p_model", model) else put("p_model", JsonNull)
            if (version != null) put("p_version", version) else put("p_version", JsonNull)
            put("p_heartbeat", heartbeat)
        })
        return runCatching { res.decodeAs<JsonObject>() }.getOrNull()
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
        // What the event is ABOUT — e.g. ("invoice", documentId). receiptPrintCount reads this
        // back to count "Duplicata N"; an event with no ref_id is invisible to that count.
        refType: String? = null,
        refId: String? = null,
    ) {
        client.postgrest.from("audit_events").insert(buildJsonObject {
            if (id != null) put("id", id)
            put("tenant_id", tenantId)
            put("event_type", eventType)
            if (deviceId != null) put("device_id", deviceId) else put("device_id", JsonNull)
            put("payload", payload)
            if (createdAt != null) put("created_at", createdAt)
            if (refType != null) put("ref_type", refType) else put("ref_type", JsonNull)
            if (refId != null) put("ref_id", refId) else put("ref_id", JsonNull)
        })
    }

    /**
     * "No. 11" — this sale's position within the till session. Counted from the payments
     * booked to the session, so a reprint of an old sale still shows the number it had.
     * Returns null rather than a wrong number if the count can't be read.
     */
    suspend fun sessionTicketNo(cashSessionId: String, documentId: String): Int? = runCatching {
        val ids = client.postgrest.from("payments")
            .select(Columns.raw("document_id, received_at")) {
                filter { eq("booked_session_id", cashSessionId) }
                order("received_at", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList<PaymentDocRefDto>()
            .map { it.documentId }
            .distinct()
        val idx = ids.indexOf(documentId)
        if (idx >= 0) idx + 1 else null
    }.getOrNull()

    /**
     * The customer never came back. An accepted quote carries a number and a signature, so it
     * is VOIDED rather than erased — the record of what was agreed survives, it just stops
     * reading as live work. The RPC refuses one with a live job or a live invoice.
     */
    /** The customer said no. A lost sale, not cancelled paperwork — see void_quote for that. */
    suspend fun declineQuote(quoteId: String, reason: String? = null) {
        client.postgrest.rpc("decline_quote", buildJsonObject {
            put("p_quote_id", quoteId)
            if (reason != null) put("p_reason", reason) else put("p_reason", JsonNull)
        })
    }

    suspend fun voidQuote(quoteId: String, reason: String? = null) {
        client.postgrest.rpc("void_quote", buildJsonObject {
            put("p_quote_id", quoteId)
            if (reason != null) put("p_reason", reason) else put("p_reason", JsonNull)
        })
    }

    /** The internal order reference for a just-issued sale — the slip's "Bill" line. */
    suspend fun billNoFor(documentId: String): Long? = runCatching {
        client.postgrest.from("documents")
            .select(Columns.raw("bill_no")) { filter { eq("id", documentId) } }
            .decodeList<BillNoDto>().firstOrNull()?.billNo
    }.getOrNull()

    /**
     * "Appareil 1" — this tablet's ordinal in the studio's device registry (registration
     * order), so two terminals print distinguishable slips.
     */
    suspend fun terminalNo(deviceCode: String): Int? = runCatching {
        client.postgrest.from("devices")
            .select(Columns.raw("device_code, first_seen")) {
                // ACTIVE terminals only, oldest first — the same list the back office counts.
                // Without this filter a retired tablet (registered before both live ones) shifts
                // every ordinal, and the paper slip would say "Appareil 2" where the web copy of
                // the same sale says "Appareil 1".
                filter { eq("is_active", true) }
                order("first_seen", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList<DeviceOrdinalDto>()
            .indexOfFirst { it.deviceCode == deviceCode }
            .takeIf { it >= 0 }?.plus(1)
    }.getOrNull()

    /**
     * How many times this sale's receipt has already been printed — the slip's "Duplicata N".
     * Read from the audit trail rather than a local counter so the number survives a reboot,
     * a different tablet, and the back office printing a copy. 0 = never printed = the original.
     */
    suspend fun receiptPrintCount(documentId: String): Int = runCatching {
        client.postgrest.from("audit_events")
            .select(Columns.raw("id")) {
                filter { eq("ref_id", documentId); eq("event_type", "receipt_printed") }
            }
            .decodeList<kotlinx.serialization.json.JsonObject>().size
    }.getOrDefault(0)

    // ── Jobs board ──────────────────────────────────────────────────────────────
    // documents↔jobs have TWO relationships (documents.job_id AND
    // jobs.source_quote_id) — every embed between them MUST name its FK or
    // PostgREST refuses with "more than one relationship was found".
    suspend fun fetchJobs(): List<JobBoardDto> =
        client.postgrest.from("jobs")
            .select(Columns.raw("id, status, customer_id, vehicle_id, scheduled_at, started_at, ready_at, delivered_at, cancelled_at, cancel_reason, board_dismissed_at, paused_at, paused_ms, estimated_minutes, technician_id, notes, checklist, damage_markers, source_quote_id, customers(name, phone), vehicles(plate, make, model, color), technician:app_users!jobs_technician_id_fkey(display_name), source_quote:documents!jobs_source_quote_id_fkey(number, status, accepted_signature), invoices:documents!documents_job_id_fkey(id, number, doc_type, status), certificates(number, expires_at)")) {
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

    suspend fun assignTechnician(jobId: String, technicianId: String?) {
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

    /**
     * Ordered, and it matters: these come back as a row of tap targets that re-fetches whenever
     * a screen is entered. Postgres does not promise a stable order without ORDER BY, so an
     * unordered list can reshuffle under a finger already on its way down and put the wrong
     * person on the car.
     */
    suspend fun fetchTechnicians(): List<TechnicianDto> =
        client.postgrest.from("app_users")
            .select(Columns.raw("id, display_name")) {
                filter { eq("role", "technician"); eq("is_active", true) }
                order("display_name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    /**
     * Discard a DRAFT document, lines and all.
     *
     * Safe by construction rather than by trust: the doc_delete RLS policy already allows a
     * delete only when status = 'draft' and the caller is owner/manager/cashier, so an issued
     * quote or invoice cannot be removed even if this were called with its id. document_lines
     * cascade; anything with a job or a payment hanging off it fails on its foreign key rather
     * than silently shedding history.
     */
    suspend fun deleteDraftDocument(id: String) {
        client.postgrest.from("documents").delete { filter { eq("id", id); eq("status", "draft") } }
    }

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
    /**
     * The customer agreed the price and signed — and nothing goes on the board.
     *
     * Accepting and STARTING THE WORK are separate decisions: a quote accepted today for work
     * booked next month should not put a car in the bay tonight. The job can be raised from
     * this same quote whenever they actually turn up.
     */
    /** [agreedVia] records a customer who agreed WITHOUT the pad — "whatsapp", "phone",
     *  "email", "counter". The quote is just as accepted; the evidence is the channel and
     *  the name instead of a drawn signature. */
    suspend fun acceptQuoteOnly(quoteId: String, signaturePath: String? = null, signedName: String? = null, agreedVia: String? = null) {
        client.postgrest.rpc("accept_quote", buildJsonObject {
            put("p_quote_id", quoteId)
            if (signaturePath != null || agreedVia != null) {
                put("p_signature", buildJsonObject {
                    if (signaturePath != null) put("path", signaturePath)
                    if (agreedVia != null) put("via", agreedVia)
                    if (signedName != null) put("name", signedName)
                })
            } else {
                put("p_signature", JsonNull)
            }
        })
    }

    suspend fun convertQuoteToJob(
        quoteId: String,
        technicianId: String? = null,
        scheduledAt: String? = null,
        signaturePath: String? = null,
        signedName: String? = null,
        agreedVia: String? = null,
    ): String =
        client.postgrest.rpc("convert_quote_to_job", buildJsonObject {
            put("p_quote_id", quoteId)
            if (technicianId != null) put("p_technician_id", technicianId) else put("p_technician_id", JsonNull)
            if (scheduledAt != null) put("p_scheduled_at", scheduledAt) else put("p_scheduled_at", JsonNull)
            if (signaturePath != null || agreedVia != null) {
                put("p_signature", buildJsonObject {
                    if (signaturePath != null) put("path", signaturePath)
                    if (agreedVia != null) put("via", agreedVia)
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
     * Cancel a job that hasn't been handed over — scheduled, in progress or ready
     * (owner/manager). The server resolves its bill in
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
    /**
     * NAMED relationship on purpose. There are TWO foreign keys between documents and jobs —
     * documents.job_id → jobs, and jobs.source_quote_id → documents — so a bare `jobs(...)`
     * embed is ambiguous and PostgREST refuses the WHOLE query with PGRST201. The caller
     * swallows failures into an empty list, so that refusal did not look like an error: it
     * looked like nothing was owed, and TO COLLECT sat empty with real money in it.
     */
    suspend fun fetchOutstandingInvoices(): List<OutstandingInvoiceDto> =
        client.postgrest.from("documents")
            .select(Columns.raw("id, number, total_incl, amount_paid, status, job_id, issued_at, jobs!documents_job_id_fkey(status), customers(name), vehicles(plate, make, model)")) {
                // 'draft' belongs here now: a quoted job's bill is raised when the car is
                // marked ready and left OPEN, so the counter can add whatever the customer
                // picked up on their way out. It is issued as they pay. Callers drop the
                // drafts that did not come from a job — an abandoned back-office draft is
                // not something the till should be offering to collect.
                filter { eq("doc_type", "invoice"); isIn("status", listOf("draft", "issued", "partly_paid")) }
                order("issued_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                // Auto-invoicing on "ready" makes outstanding invoices longer-lived; a low
                // cap silently hid the OLDEST (most overdue) bills once exceeded. 1000 is
                // PostgREST's page ceiling — far above any plausible open-bill count here.
                limit(1000)
            }
            .decodeList()

    /**
     * One job's service description (notes + checklist) — the payment screen's "what was this
     * for" detail on a collect. Scoped narrow on purpose: fetchJobs()/JobBoardDto pulls the whole
     * board; the bill panel only needs the fields that explain the service performed.
     */
    suspend fun fetchJobDetail(jobId: String): JobServiceDetailDto? =
        client.postgrest.from("jobs")
            .select(Columns.raw("id, notes, checklist")) { filter { eq("id", jobId) } }
            .decodeList<JobServiceDetailDto>()
            .firstOrNull()

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
        "id, number, doc_type, status, issued_at, total_incl, vat_total, amount_paid, " +
            "customers(name, phone, email), creator:app_users!documents_created_by_fkey(display_name), " +
            "bill_no, " +
            "document_lines(title, qty, line_total_excl, line_vat, sort_order, unit_price, vat_rate, discount_kind, discount_pct, discount_amount), " +
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

    /**
     * One document looked up by the number PRINTED on it — what the receipt's CODE128
     * barcode encodes. Scanning an old slip pulls the whole sale back up.
     */
    suspend fun fetchDocumentByNumber(number: String): SaleHistoryDto? =
        client.postgrest.from("documents")
            .select(Columns.raw(SALE_COLS)) { filter { eq("number", number) }; limit(1) }
            .decodeList<SaleHistoryDto>()
            .firstOrNull()

    /** One invoice, rebuilt for viewing/printing/sending — the job sheet's "View invoice". */
    suspend fun fetchInvoice(id: String): SaleHistoryDto? =
        client.postgrest.from("documents")
            .select(Columns.raw(SALE_COLS)) { filter { eq("id", id) } }
            .decodeList<SaleHistoryDto>()
            .firstOrNull()

    // ── Staff / technicians ───────────────────────────────────────────────────
    /** Everyone who can be put on a job. Technicians first, then anyone else who works on cars. */
    suspend fun fetchStaff(includeInactive: Boolean = false): List<StaffDto> =
        client.postgrest.from("app_users")
            .select(Columns.raw("id, display_name, role, is_active")) {
                filter { if (!includeInactive) eq("is_active", true) }
                order("display_name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList()

    /**
     * Add a technician — via RPC, not a direct insert.
     *
     * app_users has NO insert policy and an OWNER-only update policy, so writing it from the
     * tablet failed with "new row violates row-level security policy". Opening the table up was
     * the wrong fix: it holds roles and PIN hashes, and a client that can write it can escalate
     * its own role. The RPC is SECURITY DEFINER, checks owner/manager itself, and can only ever
     * touch technicians who have no login.
     */
    suspend fun insertStaff(row: NewStaffDto): StaffDto =
        client.postgrest.rpc("add_technician", buildJsonObject { put("p_name", row.displayName) }).decodeAs()

    suspend fun renameStaff(id: String, name: String) {
        client.postgrest.rpc("rename_technician", buildJsonObject { put("p_id", id); put("p_name", name) })
    }

    /** Retire/restore. Never a delete: past jobs reference them and must keep reading. */
    suspend fun setStaffActive(id: String, active: Boolean) {
        client.postgrest.rpc("set_technician_active", buildJsonObject { put("p_id", id); put("p_active", active) })
    }

    // ── A job's crew (several technicians) ────────────────────────────────────
    suspend fun fetchJobCrew(jobId: String): List<JobCrewDto> =
        client.postgrest.from("job_technicians")
            .select(Columns.raw("app_user_id, app_users(display_name)")) { filter { eq("job_id", jobId) } }
            .decodeList()

    suspend fun addJobTechnician(tenantId: String, jobId: String, appUserId: String) {
        client.postgrest.from("job_technicians").insert(JobTechLinkDto(jobId, appUserId, tenantId))
    }

    suspend fun removeJobTechnician(jobId: String, appUserId: String) {
        client.postgrest.from("job_technicians").delete { filter { eq("job_id", jobId); eq("app_user_id", appUserId) } }
    }

    // ── Job comments ──────────────────────────────────────────────────────────
    suspend fun fetchJobComments(jobId: String): List<JobCommentDto> =
        client.postgrest.from("job_comments")
            .select(Columns.raw("id, body, created_at, creator:app_users!job_comments_created_by_fkey(display_name)")) {
                filter { eq("job_id", jobId) }
                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
            }
            .decodeList()

    suspend fun addJobComment(row: NewJobCommentDto) {
        client.postgrest.from("job_comments").insert(row)
    }

    // ── Contacts ──────────────────────────────────────────────────────────────
    /** The customer book with each customer's cars — the tablet's Contacts tab. */
    suspend fun fetchContacts(term: String = "", limit: Long = 60): List<ContactDto> {
        val safe = term.trim().replace("%", "").replace(",", " ")
        return client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone, email, is_company, vehicles(id, plate, make, model, color, category, is_coated, notes, is_active)")) {
                filter { if (safe.length >= 2) or { ilike("name", "%$safe%"); ilike("phone", "%$safe%") } }
                order("name", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                limit(limit)
            }
            .decodeList()
    }

    /** Edit a car's identity from Contacts. Plate included — typos get corrected. */
    suspend fun updateVehicle(id: String, plate: String, make: String?, model: String?, colour: String?, category: String?) {
        client.postgrest.from("vehicles").update({
            set("plate", plate)
            set("make", make)
            set("model", model)
            set("color", colour)
            set("category", category)
        }) { filter { eq("id", id) } }
    }

    /**
     * Mark a car not-used, or bring it back. Never a delete: jobs, quotes and invoices
     * reference it and must keep reading. Retiring also RELEASES the plate, so the same
     * registration can be re-registered to whoever owns the car next.
     */
    suspend fun setVehicleActive(id: String, active: Boolean) {
        client.postgrest.from("vehicles").update({ set("is_active", active) }) { filter { eq("id", id) } }
    }

    /** The coated flag and its note live on the CAR — a standing fact, not job history. */
    suspend fun setVehicleCoating(vehicleId: String, coated: Boolean, notes: String?) {
        client.postgrest.from("vehicles").update({
            set("is_coated", coated)
            set("notes", notes)
        }) { filter { eq("id", vehicleId) } }
    }

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
