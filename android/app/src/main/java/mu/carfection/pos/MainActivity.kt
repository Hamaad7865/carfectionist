package mu.carfection.pos

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import dagger.hilt.android.AndroidEntryPoint
import mu.carfection.pos.core.data.OpenJobBus
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.core.notify.EXTRA_JOB_ID
import mu.carfection.pos.core.notify.JobWatcher
import mu.carfection.pos.ui.LocalPhotoCapture
import mu.carfection.pos.ui.PosApp
import mu.carfection.pos.ui.theme.CarfectionistPosTheme
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    // Routes the camera result to whichever feature began the capture (jobs / intake).
    @Inject lateinit var captureBus: CaptureBus

    // Listens for jobs going ready and keeps the schedule alarms armed.
    @Inject lateinit var jobWatcher: JobWatcher

    // A tapped notification opens that job on the board — the same latched bus the quote
    // builder's "View job" uses, so there is one way in, not two.
    @Inject lateinit var openJobBus: OpenJobBus

    // Registered on the Activity so the result survives a Compose teardown while the external
    // camera is foregrounded (which happens on a memory-tight tablet). Must be created before
    // the activity is STARTED, hence a property initializer.
    private val photoCapture =
        registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            captureBus.complete(ok)
        }

    // Asked once. A refusal is survivable: alarms still fire, they just cannot speak — so
    // nothing downstream depends on the answer.
    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        jobWatcher.start()
        routeToJob(intent)

        setContent {
            CarfectionistPosTheme {
                CompositionLocalProvider(LocalPhotoCapture provides photoCapture) {
                    PosApp()
                }
            }
        }
    }

    /** The activity is singleTop in practice — a tap while we are already open lands here. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeToJob(intent)
    }

    private fun routeToJob(intent: Intent?) {
        intent?.getStringExtra(EXTRA_JOB_ID)?.let { openJobBus.request(it) }
    }
}
