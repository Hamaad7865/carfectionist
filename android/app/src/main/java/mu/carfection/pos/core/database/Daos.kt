package mu.carfection.pos.core.database

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Query("SELECT * FROM products ORDER BY kind, name")
    fun observeAll(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE barcode = :barcode LIMIT 1")
    suspend fun byBarcode(barcode: String): ProductEntity?

    @Upsert
    suspend fun upsertAll(rows: List<ProductEntity>)

    @Query("DELETE FROM products WHERE id NOT IN (:keepIds)")
    suspend fun deleteNotIn(keepIds: List<String>)

    /** Full-refresh sync: replace the cache atomically so removed products vanish. */
    @Transaction
    suspend fun replaceAll(rows: List<ProductEntity>) {
        upsertAll(rows)
        deleteNotIn(rows.map { it.id })
    }
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers ORDER BY name")
    fun observeAll(): Flow<List<CustomerEntity>>

    @Upsert
    suspend fun upsertAll(rows: List<CustomerEntity>)

    @Query("DELETE FROM customers WHERE id NOT IN (:keepIds)")
    suspend fun deleteNotIn(keepIds: List<String>)

    @Transaction
    suspend fun replaceAll(rows: List<CustomerEntity>) {
        upsertAll(rows)
        deleteNotIn(rows.map { it.id })
    }
}
