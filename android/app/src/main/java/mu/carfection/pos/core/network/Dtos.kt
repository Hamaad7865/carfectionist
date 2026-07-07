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
    @SerialName("selling_price") val sellingPrice: Double,
    @SerialName("vat_rate") val vatRate: Double? = null,
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
data class BusinessSettingsDto(
    val id: String, // tenant id
    @SerialName("vat_rate") val vatRate: Double,
    @SerialName("trading_name") val tradingName: String? = null,
)

@Serializable
data class DocumentDto(
    val id: String,
    val number: String? = null,
    val status: String,
    @SerialName("doc_type") val docType: String,
    @SerialName("total_incl") val totalIncl: Double = 0.0,
    @SerialName("amount_paid") val amountPaid: Double = 0.0,
)

@Serializable
data class PaymentDto(
    val id: String,
    val amount: Double,
    @SerialName("change_given") val changeGiven: Double? = null,
)

@Serializable
data class CashSessionDto(
    val id: String,
    val status: String,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("opening_float") val openingFloat: Double = 0.0,
    @SerialName("opened_at") val openedAt: String? = null,
    @SerialName("closing_count") val closingCount: Double? = null,
    @SerialName("expected_cash") val expectedCash: Double? = null,
    val variance: Double? = null,
)

/** Insert payload for a walk-in customer (RLS scopes the tenant). */
@Serializable
data class NewCustomerDto(
    @SerialName("tenant_id") val tenantId: String,
    val name: String,
)
