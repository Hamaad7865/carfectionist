package mu.carfection.pos.feature.intake

import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.NewVehicleDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.VehicleDto
import javax.inject.Inject

enum class DamageType(val label: String, val color: Color, val letter: String) {
    SCRATCH("Scratch", Color(0xFFC17A00), "S"),
    DENT("Dent", Color(0xFFD63A3A), "D"),
    CHIP("Chip", Color(0xFF5A67D8), "C"),
    SWIRL("Swirl", Color(0xFF1FA361), "W"),
}

data class IntakeState(
    val query: String = "",
    val results: List<CustomerEntity> = emptyList(),
    val newCustOpen: Boolean = false,
    val nName: String = "",
    val nPhone: String = "",
    val customer: CustomerEntity? = null,
    val vehicles: List<VehicleDto> = emptyList(),
    val vehicle: VehicleDto? = null,
    val addVehOpen: Boolean = false,
    val nvPlate: String = "",
    val nvMake: String = "",
    val nvModel: String = "",
    val nvColour: String = "",
    val markerType: DamageType = DamageType.SCRATCH,
    val markers: List<DamageMarker> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
    val doneJobId: String? = null,
)

@HiltViewModel
class IntakeViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val api: PosApi,
) : ViewModel() {
    private val _s = MutableStateFlow(IntakeState())
    val state = _s.asStateFlow()
    private var allCustomers: List<CustomerEntity> = emptyList()

    init { viewModelScope.launch { catalog.customers.collect { allCustomers = it } } }

    fun setQuery(q: String) {
        val query = q.trim().lowercase()
        val results = if (query.isBlank()) emptyList()
        else allCustomers.filter { it.name.lowercase().contains(query) || (it.phone ?: "").contains(query) }.take(6)
        _s.update { it.copy(query = q, results = results) }
    }

    fun toggleNewCust() = _s.update { it.copy(newCustOpen = !it.newCustOpen, error = null) }
    fun setNName(v: String) = _s.update { it.copy(nName = v) }
    fun setNPhone(v: String) = _s.update { it.copy(nPhone = v) }

    fun saveNewCustomer() {
        val name = _s.value.nName.trim()
        if (name.isBlank()) { _s.update { it.copy(error = "Enter a name") }; return }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("no tenant")
                api.insertCustomer(NewCustomerDto(tenant, name, _s.value.nPhone.trim().ifBlank { null }))
            }.onSuccess { c ->
                _s.update { it.copy(newCustOpen = false, nName = "", nPhone = "") }
                pickCustomer(CustomerEntity(c.id, c.name, c.phone))
            }.onFailure { e -> _s.update { it.copy(error = e.message) } }
        }
    }

    fun pickCustomer(c: CustomerEntity) {
        _s.update { it.copy(customer = c, query = "", results = emptyList(), vehicles = emptyList(), vehicle = null) }
        viewModelScope.launch { runCatching { api.fetchVehicles(c.id) }.onSuccess { vs -> _s.update { it.copy(vehicles = vs) } } }
    }

    fun clearCustomer() = _s.update { it.copy(customer = null, vehicles = emptyList(), vehicle = null, addVehOpen = false) }

    fun toggleAddVeh() = _s.update { it.copy(addVehOpen = !it.addVehOpen, error = null) }
    fun setNvPlate(v: String) = _s.update { it.copy(nvPlate = v) }
    fun setNvMake(v: String) = _s.update { it.copy(nvMake = v) }
    fun setNvModel(v: String) = _s.update { it.copy(nvModel = v) }
    fun setNvColour(v: String) = _s.update { it.copy(nvColour = v) }

    fun saveVehicle() {
        val st = _s.value
        val cust = st.customer ?: return
        val plate = st.nvPlate.trim()
        if (plate.isBlank()) { _s.update { it.copy(error = "Enter a plate") }; return }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("no tenant")
                api.insertVehicle(NewVehicleDto(tenant, cust.id, plate, st.nvMake.trim().ifBlank { null }, st.nvModel.trim().ifBlank { null }, st.nvColour.trim().ifBlank { null }))
            }.onSuccess { v ->
                _s.update { it.copy(vehicles = it.vehicles + v, vehicle = v, addVehOpen = false, nvPlate = "", nvMake = "", nvModel = "", nvColour = "") }
            }.onFailure { e -> _s.update { it.copy(error = if ((e.message ?: "").contains("duplicate", true)) "That plate already exists" else e.message) } }
        }
    }

    fun pickVehicle(v: VehicleDto) = _s.update { it.copy(vehicle = v) }
    fun setMarkerType(t: DamageType) = _s.update { it.copy(markerType = t) }
    fun addMarker(x: Float, y: Float) = _s.update { it.copy(markers = it.markers + DamageMarker(x, y, it.markerType.letter, it.markerType.color)) }
    fun removeMarker(i: Int) = _s.update { it.copy(markers = it.markers.filterIndexed { j, _ -> j != i }) }
    fun clearMarkers() = _s.update { it.copy(markers = emptyList()) }

    fun start() {
        val st = _s.value
        val c = st.customer ?: return
        val v = st.vehicle ?: return
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching { api.createJob(c.id, v.id, if (st.markers.isEmpty()) null else "Intake: ${st.markers.size} pre-existing damage marks") }
                .onSuccess { id -> _s.update { it.copy(busy = false, doneJobId = id) } }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.message) } }
        }
    }

    fun reset() { _s.value = IntakeState() }

    fun summary(s: IntakeState): String = when {
        s.customer == null -> "Pick a customer to begin."
        s.vehicle == null -> "${s.customer.name} · pick a vehicle."
        else -> "${s.customer.name} · ${s.vehicle.plate} · ${s.markers.size} damage note${if (s.markers.size == 1) "" else "s"}"
    }
}
