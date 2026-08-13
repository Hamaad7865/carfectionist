package mu.carfection.pos.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

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
    // product-photos is a PUBLIC bucket (see the web's productPhotoUrl) — this is a bare object
    // path, and the full URL is built locally so it survives being cached offline unsigned.
    @SerialName("photo_path") val photoPath: String? = null,
    // 'inherit' | 'none' | 'carwash' | 'free' — how much of this line may be discounted.
    // See core/money/Allowance.kt#policyOf, the tablet's mirror of app.document_discount_limits.
    @SerialName("discount_policy") val discountPolicy: String = "inherit",
    // True: selling_price IS the VAT-inclusive shelf price exactly as typed (20260812000030).
    @SerialName("price_includes_vat") val priceIncludesVat: Boolean = false,
)

@Serializable
data class CustomerDto(
    val id: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    // The ledger's fast read (customer_points_ledger via app.apply_points_delta, 20260811000020).
    // Synced like every other field here — the payment pad reads it straight off the cache.
    @SerialName("points_balance") val pointsBalance: Int = 0,
)

@Serializable
data class VehicleDto(
    val id: String,
    val plate: String,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
    val category: String? = null,
)

@Serializable
data class NewVehicleDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("customer_id") val customerId: String,
    val plate: String,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
    val category: String? = null,
)

@Serializable
data class JobRow(val id: String)

@Serializable data class SavedDoc(
    val id: String,
    val number: String? = null,
    val status: String? = null,
    // Set when the server priced this document from a quote. Its presence is the only
    // trustworthy answer to "was this bill already priced?" — the client must not decide.
    @SerialName("source_document_id") val sourceDocumentId: String? = null,
    // What the document comes to as it stands — the quote screen shows the running bill.
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
)

/**
 * The column list fetchQuoteLines() asks PostgREST for. Lives beside the DTO so the
 * two are read together — they must agree, and QuoteLineColumnsTest enforces it.
 */
const val QUOTE_LINE_COLUMNS: String =
    "product_id, title, description, description_richtext, unit_label, " +
        "qty, unit_price, discount_pct, discount_kind, discount_amount, vat_rate, line_kind, price_includes_vat"

@Serializable
data class QuoteLineDto(
    @SerialName("product_id") val productId: String? = null,
    val title: String,
    val description: String? = null,
    // Kept as a raw JsonElement on purpose. The tablet renders this tree and can add
    // bullets to it, but it must not reshape what it does not understand — a quote
    // drafted in the back office may carry marks or a table this screen has no editor
    // for, and save_draft replaces every line on every save.
    @SerialName("description_richtext") val descriptionRichtext: JsonElement? = null,
    @SerialName("unit_label") val unitLabel: String? = null,
    val qty: FlexDouble = 1.0,
    @SerialName("unit_price") val unitPrice: FlexDouble = 0.0,
    @SerialName("discount_pct") val discountPct: FlexDouble = 0.0,
    @SerialName("discount_kind") val discountKind: String = "percent",
    @SerialName("discount_amount") val discountAmount: FlexDouble = 0.0, // Rs, VAT-inclusive
    @SerialName("vat_rate") val vatRate: FlexDouble = 15.0,
    // True: unit_price IS the typed VAT-inclusive figure (20260812000020).
    @SerialName("price_includes_vat") val priceIncludesVat: Boolean = false,
    /** Stated on a typed-in line; null on a catalogue line, where products.kind answers. */
    @SerialName("line_kind") val lineKind: String? = null,
)

@Serializable
data class TechnicianDto(
    val id: String,
    @SerialName("display_name") val displayName: String,
)

@Serializable data class CustomerNameDto(val name: String? = null, val email: String? = null, val phone: String? = null)
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
    @SerialName("discount_kind") val discountKind: String? = null, // order-level: percent | amount | null
    @SerialName("discount_value") val discountValue: FlexDouble = 0.0, // % 0..100, or Rs (VAT-inclusive)
    @SerialName("discount_reason") val discountReason: String? = null,
    // Flow strip: did this quote start at reception, and has the client signed?
    val intake: kotlinx.serialization.json.JsonElement? = null,
    @SerialName("accepted_signature") val acceptedSignature: kotlinx.serialization.json.JsonElement? = null,
    // live invoices derived from this quote ("Bill now"/auto-billing) - the billed marker
    val invoices: List<FlowInvoiceRefDto> = emptyList(),
    // the job this quote produced — its status retires the quote from the list once delivered
    val job: JobStatusRefDto? = null,
    val customers: CustomerNameDto? = null,
    val vehicles: VehicleNameDto? = null,
)

