package mu.carfection.pos.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ProductEntity::class, CustomerEntity::class],
    // v10, not v9: the unmerged tyrecentre-two-company and quote-split branches both took v9 with a
    // different schema (+legalEntityId). Same version + different schema = identity-hash crash on
    // start once merged; whoever merges second bumps past the other.
    version = 10, // v10: +products.brand/tyre* (read-cache; destructive migration rebuilds it, same as v4-v8)
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
}
