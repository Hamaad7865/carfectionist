package mu.carfection.pos.ui

import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.runtime.compositionLocalOf

/**
 * The camera launcher is owned by MainActivity, not by the composable that shows the
 * "Take photo" button. On a memory-tight tablet the whole Compose tree can be torn down
 * while the external camera app is in the foreground; a launcher registered inside a
 * composable would be unregistered by then and its result silently dropped. Hoisting it to
 * the Activity keeps the result callback alive across that teardown.
 */
val LocalPhotoCapture = compositionLocalOf<ActivityResultLauncher<Uri>?> { null }
