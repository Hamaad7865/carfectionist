package mu.carfection.pos.core.hardware

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** A finished capture: which feature asked for it, and the JPEG the camera wrote. */
data class CaptureResult(val target: String, val file: File)

/**
 * Coordinates the one Activity-level camera launcher between features. The external camera
 * can tear the whole Compose tree down while foregrounded, so nothing composable can carry
 * the pending capture; this singleton and the Activity-scoped ViewModels that collect from
 * it survive. Targets: "jobs:before", "jobs:after", "intake".
 */
@Singleton
class CaptureBus @Inject constructor() {
    private var pending: Pair<String, File>? = null

    private val _results = MutableSharedFlow<CaptureResult>(extraBufferCapacity = 4)
    val results = _results.asSharedFlow()

    /** Tab to snap the shell back to after the round-trip ("jobs" | "intake"). */
    private val _returnTo = MutableStateFlow<String?>(null)
    val returnTo = _returnTo.asStateFlow()
    fun consumeReturn() { _returnTo.value = null }

    fun begin(target: String, file: File) { pending = target to file }

    /** Called from the Activity's TakePicture callback. */
    fun complete(ok: Boolean) {
        val (target, file) = pending ?: return
        pending = null
        _returnTo.value = target.substringBefore(':')
        if (ok && file.exists() && file.length() > 0) _results.tryEmit(CaptureResult(target, file))
        else runCatching { file.delete() }
    }
}
