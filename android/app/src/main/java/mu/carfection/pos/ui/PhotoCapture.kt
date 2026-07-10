package mu.carfection.pos.ui

import android.content.Context
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.runtime.compositionLocalOf
import androidx.core.content.FileProvider
import java.io.File

/**
 * The camera launcher is owned by MainActivity, not by the composable that shows the
 * "Take photo" button. On a memory-tight tablet the whole Compose tree can be torn down
 * while the external camera app is in the foreground; a launcher registered inside a
 * composable would be unregistered by then and its result silently dropped. Hoisting it to
 * the Activity keeps the result callback alive across that teardown; CaptureBus routes the
 * result back to the feature that asked.
 */
val LocalPhotoCapture = compositionLocalOf<ActivityResultLauncher<Uri>?> { null }

/** Cache file the camera writes into + its FileProvider URI (see @xml/file_paths). */
fun newCaptureFile(ctx: Context): Pair<File, Uri> {
    val dir = File(ctx.cacheDir, "job_photos").apply { mkdirs() }
    val file = File(dir, "cap-${System.currentTimeMillis()}.jpg")
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
    return file to uri
}
