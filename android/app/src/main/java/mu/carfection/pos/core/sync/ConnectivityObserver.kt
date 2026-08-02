package mu.carfection.pos.core.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-wide network reachability. Emits `true` only when the active network is both
 * connected and validated (real internet, not a captive portal), so the sync pill and
 * the outbox reflect whether writes can actually reach Supabase.
 *
 * Every callback answers from [snapshot], i.e. from the ACTIVE network. registerNetworkCallback
 * reports on every network matching the request, not just the one the app will use, and the
 * answer for a network we are not on is not an answer about us: a guest SSID appearing
 * unvalidated, or cellular flapping beside a perfectly good Wi-Fi, would otherwise flip this
 * to false. That is not cosmetic — it decides whether the counter rings a real invoice or
 * hands the customer a provisional slip.
 */
@Singleton
class ConnectivityObserver @Inject constructor(@ApplicationContext ctx: Context) : OnlineSignal {
    private val cm = ctx.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(snapshot())
    override val online: StateFlow<Boolean> = _online.asStateFlow()

    private fun snapshot(): Boolean {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    init {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { _online.value = snapshot() }
            override fun onLost(network: Network) { _online.value = snapshot() }
            // Fires for whichever network changed, which is often not the one we are using —
            // so re-read the active network rather than trusting this one's verdict.
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                _online.value = snapshot()
            }
        })
    }
}
