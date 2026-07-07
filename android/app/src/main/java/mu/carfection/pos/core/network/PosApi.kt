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
            .select(Columns.raw("id, name, kind, selling_price, vat_rate, barcode, is_stocked")) {
                filter { eq("is_active", true) }
            }
            .decodeList()

    suspend fun fetchCustomers(): List<CustomerDto> =
        client.postgrest.from("customers")
            .select(Columns.raw("id, name, phone"))
            .decodeList()

    suspend fun fetchSettings(): BusinessSettingsDto =
        client.postgrest.from("business_settings")
            .select(Columns.raw("id, vat_rate, trading_name")) { limit(1) }
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

    /** Intake → "Start quotation": atomic job for the customer+vehicle (create_job RPC). */
    suspend fun createJob(customerId: String, vehicleId: String, service: String?): String =
        client.postgrest.rpc("create_job", buildJsonObject {
            put("p_customer_id", customerId)
            put("p_new_customer_name", JsonNull); put("p_new_customer_phone", JsonNull)
            put("p_vehicle_id", vehicleId)
            put("p_new_vehicle_plate", JsonNull); put("p_new_vehicle_make", JsonNull)
            if (service != null) put("p_service", service) else put("p_service", JsonNull)
            put("p_technician_id", JsonNull); put("p_department", JsonNull)
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
