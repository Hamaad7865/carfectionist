package mu.carfection.pos.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * DTOs hand-mirrored from the shared Postgres schema (no Kotlin generator exists;
 * drift is caught in review + the shared VAT test vectors). Numerics arrive as
 * JSON numbers → Double, converted to cents at the repository boundary.
 */

@Serializable
data class ProductDto(
    val id: String,
    val name: String,
    val kind: String,
    @SerialName("selling_price") val sellingPrice: FlexDouble,
    @SerialName("vat_rate") val vatRate: FlexDouble? = null,
    val barcode: String? = null,
    @SerialName("is_stocked") val isStocked: Boolean = false,
    val category: String? = null,
    @SerialName("low_stock_threshold") val lowStockThreshold: FlexDouble? = null,
)

@Serializable
data class CustomerDto(
    val id: String,
    val name: String,
    val phone: String? = null,
)

@Serializable
data class VehicleDto(
    val id: String,
    val plate: String,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
)

@Serializable
data class NewVehicleDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("customer_id") val customerId: String,
    val plate: String,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
)

@Serializable
data class JobRow(val id: String)

@Serializable data class SavedDoc(val id: String, val number: String? = null)

@Serializable
data class QuoteLineDto(
    @SerialName("product_id") val productId: String? = null,
    val title: String,
    val description: String? = null,
    val qty: FlexDouble = 1.0,
    @SerialName("unit_price") val unitPrice: FlexDouble = 0.0,
    @SerialName("discount_pct") val discountPct: FlexDouble = 0.0,
    @SerialName("vat_rate") val vatRate: FlexDouble = 15.0,
)

@Serializable
data class TechnicianDto(
    val id: String,
    @SerialName("display_name") val displayName: String,
)

@Serializable data class CustomerNameDto(val name: String? = null)
@Serializable data class VehicleNameDto(val plate: String? = null, val make: String? = null, val model: String? = null)

@Serializable
data class QuoteRowDto(
    val id: String,
    val number: String? = null,
    val status: String,
    @SerialName("customer_id") val customerId: String? = null,
    @SerialName("vehicle_id") val vehicleId: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("job_id") val jobId: String? = null, // the job this quote was converted into, if any
    val customers: CustomerNameDto? = null,
    val vehicles: VehicleNameDto? = null,
)

// ── Jobs board ────────────────────────────────────────────────────────────────
@Serializable data class ChecklistItemDto(val label: String, val done: Boolean = false)
@Serializable data class JobCustomerDto(val name: String? = null, val phone: String? = null)
@Serializable data class JobVehicleDto(
    val plate: String? = null,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
)
@Serializable data class JobTechDto(@SerialName("display_name") val displayName: String? = null)

@Serializable data class JobPhotoDto(
    val id: String,
    @SerialName("storage_path") val storagePath: String,
    val phase: String, // "before" | "after"
    val caption: String? = null,
)

@Serializable data class NewJobPhotoDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("job_id") val jobId: String,
    @SerialName("storage_path") val storagePath: String,
    val phase: String,
)

@Serializable
data class JobBoardDto(
    val id: String,
    val status: String,
    @SerialName("customer_id") val customerId: String? = null,
    @SerialName("vehicle_id") val vehicleId: String? = null,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("ready_at") val readyAt: String? = null,
    @SerialName("delivered_at") val deliveredAt: String? = null,
    @SerialName("paused_at") val pausedAt: String? = null, // timer paused since; null = running
    @SerialName("paused_ms") val pausedMs: Long = 0, // accumulated paused time

    @SerialName("technician_id") val technicianId: String? = null,
    val notes: String? = null,
    val checklist: List<ChecklistItemDto> = emptyList(),
    @SerialName("damage_markers") val damageMarkers: List<kotlinx.serialization.json.JsonElement> = emptyList(),
    val customers: JobCustomerDto? = null,
    val vehicles: JobVehicleDto? = null,
    val technician: JobTechDto? = null,
)

// ── Checkout · collect on invoice ─────────────────────────────────────────────
@Serializable
data class OutstandingInvoiceDto(
    val id: String,
    val number: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
    val status: String = "issued",
    @SerialName("job_id") val jobId: String? = null,
    val customers: JobCustomerDto? = null,
    val vehicles: JobVehicleDto? = null,
)
@Serializable data class PaidDocRefDto(val number: String? = null, val customers: JobCustomerDto? = null)

// ── Checkout · sales history (view past sales + reprint) ─────────────────────
@Serializable
data class SaleHistoryLineDto(
    val title: String = "",
    val qty: FlexDouble = 1.0,
    @SerialName("line_total_excl") val lineTotalExcl: FlexDouble = 0.0,
    @SerialName("line_vat") val lineVat: FlexDouble = 0.0,
    @SerialName("sort_order") val sortOrder: Int = 0,
)

@Serializable
data class SaleHistoryPaymentDto(
    val method: String = "cash",
    val amount: FlexDouble = 0.0,
    val tendered: FlexDouble? = null,
    @SerialName("change_given") val changeGiven: FlexDouble? = null,
    @SerialName("reverses_payment_id") val reversesPaymentId: String? = null,
    @SerialName("received_at") val receivedAt: String? = null,
)

