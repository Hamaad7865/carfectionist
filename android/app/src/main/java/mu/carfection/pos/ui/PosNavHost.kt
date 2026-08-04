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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import mu.carfection.pos.BuildConfig
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.core.sync.ConnectivityObserver
import mu.carfection.pos.core.sync.OutboxRepository
import mu.carfection.pos.core.sync.catalogSyncActive
import mu.carfection.pos.core.sync.runCatalogSync
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
    private val outbox: OutboxRepository,
    private val offlineSales: mu.carfection.pos.core.sync.OfflineSaleRepository,
    private val catalog: CatalogRepository,
    private val captures: CaptureBus,
    private val api: PosApi,
    private val tillRepo: mu.carfection.pos.core.data.TillRepository,
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
) : ViewModel() {
    val isLoggedIn = session.isLoggedIn
    val staffName: String get() = session.userName
    val staffRole: String get() = session.userRole
    val online = connectivity.online
    val pendingSync = outbox.pending

    /** Sales taken on this tablet that the server has not seen yet — money, not metadata. */
    val unsyncedSales = offlineSales.unsynced

    /** False on reception's tablet: no Checkout, no till, money is taken elsewhere. */
    val takesPayments = deviceRole.takesPayments.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, true)

    init {
        // Start filing held sales as soon as the app has a UI at all — not from
        // Application.onCreate, where building this graph (Supabase, Room, DataStore)
        // would sit on the main thread ahead of the first frame. This ViewModel is the
        // root of the shell and already holds that graph, so starting here costs nothing
        // and still runs long before anyone reaches the counter.
        offlineSales.start()
    }

    // ── manual sync (the header button) ───────────────────────────────────────
    // Everything else here is either push-on-write (outbox) or read-on-navigate (screens
    // fetch when opened) — the one thing sitting in a local cache that only refreshes on
    // its own schedule is the catalogue (products/prices/settings), so that's what a tap
    // pulls fresh. The outbox drains itself the instant connectivity returns; draining it
    // here too just means a tap also clears a backlog without waiting for that edge.
    private val _syncing = MutableStateFlow(false)
    val syncing = _syncing.asStateFlow()
    fun syncNow() {
        if (_syncing.value) return
        viewModelScope.launch {
            _syncing.value = true
            try {
                outbox.drain()
                offlineSales.drain() // money first — a held sale is what a tap is usually chasing
                catalog.refresh()
            } catch (_: Exception) {
                // Silent: the sync pill already shows offline/pending state on failure.
            } finally {
                _syncing.value = false
            }
        }
    }

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
        if (next == PosTab.SALE && !takesPayments.value) return // the tab does not exist here
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
        if (backStack.isEmpty()) return
        val prev = backStack.removeLast()
        _backDepth.value = backStack.size
        // Every other route to SALE re-checks the role where it is used; this one did not.
        // SALE can only be in the stack from the startup window before the cached role loads,
        // and the correcting collector clears the stack — so this is belt to that braces.
        _tab.value = mu.carfection.pos.core.data.tabAfterRoleChange(prev, takesPayments.value)
    }
    private fun resetNav() {
        backStack.clear(); _backDepth.value = 0
        _tab.value = mu.carfection.pos.core.data.landingTab(takesPayments.value)
        _showTill.value = false
    }

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

        // Load this device's open till on sign-in — the state that drives the checkout chip.
        // A quotation device has none and never will, so it does not ask.
        viewModelScope.launch {
            session.isLoggedIn.collect { logged ->
                _tillLoaded.value = false
                if (logged == true) {
                    if (takesPayments.value) runCatching { tillRepo.openSession() }
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
                    }.getOrNull()?.let { deviceRole.remember(mu.carfection.pos.core.data.takesPaymentsOf(it)) }
                    announced = true
                    while (true) {
                        delay(HEARTBEAT_MS)
                        runCatching { api.registerDevice(session.deviceId(), null, null, heartbeat = true) }
                            .getOrNull()?.let { deviceRole.remember(mu.carfection.pos.core.data.takesPaymentsOf(it)) }
                    }
                }
            }
        }
    }

    init {
        // The role arrives from disk (and then the server) after this ViewModel is built, so
        // the shell starts on SALE and is corrected here. Also covers a live switch: the
        // owner flips it on the web and the heartbeat brings it back within four minutes.
        viewModelScope.launch {
            takesPayments.collect { takes ->
                val next = mu.carfection.pos.core.data.tabAfterRoleChange(_tab.value, takes)
                if (next != _tab.value) {
                    _tab.value = next
                    backStack.clear(); _backDepth.value = 0
                    _showTill.value = false
                }
            }
        }
    }

    init {
        // Catalogue freshness: a price corrected in the back office must reach an open,
        // online tablet without anyone tapping Sync (the counter once kept ringing up a
        // shelf price the web had fixed hours earlier). Pulls immediately on login and on
        // the connectivity edge, then every CATALOG_SYNC_MS; offline or signed out, it
        // attempts nothing. Loop semantics live (tested) in core/sync/CatalogSync.kt.
        viewModelScope.launch {
            runCatalogSync(catalogSyncActive(session.isLoggedIn, connectivity.online), CATALOG_SYNC_MS) {
                catalog.refresh()
            }
        }
    }

    private companion object {
        const val HEARTBEAT_MS = 4 * 60_000L
        const val CATALOG_SYNC_MS = 5 * 60_000L
    }

    fun signOut() { viewModelScope.launch { session.signOut() } }
}

