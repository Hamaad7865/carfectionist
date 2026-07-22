package mu.carfection.pos.core.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Read-cache of the shared catalogue. Room is the UI's single source of truth. */
@Entity(
    tableName = "products",
    indices = [Index("barcode"), Index("name")],
)
data class ProductEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: String, // service | product | consumable
    val sellingPriceCents: Long, // VAT-exclusive
    val vatRatePct: Double, // resolved (product override ?: tenant default)
    val barcode: String?,
    val isStocked: Boolean,
    val category: String?, // checkout/stock category rail
    val lowStockThreshold: Double?, // null = default
    val photoPath: String? = null, // product-photos bucket object path; null = no reference photo
) {
    /** Business rule: blank = 10, hard cap 20 (mirrors the DB check + web form). */
    val effectiveLowStock: Int
        get() = (lowStockThreshold ?: DEFAULT_LOW_STOCK).coerceAtMost(MAX_LOW_STOCK).toInt()

    val photoUrl: String? get() = mu.carfection.pos.core.data.productPhotoUrl(photoPath)

    companion object {
        const val DEFAULT_LOW_STOCK = 10.0
        const val MAX_LOW_STOCK = 20.0
    }
}

@Entity(tableName = "customers", indices = [Index("name")])
data class CustomerEntity(
    @PrimaryKey val id: String,
    val name: String,
    val phone: String?,
)