@Serializable
data class SaleHistoryDto(
    val id: String,
    val number: String? = null,
    val status: String = "issued",
    @SerialName("issued_at") val issuedAt: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("vat_total") val vatTotal: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
    val customers: JobCustomerDto? = null,
    val creator: JobTechDto? = null,
    @SerialName("document_lines") val lines: List<SaleHistoryLineDto> = emptyList(),
    val payments: List<SaleHistoryPaymentDto> = emptyList(),
)
@Serializable
data class TodayPaymentDto(
    val id: String,
    val method: String,
    val amount: FlexDouble = 0.0,
    @SerialName("document_id") val documentId: String,
    @SerialName("reverses_payment_id") val reversesPaymentId: String? = null,
    val documents: PaidDocRefDto? = null,
)

// ── Dashboard ─────────────────────────────────────────────────────────────────
@Serializable data class PaymentRowDto(
    val method: String,
    val amount: FlexDouble = 0.0,
    @SerialName("received_at") val receivedAt: String,
)
@Serializable data class OpenInvoiceDto(
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
)
@Serializable data class DashLineDto(
    val title: String,
    val qty: FlexDouble = 1.0,
    @SerialName("unit_price") val unitPrice: FlexDouble = 0.0,
    @SerialName("discount_pct") val discountPct: FlexDouble = 0.0,
)
@Serializable data class PaidInvoiceDto(
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("job_id") val jobId: String? = null,
    @SerialName("document_lines") val lines: List<DashLineDto> = emptyList(),
)

// ── Certificates & warranty ───────────────────────────────────────────────────
@Serializable data class CertProductDto(val name: String? = null)
@Serializable data class CertNumberRow(val number: String)

/** Insert payload for a new ceramic certificate (RLS scopes the tenant). */
@Serializable
data class NewCertificateDto(
    @SerialName("tenant_id") val tenantId: String,
    val number: String,
    @SerialName("customer_id") val customerId: String,
    @SerialName("vehicle_id") val vehicleId: String,
    @SerialName("product_id") val productId: String? = null,
    @SerialName("job_id") val jobId: String? = null,
    @SerialName("applied_at") val appliedAt: String,
    @SerialName("warranty_months") val warrantyMonths: Int,
    @SerialName("expires_at") val expiresAt: String,
    val notes: String? = null,
)

@Serializable
data class CertificateDto(
    val id: String,
    val number: String,
    @SerialName("applied_at") val appliedAt: String,
    @SerialName("warranty_months") val warrantyMonths: Int,
    @SerialName("expires_at") val expiresAt: String,
    val notes: String? = null,
    @SerialName("job_id") val jobId: String? = null,
    val customers: JobCustomerDto? = null,
    val vehicles: JobVehicleDto? = null,
    val products: CertProductDto? = null,
    @SerialName("applied_by") val appliedBy: JobTechDto? = null,
)

// ── Stock ─────────────────────────────────────────────────────────────────────
@Serializable
data class StockProductDto(
    val id: String,
    val name: String,
    val category: String? = null,
    @SerialName("selling_price") val sellingPrice: FlexDouble = 0.0,
    @SerialName("low_stock_threshold") val lowStockThreshold: FlexDouble? = null,
)

@Serializable
data class StockOnHandDto(
    @SerialName("product_id") val productId: String,
    @SerialName("qty_on_hand") val qtyOnHand: FlexDouble = 0.0,
)

@Serializable data class StockLocationDto(val id: String)

/**
 * An adjustment movement (owner/manager only, per the sm_insert RLS policy).
 * NOTE: `refType` has NO default on purpose — kotlinx.serialization omits
 * default-valued fields, which would drop `ref_type` from the insert payload and
 * fail the RLS `with check (ref_type = 'adjustment')`.
 */
@Serializable
data class NewStockMovementDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("product_id") val productId: String,
    @SerialName("location_id") val locationId: String,
    val qty: Double,
    @SerialName("ref_type") val refType: String,
    val note: String? = null,
)

@Serializable
data class BusinessSettingsDto(
    val id: String, // tenant id
    @SerialName("vat_rate") val vatRate: FlexDouble,
    @SerialName("trading_name") val tradingName: String? = null,
    val brn: String? = null,
    @SerialName("vat_number") val vatNumber: String? = null,
    val address: String? = null,
    val phone: String? = null,
)

@Serializable
data class DocumentDto(
    val id: String,
    val number: String? = null,
    val status: String,
    @SerialName("doc_type") val docType: String,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
)

@Serializable
data class PaymentDto(
    val id: String,
    val amount: FlexDouble,
    @SerialName("change_given") val changeGiven: FlexDouble? = null,
)

@Serializable
data class CashSessionDto(
    val id: String,
    val status: String,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("opening_float") val openingFloat: FlexDouble = 0.0,
    @SerialName("opened_at") val openedAt: String? = null,
    @SerialName("closing_count") val closingCount: FlexDouble? = null,
    @SerialName("expected_cash") val expectedCash: FlexDouble? = null,
    val variance: FlexDouble? = null,
)

/** Insert payload for a new customer (RLS scopes the tenant). */
@Serializable
data class NewCustomerDto(
    @SerialName("tenant_id") val tenantId: String,
    val name: String,
    val phone: String? = null,
)
