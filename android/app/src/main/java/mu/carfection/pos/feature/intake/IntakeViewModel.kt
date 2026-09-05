package mu.carfection.pos.feature.intake

import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.IntakeHandoff
import mu.carfection.pos.core.data.IntakeHandoffBus
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.hardware.CaptureBus
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.NewVehicleDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.VehicleDto
import java.io.File
import mu.carfection.pos.core.network.uiMessage
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
    val searching: Boolean = false, // asking the server after the local cache came up empty
    val newCustOpen: Boolean = false,
    val nName: String = "",
    val nPhone: String = "",
    // business-entity fields — only filled/shown when nIsCompany is on
    val nIsCompany: Boolean = false,
    val nEmail: String = "",
    val nAddress: String = "",
    val nBrn: String = "",
    val nVat: String = "",
    val customer: CustomerEntity? = null,
    val vehicles: List<VehicleDto> = emptyList(),
    // Yogen brings three cars and they are one visit, not three trips to the counter:
    // TICK the cars, and the condition below is captured per car through a plate tab.
    val picked: List<VehicleDto> = emptyList(),
    val activeId: String? = null,
    val addVehOpen: Boolean = false,
    val nvPlate: String = "",
    val nvMake: String = "",
    val nvModel: String = "",
    val nvColour: String = "",
    val nvCategory: String = "",
    val markerType: DamageType = DamageType.SCRATCH,
    // Condition is PER CAR — a scratch belongs to one bonnet. Keyed by vehicle id so
    // each car's job card carries its own damage report and nobody else's.
    val markersByCar: Map<String, List<DamageMarker>> = emptyMap(),
    // intake condition photos: storage paths per car + signed thumbnail URLs
    val photosByCar: Map<String, List<String>> = emptyMap(),
    val photoUrls: Map<String, String> = emptyMap(),
    val photoUploading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    // Someone already on file who looks like the one being typed, or the person already holding
    // the plate being added. Both exist so the app can OFFER the record instead of telling
    // whoever is standing at the counter to go and find it — which is what produced two
    // "Yan Toinette" and four "Lucas Lutchmoodoo", each with a made-up plate.
    val existingCustomer: CustomerEntity? = null,
    val plateTaken: mu.carfection.pos.core.network.PlateHolder? = null,
) {
    /** The car whose tab is open. Everything in the condition panel belongs to this one. */
    val vehicle: VehicleDto? get() = picked.firstOrNull { it.id == activeId } ?: picked.firstOrNull()
    val markers: List<DamageMarker> get() = vehicle?.let { markersByCar[it.id] }.orEmpty()
    val photoPaths: List<String> get() = vehicle?.let { photosByCar[it.id] }.orEmpty()
    /** Damage notes across every ticked car — what the footer counts. */
    val markerTotal: Int get() = picked.sumOf { markersByCar[it.id]?.size ?: 0 }
}