@Serializable data class JobStatusRefDto(val status: String = "")

// ── Lifecycle flow refs (embedded on the jobs board) ──────────────────────────
@Serializable
data class FlowQuoteRefDto(
    val number: String? = null,
    val status: String = "",
    @SerialName("accepted_signature") val acceptedSignature: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable
data class FlowInvoiceRefDto(
    val id: String,
    val number: String? = null,
    @SerialName("doc_type") val docType: String = "",
    val status: String = "",
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
)

@Serializable
data class FlowCertRefDto(
    val number: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
)

// ── Jobs board ────────────────────────────────────────────────────────────────
@Serializable data class ChecklistItemDto(val label: String, val done: Boolean = false)
@Serializable data class JobCustomerDto(
    val name: String? = null,
    val phone: String? = null,
    val email: String? = null,
    // Present only on the embeds that ask for it (the TO COLLECT list, the sale/receipt
    // columns) — absent elsewhere decodes as null, never a false zero.
    @SerialName("points_balance") val pointsBalance: Int? = null,
)
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
    // A cancelled car's clock stops here, and the board can say why it was dropped.
    @SerialName("cancelled_at") val cancelledAt: String? = null,
    @SerialName("cancel_reason") val cancelReason: String? = null,
    // set when staff swipe a delivered card off the board — the job itself is untouched
    @SerialName("board_dismissed_at") val boardDismissedAt: String? = null,
    @SerialName("paused_at") val pausedAt: String? = null, // timer paused since; null = running
    @SerialName("paused_ms") val pausedMs: Long = 0, // accumulated paused time

    @SerialName("technician_id") val technicianId: String? = null,
    val notes: String? = null,
    val checklist: List<ChecklistItemDto> = emptyList(),
    @SerialName("damage_markers") val damageMarkers: List<kotlinx.serialization.json.JsonElement> = emptyList(),
    val customers: JobCustomerDto? = null,
    val vehicles: JobVehicleDto? = null,
    val technician: JobTechDto? = null,
    // Lifecycle flow: the quote this job came from, invoices billed on it, and
    // any warranty certificate issued against it (the ceramic journey's finale).
    @SerialName("source_quote_id") val sourceQuoteId: String? = null,
    @SerialName("source_quote") val sourceQuote: FlowQuoteRefDto? = null,
    val invoices: List<FlowInvoiceRefDto> = emptyList(),
    val certificates: List<FlowCertRefDto> = emptyList(),
    // How long the work should take. Null = nobody estimated; show no ETA rather than guess.
    @SerialName("estimated_minutes") val estimatedMinutes: Int? = null,
)

// ── Checkout · collect on invoice ─────────────────────────────────────────────
@Serializable
data class DocNumberDto(val number: String? = null)

@Serializable
data class OutstandingInvoiceDto(
    val id: String,
    val number: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
    val status: String = "issued",
    @SerialName("job_id") val jobId: String? = null,
    /** The job behind this bill, when there is one — a draft raised while the car is still
     *  in the bay is not something the till should be offering to collect yet. */
    val jobs: JobStatusRefDto? = null,
    /** The quote this bill was raised from. A draft with no job has no work to wait for, so
     *  this is what tells a goods-only counter bill apart from an abandoned back-office one. */
    @SerialName("source_document_id") val sourceDocumentId: String? = null,
    @SerialName("issued_at") val issuedAt: String? = null, // for the payment screen's bill header
    val customers: JobCustomerDto? = null,
    val vehicles: JobVehicleDto? = null,
)

/** Just enough of a job to explain, on the payment screen, WHAT service a collect was for
 *  (the work performed) — not the whole jobs-board shape (JobBoardDto). */
