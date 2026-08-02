package mu.carfection.pos.core.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import mu.carfection.pos.BuildConfig
import mu.carfection.pos.core.database.CustomerDao
import mu.carfection.pos.core.database.PosDatabase
import mu.carfection.pos.core.database.ProductDao
import mu.carfection.pos.core.sync.CapturedSaleReplayer
import mu.carfection.pos.core.sync.ConnectivityObserver
import mu.carfection.pos.core.sync.OUTBOX_MIGRATION_1_2
import mu.carfection.pos.core.sync.OUTBOX_MIGRATION_2_3
import mu.carfection.pos.core.sync.OfflineSaleDao
import mu.carfection.pos.core.sync.OnlineSignal
import mu.carfection.pos.core.sync.OutboxDao
import mu.carfection.pos.core.sync.OutboxDatabase
import mu.carfection.pos.core.sync.SaleRepositoryReplayer
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "pos_prefs")

/**
 * The two seams the offline-sale queue is built on. Bound rather than injected concretely
 * so the queue's rules — what retries, what stops, what waits for a person — can be tested
 * without a network stack behind them.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SyncBindings {
    @Binds abstract fun onlineSignal(impl: ConnectivityObserver): OnlineSignal
    @Binds abstract fun capturedSaleReplayer(impl: SaleRepositoryReplayer): CapturedSaleReplayer
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun supabase(): SupabaseClient = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
    ) {
        install(Auth)
        install(Postgrest)
        install(io.github.jan.supabase.storage.Storage)
        // Realtime: a car going ready is an event another person causes on another device.
        // No local alarm can foresee it, so the server has to tell us.
        install(io.github.jan.supabase.realtime.Realtime)
    }

    @Provides
    @Singleton
    fun database(@ApplicationContext ctx: Context): PosDatabase =
        Room.databaseBuilder(ctx, PosDatabase::class.java, "pos.db")
            .fallbackToDestructiveMigration() // read-cache only; safe to rebuild
            .build()

    @Provides fun productDao(db: PosDatabase): ProductDao = db.productDao()
    @Provides fun customerDao(db: PosDatabase): CustomerDao = db.customerDao()

    // Durable queue for offline writes — its own DB so the disposable read-cache above
    // can keep rebuilding without ever discarding a pending write. NO destructive
    // fallback, ever: this now also holds sales a customer has already paid for.
    @Provides
    @Singleton
    fun outboxDatabase(@ApplicationContext ctx: Context): OutboxDatabase =
        Room.databaseBuilder(ctx, OutboxDatabase::class.java, "outbox.db")
            .addMigrations(OUTBOX_MIGRATION_1_2, OUTBOX_MIGRATION_2_3)
            .build()

    @Provides fun outboxDao(db: OutboxDatabase): OutboxDao = db.outboxDao()
    @Provides fun offlineSaleDao(db: OutboxDatabase): OfflineSaleDao = db.offlineSaleDao()

    @Provides
    @Singleton
    fun dataStore(@ApplicationContext ctx: Context): DataStore<Preferences> = ctx.dataStore
}