@Composable
fun PosApp(rootViewModel: RootViewModel = hiltViewModel()) {
    val loggedIn by rootViewModel.isLoggedIn.collectAsState(initial = null)
    val splashShown by rootViewModel.splashShown.collectAsState()

    // Check for a newer build once when the app opens; the overlay below shows the offer
    // if there is one. Silent otherwise.
    val updateVm: mu.carfection.pos.feature.update.UpdateViewModel = hiltViewModel()
    LaunchedEffect(Unit) { updateVm.check() }

    Box(Modifier.fillMaxSize()) {
        when (loggedIn) {
            null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            false -> LoginScreen()
            true -> {
                // The till no longer gates opening the app — staff land on the shell and get on
                // with it. Money discipline still holds where it actually matters: a payment
                // can't be recorded without an open till, and Checkout offers "open it" there.
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
                val heldSales by rootViewModel.unsyncedSales.collectAsState(initial = 0)
                val syncing by rootViewModel.syncing.collectAsState()
                val takesPayments by rootViewModel.takesPayments.collectAsState()
                PosShell(
                    active = tab,
                    onSelect = rootViewModel::navigate,
                    tabs = mu.carfection.pos.core.data.visibleTabs(takesPayments),
                    studioName = "Carfectionist",
                    staffName = rootViewModel.staffName,
                    staffRole = rootViewModel.staffRole,
                    online = online,
                    pendingSync = pendingSync,
                    heldSales = heldSales,
                    syncing = syncing,
                    // A tap pulls the catalogue fresh, drains anything queued, and checks the
                    // manifest for a newer build — the button covers "sync" and "update" in one
                    // press rather than making the operator find two places for it.
                    onSyncNow = { rootViewModel.syncNow(); updateVm.check() },
                    onStaffClick = { rootViewModel.signOut() },
                ) {
                    when (tab) {
                        PosTab.SALE ->
                            if (showTill) TillScreen(onBack = { rootViewModel.setShowTill(false) }, onOpened = { rootViewModel.setShowTill(false) })
                            else CounterScreen(onOpenTill = { rootViewModel.setShowTill(true) })
                        PosTab.INTAKE -> IntakeScreen(onStartQuote = { rootViewModel.navigate(PosTab.QUOTE) })
                        PosTab.QUOTE -> QuoteScreen(onGoIntake = { rootViewModel.navigate(PosTab.INTAKE) }, onViewJob = { rootViewModel.navigate(PosTab.JOBS) }, onGoCheckout = { rootViewModel.navigate(PosTab.SALE) })
                        PosTab.JOBS -> JobsScreen(onGoIntake = { rootViewModel.navigate(PosTab.INTAKE) }, onGoCheckout = { rootViewModel.navigate(PosTab.SALE) }, onGoQuotes = { rootViewModel.navigate(PosTab.QUOTE) })
                        PosTab.STOCK -> StockScreen()
                        PosTab.CERT -> CertScreen()
                        PosTab.CONTACTS -> mu.carfection.pos.feature.contacts.ContactsScreen(onJobStarted = { rootViewModel.navigate(PosTab.JOBS) })
                        PosTab.DASH -> DashScreen()
                        PosTab.SETTINGS -> SettingsScreen()
                    }
                }
            }
        }
        mu.carfection.pos.feature.update.UpdateOverlay(updateVm)
        if (!splashShown) SplashOverlay(onDone = rootViewModel::markSplashShown)
    }
}