@Serializable
data class JobServiceDetailDto(
    val id: String,
    val notes: String? = null,
    val checklist: List<ChecklistItemDto> = emptyList(),
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
    // The slip prints the UNDISCOUNTED unit price ("UP") beside the discounted line total,
    // then spells the saving out underneath — so a reprint has to carry the discount too,
    // or the reprinted paper silently loses what the customer was shown at the counter.
    @SerialName("unit_price") val unitPrice: FlexDouble = 0.0,
    @SerialName("vat_rate") val vatRate: FlexDouble = 15.0,
    @SerialName("discount_kind") val discountKind: String? = null, // percent | amount
    @SerialName("discount_pct") val discountPct: FlexDouble = 0.0,
    @SerialName("discount_amount") val discountAmount: FlexDouble = 0.0, // VAT-INCLUSIVE, as typed
    // True: unit_price IS the typed VAT-inclusive figure (20260812000020) — print it as
    // stored; re-grossing it would put the VAT on twice.
    @SerialName("price_includes_vat") val priceIncludesVat: Boolean = false,
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
    @SerialName("doc_type") val docType: String = "invoice",
    val status: String = "issued",
    @SerialName("issued_at") val issuedAt: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("vat_total") val vatTotal: FlexDouble = 0.0,
    @SerialName("amount_paid") val amountPaid: FlexDouble = 0.0,
    // Internal order reference for the slip's "Bill" line — not the fiscal series.
    @SerialName("bill_no") val billNo: Long? = null,
    // The CLIENT's fiscal identity, frozen onto the document when it was issued — printed under
    // their name for a business customer. Null for a walk-in or an individual.
    @SerialName("bill_to_brn") val billToBrn: String? = null,
    @SerialName("bill_to_vat_number") val billToVatNumber: String? = null,
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
/** A product's kind on an embedded line. PostgREST returns the to-one embed as an
 *  object, so this decodes as an object — absent for an ad-hoc typed line. */
@Serializable data class LineProductDto(val kind: String? = null)

@Serializable data class DashLineDto(
    val title: String,
    val qty: FlexDouble = 1.0,
    @SerialName("unit_price") val unitPrice: FlexDouble = 0.0,
    @SerialName("discount_pct") val discountPct: FlexDouble = 0.0,
    val products: LineProductDto? = null,
)
@Serializable data class PaidInvoiceDto(
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("job_id") val jobId: String? = null,
    val origin: String? = null,
    @SerialName("issued_at") val issuedAt: String? = null,
    @SerialName("document_lines") val lines: List<DashLineDto> = emptyList(),
) {
    /** Did the studio DO something to a car for this money? Same rule as the web
     *  dashboard (isWorkshopSale): off a job card, in via intake, or it CONTAINS
     *  A SERVICE — a body polish rung up at the till with no job is still
     *  workshop work. Counter is what's left: a speaker off the shelf. */
    val isWorkshop: Boolean
        get() = origin == "from_job" || jobId != null || lines.any { it.products?.kind == "service" }
}

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
    val barcode: String? = null,
    @SerialName("selling_price") val sellingPrice: FlexDouble = 0.0,
    // True: selling_price IS the VAT-inclusive shelf price exactly as typed (20260812000030).
    @SerialName("price_includes_vat") val priceIncludesVat: Boolean = false,
    // Needed to show the shelf price when the shop quotes VAT-inclusive; null = tenant default.
    @SerialName("vat_rate") val vatRate: FlexDouble? = null,
    @SerialName("low_stock_threshold") val lowStockThreshold: FlexDouble? = null,
    @SerialName("photo_path") val photoPath: String? = null,
)

@Serializable
data class StockOnHandDto(
    @SerialName("product_id") val productId: String,
    @SerialName("location_id") val locationId: String? = null,
    @SerialName("qty_on_hand") val qtyOnHand: FlexDouble = 0.0,
)

@Serializable data class StockLocationDto(
    val id: String,
    val name: String? = null,
    /** Where stock lands when nobody names a location — the bulk store. */
    @SerialName("is_default") val isDefault: Boolean = false,
    /** Where the till debits. The structural answer to "which one is the Shop?",
     *  so renaming it in the back office can't redirect the tablet's stock. */
    @SerialName("is_sales_floor") val isSalesFloor: Boolean = false,
    /** Retired locations are empty by construction — they can only be switched
     *  off at zero stock — so the tablet never needs to offer them. */
    @SerialName("is_active") val isActive: Boolean = true,
)

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
    // Who adjusted. Omitted from the JSON when null so the column keeps its own default.
    @SerialName("created_by") val createdBy: String? = null,
)

@Serializable data class ProductNameDto(val name: String? = null)
@Serializable data class LocationNameDto(val name: String? = null)

