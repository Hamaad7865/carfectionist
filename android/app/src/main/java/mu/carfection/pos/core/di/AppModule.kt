package mu.carfection.pos.core.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
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
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "pos_prefs")

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
    }

    @Provides
    @Singleton
    fun database(@ApplicationContext ctx: Context): PosDatabase =
        Room.databaseBuilder(ctx, PosDatabase::class.java, "pos.db")
            .fallbackToDestructiveMigration() // read-cache only; safe to rebuild
            .build()

    @Provides fun productDao(db: PosDatabase): ProductDao = db.productDao()
    @Provides fun customerDao(db: PosDatabase): CustomerDao = db.customerDao()

    @Provides
    @Singleton
    fun dataStore(@ApplicationContext ctx: Context): DataStore<Preferences> = ctx.dataStore
}
