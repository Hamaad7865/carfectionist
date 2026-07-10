package mu.carfection.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import dagger.hilt.android.AndroidEntryPoint
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.ui.LocalPhotoCapture
import mu.carfection.pos.ui.PosApp
import mu.carfection.pos.ui.theme.CarfectionistPosTheme
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    // Routes the camera result to whichever feature began the capture (jobs / intake).
    @Inject lateinit var captureBus: CaptureBus

    // Registered on the Activity so the result survives a Compose teardown while the external
    // camera is foregrounded (which happens on a memory-tight tablet). Must be created before
    // the activity is STARTED, hence a property initializer.
    private val photoCapture =
        registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            captureBus.complete(ok)
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
