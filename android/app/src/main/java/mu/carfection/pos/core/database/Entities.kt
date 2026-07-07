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
)

@Entity(tableName = "customers", indices = [Index("name")])
data class CustomerEntity(
    @PrimaryKey val id: String,
    val name: String,
    val phone: String?,
)
