package mu.carfection.pos.ui

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
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.lifecycle.HiltViewModel
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.feature.counter.CounterScreen
import mu.carfection.pos.feature.login.LoginScreen
import mu.carfection.pos.feature.till.TillScreen
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(session: SessionRepository) : ViewModel() {
    val isLoggedIn = session.isLoggedIn
}

@Composable
fun PosApp(rootViewModel: RootViewModel = hiltViewModel()) {
    val loggedIn by rootViewModel.isLoggedIn.collectAsState(initial = null)

    when (loggedIn) {
        null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        false -> LoginScreen()
        true -> {
            val nav = rememberNavController()
            NavHost(navController = nav, startDestination = "counter") {
                composable("counter") { CounterScreen(onOpenTill = { nav.navigate("till") }) }
                composable("till") { TillScreen(onBack = { nav.popBackStack() }) }
            }
        }
    }
}
