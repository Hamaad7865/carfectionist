package mu.carfection.pos.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ProductEntity::class, CustomerEntity::class],
    version = 2, // v2: +products.category (read-cache; destructive migration rebuilds it)
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
}
