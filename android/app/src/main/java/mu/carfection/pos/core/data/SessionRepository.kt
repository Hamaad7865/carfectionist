package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Auth + device identity. RLS ties every query to the logged-in user's tenant. */
@Singleton
class SessionRepository @Inject constructor(
    private val client: SupabaseClient,
    private val prefs: DataStore<Preferences>,
) {
    private val deviceKey = stringPreferencesKey("device_id")

    /** null = still restoring; true/false = known. */
    val isLoggedIn: Flow<Boolean?> = client.auth.sessionStatus.map { status ->
        when (status) {
            is SessionStatus.Initializing -> null
            is SessionStatus.Authenticated -> true
            else -> false
        }
    }

    val userEmail: String?
        get() = client.auth.currentUserOrNull()?.email

    suspend fun signIn(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun signOut() = client.auth.signOut()

    /** Stable per-tablet id for the till (one open session per device). */
    suspend fun deviceId(): String {
        val current = prefs.data.first()[deviceKey]
        if (current != null) return current
        val fresh = "TAB-" + java.util.UUID.randomUUID().toString().take(4).uppercase()
        prefs.edit { it[deviceKey] = fresh }
        return fresh
    }
}
