package mu.carfection.pos.feature.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import mu.carfection.pos.core.update.ReleaseManifest
import mu.carfection.pos.core.update.UpdateManager
import mu.carfection.pos.core.update.UpdateState
import javax.inject.Inject

@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val updates: UpdateManager,
) : ViewModel() {
    val state = updates.state

    /** Checked once when the app opens; silent if there's nothing newer or the check fails. */
    fun check() = viewModelScope.launch { updates.checkForUpdate() }
    fun install(manifest: ReleaseManifest) = viewModelScope.launch { updates.downloadAndInstall(manifest) }
    fun dismiss() = updates.dismiss()

    val current: UpdateState get() = state.value
}
