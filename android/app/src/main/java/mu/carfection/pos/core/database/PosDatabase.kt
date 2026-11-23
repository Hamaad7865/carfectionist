package mu.carfection.pos.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ProductEntity::class, CustomerEntity::class],
    // v10: v9 (quote-split, on main) added products.legalEntityId; v10 adds products.brand/tyre*.
    // The tyrecentre-two-company branch also took v9 with its own schema — it must bump past v10
    // when it merges (same version + different schema = identity-hash crash on start).
    version = 10, // read-cache; destructive migration rebuilds it, same as v4-v9
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
}