@HiltViewModel
class IntakeViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val api: PosApi,
    private val captures: CaptureBus,
    private val handoff: IntakeHandoffBus,
    private val session: SessionRepository,
) : ViewModel() {
    private val _s = MutableStateFlow(IntakeState())
    val state = _s.asStateFlow()
    private var allCustomers: List<CustomerEntity> = emptyList()

    init {
        viewModelScope.launch { catalog.customers.collect { allCustomers = it } }
        viewModelScope.launch {
            captures.results.collect { r ->
                if (r.target == "intake") { addPhoto(r.file.readBytes()); runCatching { r.file.delete() } }
            }
        }
        // Activity-scoped: clear one operator's in-progress intake (customer, vehicle, markers,
        // photos) on sign-out, so the next operator doesn't start a quote for the wrong customer.
        viewModelScope.launch { session.isLoggedIn.collect { if (it == false) reset() } }
    }

    // ── condition photos ───────────────────────────────────────────────────────
    /** The camera round-trip is coordinated by [CaptureBus] — see its docs. */
    fun beginCapture(file: File) = captures.begin("intake", file)

    private fun addPhoto(bytes: ByteArray) {
        val vehicle = _s.value.vehicle ?: run { _s.update { it.copy(error = "Pick a vehicle before adding photos") }; return }
        _s.update { it.copy(photoUploading = true) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("Not synced yet")
                api.uploadIntakePhoto(tenant, vehicle.id, bytes)
            }.onSuccess { path ->
                val url = runCatching { api.signedPhotoUrl(path) }.getOrNull()
                _s.update {
                    // Files the shot against the car whose tab was open, not "the intake" —
                    // three cars in the bay means three separate before-photo sets.
                    it.copy(
                        photoUploading = false,
                        photosByCar = it.photosByCar + (vehicle.id to (it.photosByCar[vehicle.id].orEmpty() + path)),
                        photoUrls = if (url != null) it.photoUrls + (path to url) else it.photoUrls,
                    )
                }
            }.onFailure { e -> _s.update { it.copy(photoUploading = false, error = "Couldn’t save the photo — ${e.uiMessage("try again")}") } }
        }
    }

    private var searchJob: kotlinx.coroutines.Job? = null

    /**
     * Local cache first (instant, works offline), then the SERVER.
     *
     * The cache is only as fresh as the last sync, so a customer added on the web, on the other
     * tablet, or moments ago on this one was simply absent — and "not found" is what makes staff
     * create a duplicate. The server pass is what makes "not in the system" mean it.
     */
    fun setQuery(q: String) {
        val query = q.trim().lowercase()
        val local = mu.carfection.pos.core.data.rankedCustomerMatches(allCustomers, query, 6)
        _s.update { it.copy(query = q, results = local, searching = query.length >= 2 && local.isEmpty()) }

        searchJob?.cancel()
        if (query.length < 2) return
        searchJob = viewModelScope.launch {
            kotlinx.coroutines.delay(250) // let typing settle before asking the server
            // Name/phone AND plate — the box has always said "or plate", so it must mean it.
            // Wide server limit: the ranking below picks the best 8, so an alphabetical
            // slice must not have already dropped the name that starts with the term.
            val remote = api.searchCustomers(query, limit = 20) + api.searchCustomersByPlate(query)
            // Merge, keeping the local hits first and dropping anything already shown.
            val seen = local.map { it.id }.toMutableSet()
            val merged = local + remote.filter { seen.add(it.id) }.map { CustomerEntity(it.id, it.name, it.phone) }
            // Cache what the server found, so the next search is instant and offline-safe.
            remote.forEach { runCatching { catalog.cacheCustomer(CustomerEntity(it.id, it.name, it.phone)) } }
            if (_s.value.query.trim().lowercase() == query) {
                _s.update { it.copy(results = mu.carfection.pos.core.data.rankedCustomerMatches(merged, query, 8), searching = false) }
            }
        }
    }

    fun toggleNewCust() = _s.update { it.copy(newCustOpen = !it.newCustOpen, error = null) }
    fun setNName(v: String) = _s.update { it.copy(nName = v) }
    fun setNPhone(v: String) = _s.update { it.copy(nPhone = v) }
    fun setNIsCompany(v: Boolean) = _s.update { it.copy(nIsCompany = v) }
    fun setNEmail(v: String) = _s.update { it.copy(nEmail = v) }
    fun setNAddress(v: String) = _s.update { it.copy(nAddress = v) }
    fun setNBrn(v: String) = _s.update { it.copy(nBrn = v) }
    fun setNVat(v: String) = _s.update { it.copy(nVat = v) }

    /**
     * Create the customer — unless they are already on file.
     *
     * The schema's unique index is on the PLATE, not the person, so making the same customer
     * twice has always just worked, and only their car got refused. Staff then got past the
     * refusal with a plate that was not real and the job landed on the duplicate. So ask first,
     * and if they exist, offer them ([useExistingCustomer]) rather than creating a second.
     */
    fun saveNewCustomer(force: Boolean = false) {
        val st = _s.value
        val name = st.nName.trim()
        if (name.isBlank()) { _s.update { it.copy(error = "Enter a name") }; return }
        if (!force) {
            _s.update { it.copy(busy = true, error = null, existingCustomer = null) }
            viewModelScope.launch {
                val hit = api.findExistingCustomer(name, st.nPhone.trim().ifBlank { null })
                if (hit != null) {
                    _s.update { it.copy(busy = false, existingCustomer = CustomerEntity(hit.id, hit.name, hit.phone)) }
                } else {
                    _s.update { it.copy(busy = false) }
                    saveNewCustomer(force = true)
                }
            }
            return
        }
        _s.update { it.copy(busy = true, error = null, existingCustomer = null) }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("no tenant")
                api.insertCustomer(
                    NewCustomerDto(
                        tenantId = tenant,
                        name = name,
                        phone = st.nPhone.trim().ifBlank { null },
                        isCompany = st.nIsCompany,
                        email = st.nEmail.trim().ifBlank { null },
                        address = st.nAddress.trim().ifBlank { null },
                        brn = st.nBrn.trim().ifBlank { null },
                        vatNumber = st.nVat.trim().ifBlank { null },
                    ),
                )
            }.onSuccess { c ->
                _s.update { it.copy(busy = false, newCustOpen = false, nName = "", nPhone = "", nIsCompany = false, nEmail = "", nAddress = "", nBrn = "", nVat = "") }
                // Into the cache NOW — otherwise the next search for this very customer finds
                // nothing and whoever is standing there creates them a second time. Email rides
                // along so it reaches the quote's send dialog without a retype off the card.
                runCatching { catalog.cacheCustomer(CustomerEntity(c.id, c.name, c.phone, c.email)) }
                pickCustomer(CustomerEntity(c.id, c.name, c.phone, c.email))
            }.onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /** Take the record we found instead of making a second one. */
    fun useExistingCustomer() {
        val c = _s.value.existingCustomer ?: return
        _s.update {
            it.copy(
                existingCustomer = null, newCustOpen = false, error = null,
                nName = "", nPhone = "", nIsCompany = false, nEmail = "", nAddress = "", nBrn = "", nVat = "",
            )
        }
        pickCustomer(c)
    }

    /** They really are a different person with the same name — carry on and create them. */
    fun createAnyway() {
        _s.update { it.copy(existingCustomer = null) }
        saveNewCustomer(force = true)
    }

    fun dismissExisting() = _s.update { it.copy(existingCustomer = null) }

    /**
     * The plate belongs to someone else — go to them, and to that car.
     *
     * This is the whole point: the old message named the owner and left staff to find them,
     * so the quicker path was to alter the plate until it was accepted.
     */
    fun usePlateHolder() {
        val h = _s.value.plateTaken ?: return
        _s.update {
            it.copy(
                plateTaken = null, addVehOpen = false, error = null,
                nvPlate = "", nvMake = "", nvModel = "", nvColour = "", nvCategory = "",
            )
        }
        pickCustomer(CustomerEntity(h.customer.id, h.customer.name, h.customer.phone))
        // pickCustomer refetches the cars; tick the one they were trying to type.
        _s.update { it.copy(picked = listOf(h.vehicle), activeId = h.vehicle.id) }
    }

    fun dismissPlateTaken() = _s.update { it.copy(plateTaken = null) }

    fun pickCustomer(c: CustomerEntity) {
        _s.update {
            it.copy(
                customer = c, query = "", results = emptyList(), vehicles = emptyList(),
                picked = emptyList(), activeId = null, markersByCar = emptyMap(), photosByCar = emptyMap(),
            )
        }
        viewModelScope.launch { runCatching { api.fetchVehicles(c.id) }.onSuccess { vs -> _s.update { it.copy(vehicles = vs) } } }
    }

    fun clearCustomer() = _s.update {
        it.copy(
            customer = null, vehicles = emptyList(), picked = emptyList(), activeId = null,
            markersByCar = emptyMap(), photosByCar = emptyMap(), addVehOpen = false,
        )
    }

    fun toggleAddVeh() = _s.update { it.copy(addVehOpen = !it.addVehOpen, error = null) }
    fun setNvPlate(v: String) = _s.update { it.copy(nvPlate = v) }
    fun setNvMake(v: String) = _s.update { it.copy(nvMake = v) }
    fun setNvModel(v: String) = _s.update { it.copy(nvModel = v) }
    fun setNvColour(v: String) = _s.update { it.copy(nvColour = v) }
    fun setNvCategory(v: String) = _s.update { it.copy(nvCategory = v) }

    fun saveVehicle() {
        val st = _s.value
        val cust = st.customer ?: return
        val plate = st.nvPlate.trim()
        if (plate.isBlank()) { _s.update { it.copy(error = "Enter a plate") }; return }
        viewModelScope.launch {
            runCatching {
                val tenant = catalog.tenantId() ?: error("no tenant")
                api.insertVehicle(NewVehicleDto(tenant, cust.id, plate, st.nvMake.trim().ifBlank { null }, st.nvModel.trim().ifBlank { null }, st.nvColour.trim().ifBlank { null }, st.nvCategory.trim().ifBlank { null }))
            }.onSuccess { v ->
                _s.update {
                    it.copy(
                        vehicles = it.vehicles + v, picked = it.picked + v, activeId = v.id,
                        addVehOpen = false, nvPlate = "", nvMake = "", nvModel = "", nvColour = "", nvCategory = "",
                    )
                }
            }.onFailure { e ->
                val dup = (e.message ?: "").contains("duplicate", true) || (e.message ?: "").contains("plate_normalized", true)
                if (dup) {
                    // Offer the record, don't describe it. Naming the owner and leaving staff to
                    // go and search is what made altering the plate the faster way out.
                    val holder = api.plateHolder(plate)
                    if (holder != null) _s.update { it.copy(plateTaken = holder, error = null) }
                    else _s.update { it.copy(error = "$plate is already registered to another customer — search for them by name or phone.") }
                } else _s.update { it.copy(error = e.uiMessage()) }
            }
        }
    }

    /**
     * Tick or untick a car. Ticking opens its tab, so the marks that follow land on the car
     * the operator just chose. Unticking drops that car's condition record — it is not going
     * on any job card, and keeping it would let a stray scratch reappear later.
     */
    fun toggleVehicle(v: VehicleDto) = _s.update {
        if (it.picked.any { p -> p.id == v.id }) {
            val rest = it.picked.filterNot { p -> p.id == v.id }
            it.copy(
                picked = rest,
                activeId = if (it.activeId == v.id) rest.firstOrNull()?.id else it.activeId,
                markersByCar = it.markersByCar - v.id,
                photosByCar = it.photosByCar - v.id,
            )
        } else {
            it.copy(picked = it.picked + v, activeId = v.id)
        }
    }

    /** Switch the condition panel to another ticked car. */
    fun showCar(id: String) = _s.update { if (it.picked.any { p -> p.id == id }) it.copy(activeId = id) else it }

    fun setMarkerType(t: DamageType) = _s.update { it.copy(markerType = t) }

    private fun withActiveMarkers(f: (List<DamageMarker>) -> List<DamageMarker>) = _s.update { st ->
        val id = st.vehicle?.id ?: return@update st
        st.copy(markersByCar = st.markersByCar + (id to f(st.markersByCar[id].orEmpty())))
    }
    fun addMarker(x: Float, y: Float) = withActiveMarkers { it + DamageMarker(x, y, _s.value.markerType.letter, _s.value.markerType.color) }
    fun removeMarker(i: Int) = withActiveMarkers { it.filterIndexed { j, _ -> j != i } }
    fun clearMarkers() = withActiveMarkers { emptyList() }

    /**
     * Intake ends at the QUOTATION, not a job (the job is created when the quote is
     * accepted). Hands the builder the customer + vehicle, condition markers (as the
     * jobs.damage_markers shape the web reads) and any intake photos, then resets for
     * the next walk-in. Returns false when nothing is picked yet.
     */
    fun startQuotation(): Boolean {
        val st = _s.value
        val c = st.customer ?: return false
        if (st.picked.isEmpty()) return false
        val cars = st.picked.map { v ->
            val marks = st.markersByCar[v.id].orEmpty()
            mu.carfection.pos.core.data.HandoffCar(
                vehicleId = v.id, plate = v.plate,
                label = listOfNotNull(v.make, v.model).joinToString(" ").ifBlank { "Vehicle" },
                markers = buildJsonArray {
                    marks.forEach { m ->
                        add(buildJsonObject {
                            // The shared Marker shape is PERCENT (0–100, 1dp) of the 260:520
                            // diagram — the web renders `left: x%`. The pad captures fractions,
                            // so scale at this seam.
                            put("x", kotlin.math.round(m.xFrac * 1000.0) / 10.0)
                            put("y", kotlin.math.round(m.yFrac * 1000.0) / 10.0)
                            put("type", DamageType.entries.first { it.letter == m.letter }.label.lowercase())
                        })
                    }
                },
                markerCount = marks.size,
                photoPaths = st.photosByCar[v.id].orEmpty(),
            )
        }
        handoff.publish(
            IntakeHandoff(
                customerId = c.id, customerName = c.name,
                // The number and email captured at reception, so the quote's WhatsApp/email
                // fields are prefilled instead of staff retyping them off the customer's card.
                customerPhone = c.phone, customerEmail = c.email,
                cars = cars,
            ),
        )
        _s.value = IntakeState()
        return true
    }

    fun reset() { _s.value = IntakeState() }

    fun summary(s: IntakeState): String = when {
        s.customer == null -> "Pick a customer to begin."
        s.picked.isEmpty() -> "${s.customer.name} · pick a vehicle."
        else -> {
            val cars = if (s.picked.size == 1) s.picked.first().plate else "${s.picked.size} cars"
            val n = s.markerTotal
            "${s.customer.name} · $cars · $n damage note${if (n == 1) "" else "s"}"
        }
    }
}
