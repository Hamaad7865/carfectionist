package mu.carfection.pos.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.SessionRepository
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

@HiltViewModel
class RootViewModel @Inject constructor(
    private val session: SessionRepository,
    connectivity: ConnectivityObserver,
    outbox: OutboxRepository,
    private val captures: CaptureBus,
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
                var tab by rememberSaveable { mutableStateOf(PosTab.SALE) }
                var showTill by rememberSaveable { mutableStateOf(false) }
                // Where the user came from, so system back retraces screens instead of
                // dropping to Checkout. Saveable across teardown; capped, oldest dropped.
                val tabStack = rememberSaveable(
                    saver = listSaver(
                        save = { it.map(PosTab::name) },
                        restore = { saved -> saved.map(PosTab::valueOf).toMutableStateList() },
                    ),
                ) { mutableStateListOf<PosTab>() }
                fun navigate(next: PosTab) {
                    if (next != tab) {
                        tabStack.add(tab)
                        if (tabStack.size > 24) tabStack.removeAt(0)
                        tab = next
                    }
                    showTill = false
                }
                BackHandler(enabled = showTill || tabStack.isNotEmpty()) {
                    if (showTill) showTill = false
                    else tab = tabStack.removeAt(tabStack.lastIndex)
                }
                // After a photo capture (which can tear down + rebuild this tree), the
                // feature's ViewModel survives with its state; snap the shell back to it.
                val captureReturn by rootViewModel.captureReturnTo.collectAsState()
                LaunchedEffect(captureReturn) {
                    when (captureReturn) {
                        "jobs" -> { navigate(PosTab.JOBS); rootViewModel.consumeCaptureReturn() }
                        "intake" -> { navigate(PosTab.INTAKE); rootViewModel.consumeCaptureReturn() }
                    }
                }
                val online by rootViewModel.online.collectAsState()
                val pendingSync by rootViewModel.pendingSync.collectAsState(initial = 0)
                PosShell(
                    active = tab,
                    onSelect = ::navigate,
                    studioName = "Carfectionist",
                    staffName = rootViewModel.staffName,
                    staffRole = rootViewModel.staffRole,
                    online = online,
                    pendingSync = pendingSync,
                    onStaffClick = { rootViewModel.signOut() },
                ) {
                    when (tab) {
                        PosTab.SALE ->
                            if (showTill) TillScreen(onBack = { showTill = false }, onOpened = { showTill = false })
                            else CounterScreen(onOpenTill = { showTill = true })
                        PosTab.INTAKE -> IntakeScreen(onStartQuote = { navigate(PosTab.QUOTE) })
                        PosTab.QUOTE -> QuoteScreen(onGoIntake = { navigate(PosTab.INTAKE) })
                        PosTab.JOBS -> JobsScreen(onGoIntake = { navigate(PosTab.INTAKE) }, onGoCheckout = { navigate(PosTab.SALE) })
                        PosTab.STOCK -> StockScreen()
                        PosTab.CERT -> CertScreen()
                        PosTab.DASH -> DashScreen()
                        PosTab.SETTINGS -> SettingsScreen()
                    }
                }
            }
        }
        if (!splashShown) SplashOverlay(onDone = rootViewModel::markSplashShown)
    }
}
