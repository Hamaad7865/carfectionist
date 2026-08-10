package mu.carfection.pos.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ProductEntity::class, CustomerEntity::class],
    version = 6, // v6: +products.discountPolicy (read-cache; destructive migration rebuilds it, same as v4/v5)
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
}
