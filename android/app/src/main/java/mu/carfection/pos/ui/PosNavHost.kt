package mu.carfection.pos.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.sync.ConnectivityObserver
import mu.carfection.pos.core.sync.OutboxRepository
import mu.carfection.pos.feature.counter.CounterScreen
import mu.carfection.pos.feature.cert.CertScreen
import mu.carfection.pos.feature.dash.DashScreen
import androidx.compose.runtime.LaunchedEffect
import mu.carfection.pos.feature.intake.IntakeScreen
import mu.carfection.pos.feature.jobs.JobsScreen
import mu.carfection.pos.feature.jobs.JobsViewModel
import mu.carfection.pos.feature.login.LoginScreen
import mu.carfection.pos.feature.quote.QuoteScreen
import mu.carfection.pos.feature.stock.StockScreen
import mu.carfection.pos.feature.till.TillScreen
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(
    private val session: SessionRepository,
    connectivity: ConnectivityObserver,
    outbox: OutboxRepository,
) : ViewModel() {
    val isLoggedIn = session.isLoggedIn
    val staffName: String get() = session.userName
    val staffRole: String get() = session.userRole
    val online = connectivity.online
    val pendingSync = outbox.pending
    fun signOut() { viewModelScope.launch { session.signOut() } }
}

@Composable
fun PosApp(rootViewModel: RootViewModel = hiltViewModel()) {
    val loggedIn by rootViewModel.isLoggedIn.collectAsState(initial = null)

    when (loggedIn) {
        null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        false -> LoginScreen()
        true -> {
            var tab by rememberSaveable { mutableStateOf(PosTab.SALE) }
            var showTill by rememberSaveable { mutableStateOf(false) }
            // After a photo capture (which can tear down + rebuild this tree), the Jobs
            // ViewModel survives with its open job; snap the shell back to that screen.
            val jobsVm: JobsViewModel = hiltViewModel()
            val returnToJobs by jobsVm.returnToJobs.collectAsState()
            LaunchedEffect(returnToJobs) {
                if (returnToJobs) { tab = PosTab.JOBS; showTill = false; jobsVm.consumeReturnToJobs() }
            }
            val online by rootViewModel.online.collectAsState()
            val pendingSync by rootViewModel.pendingSync.collectAsState(initial = 0)
            PosShell(
                active = tab,
                onSelect = { tab = it; showTill = false },
                studioName = "Carfectionist",
                staffName = rootViewModel.staffName,
                staffRole = rootViewModel.staffRole,
                online = online,
                pendingSync = pendingSync,
                onStaffClick = { rootViewModel.signOut() },
            ) {
                when (tab) {
                    PosTab.SALE ->
                        if (showTill) TillScreen(onBack = { showTill = false })
                        else CounterScreen(onOpenTill = { showTill = true })
                    PosTab.INTAKE -> IntakeScreen()
                    PosTab.QUOTE -> QuoteScreen(onGoIntake = { tab = PosTab.INTAKE })
                    PosTab.JOBS -> JobsScreen(onGoIntake = { tab = PosTab.INTAKE }, onGoCheckout = { tab = PosTab.SALE })
                    PosTab.STOCK -> StockScreen()
                    PosTab.CERT -> CertScreen()
                    PosTab.DASH -> DashScreen()
                    else -> PlaceholderScreen(tab)
                }
            }
        }
    }
}
