package mu.carfection.pos.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ProductEntity::class, CustomerEntity::class],
    // v11: main's v10 (products.legalEntityId + brand/tyre*) merged with tyrecentre-two-company's
    // own v9 (products.legalEntityId). Bumped past both so neither build's cache matches this
    // schema (same version + different schema = identity-hash crash on start).
    version = 11, // read-cache; destructive migration rebuilds it, same as v4-v10
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
}
