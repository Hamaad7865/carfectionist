package mu.carfection.pos.core.sync

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/**
 * A write that must reach the server, queued locally so a network blip never loses it.
 * Ops carry an idempotency key so a replay after a flaky response can't double-apply.
 * Only safe, result-independent writes go here (stock, checklist, assignment) — the money
 * path stays online-only because it needs a server-assigned number to show the cashier.
 */
@Entity(tableName = "outbox")
data class OutboxOp(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val opType: String,
    val payload: String, // JSON args for the dispatch
    val idempotencyKey: String,
    val label: String, // human-readable summary, e.g. "Stock +5 · Ceramic 30ml"
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

@Dao
interface OutboxDao {
    @Insert suspend fun insert(op: OutboxOp): Long

    @Query("SELECT * FROM outbox ORDER BY id ASC")
    suspend fun all(): List<OutboxOp>

    @Query("SELECT COUNT(*) FROM outbox")
    fun count(): Flow<Int>

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE outbox SET attempts = :attempts, lastError = :err WHERE id = :id")
    suspend fun markFailure(id: Long, attempts: Int, err: String?)
}

/**
 * Durable, on purpose: unlike [mu.carfection.pos.core.database.PosDatabase] (a disposable
 * read-cache), a queued write can't be thrown away on a schema bump. Any future schema
 * change here MUST ship a real Room migration rather than a destructive fallback.
 */
@Database(entities = [OutboxOp::class], version = 1, exportSchema = false)
abstract class OutboxDatabase : RoomDatabase() {
    abstract fun outboxDao(): OutboxDao
}
