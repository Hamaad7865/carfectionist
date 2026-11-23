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
    // 'inherit' | 'none' | 'carwash' | 'free' — see core/money/Allowance.kt#policyOf.
    val discountPolicy: String = "inherit",
    // True: sellingPriceCents IS the VAT-inclusive shelf price exactly as typed (20260812000030) —
    // a line from it is flagged, so the ledger extracts VAT and the line lands on the figure.
    // False (default): sellingPriceCents is VAT-exclusive and VAT is added on top.
    val priceInclusive: Boolean = false,
    // Brand (any product) and tyre size (20261127000010); size columns all-or-nothing.
    val brand: String? = null,
    val tyreWidth: Int? = null,
    val tyreProfile: Int? = null,
    val tyreRim: Double? = null,
    val tyreLoadIndex: String? = null,
    val tyreSpeedRating: String? = null,
) {
    val tyreSize: mu.carfection.pos.core.catalog.TyreSize?
        get() = mu.carfection.pos.core.catalog.TyreSizes.fromColumns(tyreWidth, tyreProfile, tyreRim)

    /** "Michelin · 205/55 R16 91V" under the name on a tile; "" when it has neither. */
    val attrLabel: String
        get() = listOfNotNull(
            brand?.ifBlank { null },
            tyreSize?.let { mu.carfection.pos.core.catalog.TyreSizes.formatSpec(it, tyreLoadIndex, tyreSpeedRating) },
        ).joinToString(" · ")

    /** The pickers' search: name, barcode, brand and size (any spelling, or a partial size). */
    fun matchesSearch(q: String): Boolean =
        mu.carfection.pos.core.catalog.TyreSizes.searchMatches(q, listOf(name, barcode), brand, tyreSize, tyreLoadIndex, tyreSpeedRating)

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
    // So a customer created at Intake carries their email into the quote's send dialog
    // without the operator retyping it off the card. Optional/defaulted: every existing
    // call site that only ever had id/name/phone still compiles unchanged.
    val email: String? = null,
    // The ledger's fast read (customers.points_balance, 20260811000020) — synced the same
    // way as every other field here, so the payment pad can show a balance and cap the
    // Points tender without a network round trip of its own.
    val pointsBalance: Int = 0,
)
