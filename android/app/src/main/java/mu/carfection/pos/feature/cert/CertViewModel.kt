package mu.carfection.pos.feature.cert

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.network.CertificateDto
import mu.carfection.pos.core.network.PosApi
import javax.inject.Inject

data class CertState(
    val loading: Boolean = true,
    val certs: List<CertificateDto> = emptyList(),
    val activeCertId: String? = null,
    val toast: String? = null,
    val error: String? = null,
)

@HiltViewModel
class CertViewModel @Inject constructor(private val api: PosApi) : ViewModel() {
    private val _s = MutableStateFlow(CertState())
    val state = _s.asStateFlow()

    init { load() }

    fun load() {
        _s.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { api.fetchCertificates() }
                .onSuccess { c -> _s.update { it.copy(loading = false, certs = c, activeCertId = it.activeCertId ?: c.firstOrNull()?.id) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun active(s: CertState): CertificateDto? = s.certs.firstOrNull { it.id == s.activeCertId }
    fun pick(id: String) = _s.update { it.copy(activeCertId = id) }
    fun note(msg: String) = _s.update { it.copy(toast = msg) }
    fun clearToast() = _s.update { it.copy(toast = null) }
}