/** One stock adjustment, as the printable log lists it. */
@Serializable
data class StockAdjustmentDto(
    val id: String,
    val qty: FlexDouble = 0.0,
    val note: String? = null,
    @SerialName("moved_at") val movedAt: String? = null,
    val products: ProductNameDto? = null,
    @SerialName("stock_locations") val location: LocationNameDto? = null,
    // Null on every row written before the tablet started stamping it — the slip then
    // simply omits the operator rather than inventing one.
    val creator: JobTechDto? = null,
)

@Serializable data class AppUserIdDto(val id: String)

// ── Staff (technicians) ──────────────────────────────────────────────────────
@Serializable data class StaffDto(
    val id: String,
    @SerialName("display_name") val displayName: String,
    val role: String = "technician",
    @SerialName("is_active") val isActive: Boolean = true,
)
@Serializable data class NewStaffDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("display_name") val displayName: String,
    val role: String = "technician",
    @SerialName("is_active") val isActive: Boolean = true,
)
@Serializable data class JobTechLinkDto(
    @SerialName("job_id") val jobId: String,
    @SerialName("app_user_id") val appUserId: String,
    @SerialName("tenant_id") val tenantId: String,
)
@Serializable data class JobCrewDto(
    @SerialName("app_user_id") val appUserId: String,
    @SerialName("app_users") val user: JobTechDto? = null,
)

// ── Job comments ─────────────────────────────────────────────────────────────
@Serializable data class JobCommentDto(
    val id: String,
    val body: String,
    @SerialName("created_at") val createdAt: String? = null,
    val creator: JobTechDto? = null,
)
@Serializable data class NewJobCommentDto(
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("job_id") val jobId: String,
    val body: String,
    @SerialName("created_by") val createdBy: String? = null,
)

// ── Contacts (the tablet's own customer book) ────────────────────────────────
@Serializable data class ContactDto(
    val id: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    @SerialName("is_company") val isCompany: Boolean = false,
    val vehicles: List<ContactVehicleDto> = emptyList(),
)
@Serializable data class ContactVehicleDto(
    val id: String,
    val plate: String,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val colour: String? = null,
    val category: String? = null,
    @SerialName("is_coated") val isCoated: Boolean = false,
    val notes: String? = null,
    // false = retired ("not used"). Kept on the card, dimmed, because the history is still real.
    @SerialName("is_active") val isActive: Boolean = true,
)
@Serializable data class PlateCustomerDto(val plate: String? = null, val customers: CustomerDto? = null)
@Serializable data class PlateOwnerDto(val plate: String? = null, val customers: CustomerNameDto? = null)

/** A taken plate with everything needed to jump straight to it — see PosApi.plateHolder. */
@Serializable
data class PlateHolderDto(
    val id: String,
    val plate: String? = null,
    val make: String? = null,
    val model: String? = null,
    @SerialName("color") val color: String? = null,
    val category: String? = null,
    val customers: CustomerDto? = null,
)
data class PlateHolder(val customer: CustomerDto, val vehicle: VehicleDto)

