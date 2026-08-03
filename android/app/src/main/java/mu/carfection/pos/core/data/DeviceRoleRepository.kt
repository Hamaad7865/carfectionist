package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * This device's role, cached on disk.
 *
 * Kept rather than asked for, because the answer decides which tabs exist and the shell
 * is built before any network call resolves — and because a tablet that boots during an
 * outage must still know what it is. Refreshed on every register_device call (login, then
 * every four minutes), so flipping the switch on the web lands here on its own.
 */
@Singleton
class DeviceRoleRepository @Inject constructor(
    private val prefs: DataStore<Preferences>,
) {
    private val key = booleanPreferencesKey("device_takes_payments")

    /** Defaults to true — see [takesPaymentsOf]: unknown fails toward being able to sell. */
    val takesPayments: Flow<Boolean> = prefs.data.map { it[key] ?: true }

    suspend fun remember(takes: Boolean) = prefs.edit { it[key] = takes }
}
