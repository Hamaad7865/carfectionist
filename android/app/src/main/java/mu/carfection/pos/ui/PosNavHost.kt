package mu.carfection.pos.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import android.os.Build
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import mu.carfection.pos.BuildConfig
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.core.sync.ConnectivityObserver
import mu.carfection.pos.core.sync.OutboxRepository
import mu.carfection.pos.feature.counter.CounterScreen
import mu.carfection.pos.feature.cert.CertScreen
import mu.carfection.pos.feature.dash.DashScreen
import androidx.compose.runtime.LaunchedEffect
import mu.carfection.pos.feature.intake.IntakeScreen
import mu.carfection.pos.feature.jobs.JobsScreen
import mu.carfection.pos.feature.login.LoginScreen
import mu.carfection.pos.feature.quote.QuoteScreen
import mu.carfection.pos.feature.settings.SettingsScreen
import mu.carfection.pos.feature.stock.StockScreen
import mu.carfection.pos.feature.till.TillScreen
import javax.inject.Inject

/** Why the operator is locked on the till screen (owner-mandated discipline). */
enum class TillGate { NONE, OPEN_REQUIRED, STALE_CLOSE_REQUIRED }

@HiltViewModel
class RootViewModel @Inject constructor(
    private val session: SessionRepository,
    connectivity: ConnectivityObserver,
    outbox: OutboxRepository,
    private val captures: CaptureBus,
    private val api: PosApi,
    private val tillRepo: mu.carfection.pos.core.data.TillRepository,
) : ViewModel() {
    val isLoggedIn = session.isLoggedIn
    val staffName: String get() = session.userName
    val staffRole: String get() = session.userRole
    val online = connectivity.online
    val pendingSync = outbox.pending

    /** Tab to snap back to after a camera round-trip ("jobs" | "intake"), latched by CaptureBus. */
    val captureReturnTo = captures.returnTo
    fun consumeCaptureReturn() = captures.consumeReturn()

    /**
     * The intro plays once per process. It lives here rather than in `rememberSaveable`
     * because the camera round-trip tears the Compose tree down *without* restoring saved
     * state — the splash would replay after every photo. This ViewModel outlives that.
     */
    private val _splashShown = MutableStateFlow(false)
    val splashShown = _splashShown.asStateFlow()
    fun markSplashShown() { _splashShown.value = true }

    // ── navigation ──────────────────────────────────────────────────────────
    // Held here, not in rememberSaveable, for the same reason as splashShown: the camera
    // round-trip tears the Compose tree down without restoring saved state, which was wiping the
    // tab back-stack (leaving Back to drop to Checkout instead of retracing the real history).
    private val _tab = MutableStateFlow(PosTab.SALE)
    val tab = _tab.asStateFlow()
    private val _showTill = MutableStateFlow(false)
    val showTill = _showTill.asStateFlow()
    private val backStack = ArrayDeque<PosTab>()
    private val _backDepth = MutableStateFlow(0)
    val backDepth = _backDepth.asStateFlow()

    fun navigate(next: PosTab) {
        if (next != _tab.value) {
            backStack.addLast(_tab.value)
            if (backStack.size > 24) backStack.removeFirst()
            _backDepth.value = backStack.size
            _tab.value = next
        }
        _showTill.value = false
    }
    fun setShowTill(v: Boolean) { _showTill.value = v }
    fun back() {
        if (_showTill.value) { _showTill.value = false; return }
        if (backStack.isNotEmpty()) { _tab.value = backStack.removeLast(); _backDepth.value = backStack.size }
    }
    private fun resetNav() { backStack.clear(); _backDepth.value = 0; _tab.value = PosTab.SALE; _showTill.value = false }

    // ── till discipline (owner requirement) ──────────────────────────────────
    // A non-owner can't reach the app until the till is open, and a till left
    // open from a previous day must be counted + closed before today starts.
    val till = tillRepo.current
    private val _tillLoaded = MutableStateFlow(false)
    val tillLoaded = _tillLoaded.asStateFlow()

    fun tillGate(till: mu.carfection.pos.core.network.CashSessionDto?, loaded: Boolean): TillGate {
        if (!loaded || session.userRole.equals("owner", true)) return TillGate.NONE
        if (till == null) return TillGate.OPEN_REQUIRED
        val mu = java.time.ZoneId.of("Indian/Mauritius")
        val openedDay = till.openedAt?.let {
            runCatching { java.time.OffsetDateTime.parse(it).atZoneSameInstant(mu).toLocalDate() }.getOrNull()
        } ?: return TillGate.NONE
        return if (openedDay.isBefore(java.time.ZonedDateTime.now(mu).toLocalDate())) TillGate.STALE_CLOSE_REQUIRED
        else TillGate.NONE
    }

    init {
        // Start the next operator at a clean Checkout, not the previous one's tab/history.
        viewModelScope.launch { session.isLoggedIn.collect { if (it == false) resetNav() } }

        // Load this device's open till on sign-in — the state that drives tillGate.
        viewModelScope.launch {
            session.isLoggedIn.collect { logged ->
                _tillLoaded.value = false
                if (logged == true) {
                    runCatching { tillRepo.openSession() }
                    _tillLoaded.value = true
                }
            }
        }

        // Device registry (Point of Sale module): announce this terminal once per
        // process, then heartbeat while signed in so the web's online dot stays
        // honest. collectLatest cancels the heartbeat loop the moment the operator
        // signs out; a re-login inside the same process is a heartbeat, not a new
        // "terminal started" (operator switches are recorded by pin-login itself).
        viewModelScope.launch {
            var announced = false
            session.isLoggedIn.collectLatest { logged ->
                if (logged == true) {
                    runCatching {
                        api.registerDevice(session.deviceId(), Build.MODEL, BuildConfig.VERSION_NAME, heartbeat = announced)
                    }
                    announced = true
                    while (true) {
                        delay(HEARTBEAT_MS)
                        runCatching { api.registerDevice(session.deviceId(), null, null, heartbeat = true) }
                    }
                }
            }
        }
    }

    private companion object { const val HEARTBEAT_MS = 4 * 60_000L }

    fun signOut() { viewModelScope.launch { session.signOut() } }
}

