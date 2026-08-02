package mu.carfection.pos.core.sync

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
 *
 * v2 adds [OfflineSaleRow] — sales rung during an outage. Same rule, with money behind it:
 * dropping this table would destroy the only record that a customer paid.
 */
@Database(entities = [OutboxOp::class, OfflineSaleRow::class], version = 2, exportSchema = false)
abstract class OutboxDatabase : RoomDatabase() {
    abstract fun outboxDao(): OutboxDao
    abstract fun offlineSaleDao(): OfflineSaleDao
}

/** v1 → v2: the offline sales table. Additive — no existing queued write is touched. */
val OUTBOX_MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `offline_sales` (
                `saleKey` TEXT NOT NULL,
                `seq` INTEGER NOT NULL,
                `localRef` TEXT NOT NULL,
                `capturedAt` INTEGER NOT NULL,
                `tenantId` TEXT NOT NULL,
                `deviceId` TEXT NOT NULL,
                `cashSessionId` TEXT,
                `customerId` TEXT,
                `newCustomerId` TEXT,
                `newCustomerName` TEXT,
                `customerLabel` TEXT NOT NULL,
                `linesJson` TEXT NOT NULL,
                `orderDiscountKind` TEXT,
                `orderDiscountValue` REAL NOT NULL,
                `tendersJson` TEXT NOT NULL,
                `totalCents` INTEGER NOT NULL,
                `changeCents` INTEGER NOT NULL,
                `comment` TEXT,
                `status` TEXT NOT NULL,
                `attempts` INTEGER NOT NULL,
                `lastError` TEXT,
                `invoiceId` TEXT,
                `invoiceNumber` TEXT,
                `syncedAt` INTEGER,
                PRIMARY KEY(`saleKey`)
            )
            """.trimIndent(),
        )
    }
}
