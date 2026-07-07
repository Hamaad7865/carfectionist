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
    val customers: CustomerNameDto? = null,
    val vehicles: VehicleNameDto? = null,
)

@Serializable
data class BusinessSettingsDto(
    val id: String, // tenant id
    @SerialName("vat_rate") val vatRate: FlexDouble,
    @SerialName("trading_name") val tradingName: String? = null,
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