@Serializable
data class BusinessSettingsDto(
    val id: String, // tenant id
    @SerialName("vat_rate") val vatRate: FlexDouble,
    @SerialName("trading_name") val tradingName: String? = null,
    val brn: String? = null,
    @SerialName("vat_number") val vatNumber: String? = null,
    val address: String? = null,
    val phone: String? = null,
    @SerialName("receipt_logo_path") val receiptLogoPath: String? = null, // brand-assets object
    @SerialName("receipt_footer_text") val receiptFooterText: String? = null,
    // false = the shop quotes VAT-INCLUSIVE shelf prices. Prices are always STORED net;
    // this only decides whether the staff-facing screens show net or gross. Defaults to the
    // DB default (true) so a failed fetch keeps today's behaviour rather than inflating prices.
    @SerialName("prices_vat_exclusive") val pricesVatExclusive: Boolean = true,
    // What one point is worth when spent (20260811000020) — the Points tender's cap
    // (pointsValueCents) needs it; the earn rate stays server-side only.
    @SerialName("point_value_rupees") val pointValueRupees: FlexDouble = 1.0,
    // The programme's off switch (20260811000090). Defaults to TRUE like the column: a
    // tablet that cannot read the field keeps the shop's current behaviour rather than
    // silently withdrawing a tender the counter is still taking.
    @SerialName("points_enabled") val pointsEnabled: Boolean = true,
    // The owner-editable discount rules (20260812000010). Each defaults to the value the
    // rule was hardcoded to, so a tablet that cannot read the field clamps exactly as
    // before — the same fallbacks Allowance.kt's DEFAULT_POLICIES / CARWASH_MAX_PCT use.
    @SerialName("discount_carwash_pct") val discountCarwashPct: FlexDouble = 5.0,
    @SerialName("default_policy_service") val defaultPolicyService: String = "none",
    @SerialName("default_policy_goods") val defaultPolicyGoods: String = "free",
    @SerialName("default_opening_float") val defaultOpeningFloat: FlexDouble = 0.0,
    @SerialName("allow_negative_stock") val allowNegativeStock: Boolean = true,
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

// ── Till Z-report (Clôture de période) — payments + docs + lines + category ──
@Serializable data class ZProductDto(val category: String? = null)
@Serializable data class ZLineDto(
    val qty: FlexDouble = 1.0,
    @SerialName("line_total_excl") val lineTotalExcl: FlexDouble = 0.0,
    @SerialName("line_vat") val lineVat: FlexDouble = 0.0,
    val products: ZProductDto? = null,
)
@Serializable data class ZDocDto(
    val id: String,
    val number: String? = null,
    @SerialName("total_incl") val totalIncl: FlexDouble = 0.0,
    @SerialName("vat_total") val vatTotal: FlexDouble = 0.0,
    @SerialName("subtotal_excl") val subtotalExcl: FlexDouble = 0.0,
    @SerialName("document_lines") val lines: List<ZLineDto> = emptyList(),
)
@Serializable data class ZPaymentDto(
    val id: String,
    val method: String,
    val amount: FlexDouble = 0.0,
    @SerialName("change_given") val changeGiven: FlexDouble? = null,
    @SerialName("reverses_payment_id") val reversesPaymentId: String? = null,
    @SerialName("received_by") val receivedBy: String? = null,
    val documents: ZDocDto? = null,
)
@Serializable data class UserNameDto(val id: String, @SerialName("display_name") val displayName: String)

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
    // A service belongs to a trading day and is numbered inside it ("Service 3").
    @SerialName("trading_day_id") val tradingDayId: String? = null,
    @SerialName("service_no") val serviceNo: Int? = null,
)

/**
 * A trading day. [status] is 'open' or 'closed'; a closed day takes no more money until
 * it is reopened, and [reopenedCount] says how many times that has happened.
 */
@Serializable
data class TradingDayDto(
    val id: String,
    @SerialName("business_date") val businessDate: String,
    val status: String,
    @SerialName("reopened_count") val reopenedCount: Int = 0,
)

/** A Z report — the frozen "Clôture de période". Its totals never change. */
@Serializable
data class ZReportDto(
    val id: String,
    val number: String,
    val scope: String, // service | day
    @SerialName("trading_day_id") val tradingDayId: String? = null,
    val totals: kotlinx.serialization.json.JsonObject,
    val note: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
)

/**
 * Insert payload for a customer created OFFLINE, under an id the tablet minted so the
 * write is replay-safe. Separate from [NewCustomerDto] because here the id must always
 * be serialized, never dropped as an unset default.
 */
@Serializable
data class NewCustomerWithIdDto(
    val id: String,
    @SerialName("tenant_id") val tenantId: String,
    val name: String,
)

/** Insert payload for a new customer (RLS scopes the tenant). */
@Serializable
data class NewCustomerDto(
    @SerialName("tenant_id") val tenantId: String,
    val name: String,
    val phone: String? = null,
    @SerialName("is_company") val isCompany: Boolean = false,
    val email: String? = null,
    val address: String? = null,
    val brn: String? = null,
    @SerialName("vat_number") val vatNumber: String? = null,
)

/** Minimal projections for the receipt's "No. N" / "Appareil N" lookups. */
@Serializable
data class PaymentDocRefDto(
    @SerialName("document_id") val documentId: String = "",
    @SerialName("received_at") val receivedAt: String? = null,
)

@Serializable
data class DeviceOrdinalDto(
    @SerialName("device_code") val deviceCode: String = "",
    @SerialName("first_seen") val firstSeen: String? = null,
)

@Serializable
data class BillNoDto(@SerialName("bill_no") val billNo: Long? = null)

/** A customer's CURRENT points balance, read fresh for the receipt's "balance after" line. */
@Serializable
data class CustomerPointsDto(@SerialName("points_balance") val pointsBalance: Int = 0)

/** One customer_points_ledger row's delta — used to sum what a single document earned. */
@Serializable
data class PointsDeltaDto(val delta: Int = 0)
