package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject

/**
 * Alarms do not survive a reboot — Android drops every one of them. A tablet that loses
 * power at lunch would otherwise wake up with a board full of jobs it will never mention
 * again, so re-arm from the server the moment we are back.
 *
 * Also fires on MY_PACKAGE_REPLACED: installing a new APK clears alarms just as thoroughly.
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var api: PosApi
    @Inject lateinit var alarms: JobAlarms

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Offline at boot: nothing to re-arm from. JobWatcher re-arms as soon as the
                // app is opened and the network is back, so the alerts are only delayed.
                withTimeoutOrNull(TIMEOUT_MS) {
                    runCatching { api.fetchAlertableJobs() }.getOrNull()
                }?.let { alarms.armAll(it) }
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        const val TIMEOUT_MS = 15_000L
    }
}
