package mu.carfection.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import dagger.hilt.android.AndroidEntryPoint
import mu.carfection.pos.feature.jobs.JobsViewModel
import mu.carfection.pos.ui.LocalPhotoCapture
import mu.carfection.pos.ui.PosApp
import mu.carfection.pos.ui.theme.CarfectionistPosTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    // Activity-scoped: the SAME instance the Jobs composables resolve via hiltViewModel().
    private val jobsViewModel: JobsViewModel by viewModels()

    // Registered on the Activity so its result survives a Compose teardown while the external
    // camera is foregrounded (which happens on a memory-tight tablet). Must be created before
    // the activity is STARTED, hence a property initializer.
    private val photoCapture =
        registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            jobsViewModel.onCaptureResult(ok)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CarfectionistPosTheme {
                CompositionLocalProvider(LocalPhotoCapture provides photoCapture) {
                    PosApp()
                }
            }
        }
    }
}