@Composable
fun PosApp(rootViewModel: RootViewModel = hiltViewModel()) {
    val loggedIn by rootViewModel.isLoggedIn.collectAsState(initial = null)
    val splashShown by rootViewModel.splashShown.collectAsState()

    Box(Modifier.fillMaxSize()) {
        when (loggedIn) {
            null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            false -> LoginScreen()
            true -> {
                // ── owner-mandated till discipline ────────────────────────────
                // Staff can't reach the app until today's till is open; a till
                // left open from a previous day must be counted + closed first.
                val till by rootViewModel.till.collectAsState()
                val tillLoaded by rootViewModel.tillLoaded.collectAsState()
                val gate = rootViewModel.tillGate(till, tillLoaded)
                if (gate != TillGate.NONE) {
                    TillScreen(
                        onBack = {}, onOpened = {},
                        forced = true,
                        forcedBanner = when (gate) {
                            TillGate.STALE_CLOSE_REQUIRED ->
                                "Yesterday's till is still open. Count the drawer and close it — the period report will print — before starting today."
                            else ->
                                "Open the till to start the day. Count the float and enter it below — the owner requires this before any sale."
                        },
                    )
                } else {
                val tab by rootViewModel.tab.collectAsState()
                val showTill by rootViewModel.showTill.collectAsState()
                val backDepth by rootViewModel.backDepth.collectAsState()
                BackHandler(enabled = showTill || backDepth > 0) { rootViewModel.back() }
                // After a photo capture (which can tear down + rebuild this tree), the feature's
                // ViewModel — and now the nav state on RootViewModel — survive; snap back to it.
                val captureReturn by rootViewModel.captureReturnTo.collectAsState()
                LaunchedEffect(captureReturn) {
                    when (captureReturn) {
                        "jobs" -> { rootViewModel.navigate(PosTab.JOBS); rootViewModel.consumeCaptureReturn() }
                        "intake" -> { rootViewModel.navigate(PosTab.INTAKE); rootViewModel.consumeCaptureReturn() }
                    }
                }
                val online by rootViewModel.online.collectAsState()
                val pendingSync by rootViewModel.pendingSync.collectAsState(initial = 0)
                PosShell(
                    active = tab,
                    onSelect = rootViewModel::navigate,
                    studioName = "Carfectionist",
                    staffName = rootViewModel.staffName,
                    staffRole = rootViewModel.staffRole,
                    online = online,
                    pendingSync = pendingSync,
                    onStaffClick = { rootViewModel.signOut() },
                ) {
                    when (tab) {
                        PosTab.SALE ->
                            if (showTill) TillScreen(onBack = { rootViewModel.setShowTill(false) }, onOpened = { rootViewModel.setShowTill(false) })
                            else CounterScreen(onOpenTill = { rootViewModel.setShowTill(true) })
                        PosTab.INTAKE -> IntakeScreen(onStartQuote = { rootViewModel.navigate(PosTab.QUOTE) })
                        PosTab.QUOTE -> QuoteScreen(onGoIntake = { rootViewModel.navigate(PosTab.INTAKE) }, onViewJob = { rootViewModel.navigate(PosTab.JOBS) })
                        PosTab.JOBS -> JobsScreen(onGoIntake = { rootViewModel.navigate(PosTab.INTAKE) }, onGoCheckout = { rootViewModel.navigate(PosTab.SALE) })
                        PosTab.STOCK -> StockScreen()
                        PosTab.CERT -> CertScreen()
                        PosTab.DASH -> DashScreen()
                        PosTab.SETTINGS -> SettingsScreen()
                    }
                }
                }
            }
        }
        if (!splashShown) SplashOverlay(onDone = rootViewModel::markSplashShown)
    }
}
