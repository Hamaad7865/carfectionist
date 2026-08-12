package mu.carfection.pos.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.OpenJobBus
import mu.carfection.pos.core.network.ContactDto
import mu.carfection.pos.core.network.ContactVehicleDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

data class ContactsState(
    val loading: Boolean = true,
    val query: String = "",
    val contacts: List<ContactDto> = emptyList(),
    /** The card that is open. Null = the list. */
    val open: ContactDto? = null,
    /** The vehicle being edited. A NEW car is `editing = null` with `adding = true`. */
    val editing: ContactVehicleDto? = null,
    val adding: Boolean = false,
    val draftPlate: String = "",
    val draftMake: String = "",
    val draftModel: String = "",
    val draftColour: String = "",
    val draftCategory: String = "",
    val draftCoated: Boolean = false,
    val draftNote: String = "",
    val draftActive: Boolean = true,
    /** Retired cars are hidden by default - they are history, not the working list. */
    val showRetired: Boolean = false,
    val addingCustomer: Boolean = false,
    val newName: String = "",
    val newPhone: String = "",
    val startingJob: Boolean = false,
    val startedJobId: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val toast: String? = null,
)

/**
 * The customer book, on the tablet.
 *
 * The back office has had contacts all along; the shop floor has not — so "has this car been
 * coated, and what do we know about it" meant asking someone or digging through old jobs. That
 * fact belongs on the CAR and is what this screen is for.
 */
@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: mu.carfection.pos.core.data.CatalogRepository,
    private val openJobBus: OpenJobBus,
) : ViewModel() {
    private val _s = MutableStateFlow(ContactsState())
    val state = _s.asStateFlow()

    private var searchJob: Job? = null

    init { load("") }

    fun setQuery(q: String) {
        _s.update { it.copy(query = q) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(250) // let typing settle before asking the server
            load(q)
        }
    }

    fun load(term: String) {
        _s.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { api.fetchContacts(term) }
                .onSuccess { rows -> _s.update { it.copy(loading = false, contacts = rows) } }
                .onFailure { e -> _s.update { it.copy(loading = false, error = e.uiMessage()) } }
        }
    }

    fun openContact(c: ContactDto) = _s.update { it.copy(open = c) }
    fun closeContact() = _s.update { it.copy(open = null, editing = null) }

    /** Edit an existing car - identity, coating and note in one place. */
    fun editVehicle(v: ContactVehicleDto) = _s.update {
        it.copy(
            editing = v, adding = false,
            draftPlate = v.plate, draftMake = v.make.orEmpty(), draftModel = v.model.orEmpty(),
            draftColour = v.colour.orEmpty(), draftCategory = v.category.orEmpty(),
            draftCoated = v.isCoated, draftNote = v.notes.orEmpty(), draftActive = v.isActive,
            error = null,
        )
    }

    fun addCustomer() = _s.update { it.copy(addingCustomer = true, newName = it.query.trim(), newPhone = "", error = null) }
    fun cancelAddCustomer() = _s.update { it.copy(addingCustomer = false, newName = "", newPhone = "", error = null) }
    fun setNewName(v: String) = _s.update { it.copy(newName = v) }
    fun setNewPhone(v: String) = _s.update { it.copy(newPhone = v) }

    /** Create the customer, then open their card so the car can be added straight away. */
    fun saveNewCustomer() {
        val st = _s.value
        val name = st.newName.trim()
        if (name.isBlank()) { _s.update { it.copy(error = "Enter a name") }; return }
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val tenant = requireNotNull(catalog.tenantId()) { "not synced" }
                api.insertCustomer(
                    mu.carfection.pos.core.network.NewCustomerDto(
                        tenantId = tenant, name = name, phone = st.newPhone.trim().ifBlank { null },
                    ),
                )
            }.onSuccess { c ->
                // Into the local cache too, so intake and the quote picker find them at once
                // rather than inviting a duplicate.
                runCatching { catalog.cacheCustomer(mu.carfection.pos.core.database.CustomerEntity(c.id, c.name, c.phone)) }
                _s.update { it.copy(busy = false, addingCustomer = false, newName = "", newPhone = "", toast = "Customer added") }
                load("")
                // Open the fresh card with the "add car" form already up.
                _s.update {
                    it.copy(
                        open = mu.carfection.pos.core.network.ContactDto(
                            id = c.id, name = c.name, phone = c.phone, email = null, isCompany = false, vehicles = emptyList(),
                        ),
                    )
                }
                addVehicle()
            }.onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    /** Add a car to the open customer. */
    fun addVehicle() = _s.update {
        it.copy(
            editing = null, adding = true,
            draftPlate = "", draftMake = "", draftModel = "", draftColour = "", draftCategory = "",
            draftCoated = false, draftNote = "", draftActive = true, error = null,
        )
    }

    fun setDraftPlate(v: String) = _s.update { it.copy(draftPlate = v) }
    fun setDraftMake(v: String) = _s.update { it.copy(draftMake = v) }
    fun setDraftModel(v: String) = _s.update { it.copy(draftModel = v) }
    fun setDraftColour(v: String) = _s.update { it.copy(draftColour = v) }
    fun setDraftCategory(v: String) = _s.update { it.copy(draftCategory = v) }
    fun setDraftCoated(v: Boolean) = _s.update { it.copy(draftCoated = v) }
    fun setDraftNote(v: String) = _s.update { it.copy(draftNote = v) }
    fun toggleShowRetired() = _s.update { it.copy(showRetired = !it.showRetired) }
    fun cancelEdit() = _s.update { it.copy(editing = null, adding = false, error = null) }

    /**
     * Mark a car not-used, or bring it back. Retiring also frees its plate, so the same
     * registration can be issued to whoever owns the car next.
     */
    fun setVehicleActive(v: ContactVehicleDto, active: Boolean) {
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { api.setVehicleActive(v.id, active) }
                .onSuccess {
                    _s.update {
                        it.copy(
                            busy = false, editing = null, adding = false,
                            toast = if (active) "Back in use" else "Marked not used",
                        )
                    }
                    reload()
                }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage()) } }
        }
    }

    fun saveVehicle() {
        val st = _s.value
        val plate = st.draftPlate.trim()
        if (plate.isBlank()) { _s.update { it.copy(error = "Enter a plate") }; return }
        val cust = st.open ?: return
        _s.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val make = st.draftMake.trim().ifBlank { null }
            val model = st.draftModel.trim().ifBlank { null }
            val colour = st.draftColour.trim().ifBlank { null }
            val category = st.draftCategory.trim().ifBlank { null }
            val note = st.draftNote.trim().ifBlank { null }
            runCatching {
                val id = if (st.adding) {
                    val tenant = requireNotNull(catalog.tenantId()) { "not synced" }
                    api.insertVehicle(
                        mu.carfection.pos.core.network.NewVehicleDto(tenant, cust.id, plate, make, model, colour, category),
                    ).id
                } else {
                    val v = requireNotNull(st.editing)
                    api.updateVehicle(v.id, plate, make, model, colour, category)
                    v.id
                }
                // Coating rides the same save - it is part of what staff came here to record.
                api.setVehicleCoating(id, st.draftCoated, note)
            }.onSuccess {
                _s.update {
                    it.copy(busy = false, editing = null, adding = false, toast = if (st.adding) "Car added" else "Saved")
                }
                reload()
            }.onFailure { e ->
                val msg = e.message ?: ""
                // Match the unique-violation SIGNAL, never the bare word "plate": supabase-kt appends
                // the request URL (…/vehicles?select=…,plate,…) to every error, so contains("plate")
                // fired on EVERY failure — an expired session then read as "already registered" for a
                // plate nobody holds. "duplicate"/"plate_normalized" only appear in a real 23505.
                val dup = msg.contains("duplicate", true) || msg.contains("plate_normalized", true)
                if (dup) {
                    // Name the holder, as intake does - a bare "already exists" is what drove
                    // staff to invent placeholder plates.
                    val owner = api.vehicleOwnerByPlate(plate)
                    val text = if (owner != null) "$plate is already on $owner's card."
                    else "$plate is already registered to another customer."
                    _s.update { it.copy(busy = false, error = text) }
                } else {
                    _s.update { it.copy(busy = false, error = e.uiMessage()) }
                }
            }
        }
    }

    /** Re-fetch and keep the open card pointed at the same customer. */
    private fun reload() {
        val openId = _s.value.open?.id
        viewModelScope.launch {
            runCatching { api.fetchContacts(_s.value.query) }.onSuccess { rows ->
                _s.update { st -> st.copy(contacts = rows, open = rows.firstOrNull { it.id == openId } ?: st.open) }
            }
        }
    }

    /**
     * Start a job straight from the contact card - a returning customer whose car and history
     * are already known should not have to be walked through reception again.
     *
     * [startedJobId] is the hand-off ContactsScreen watches to actually MOVE to the board —
     * Intake/Quote/Jobs all chain into each other this way; Contacts used to set the field and
     * stop, so the toast said "Job started" and the operator was still looking at the customer
     * card. openJobBus is the same request Quote's "View job" makes — the same tap on Jobs opens
     * this exact job instead of just landing on the tab.
     */
    fun startJob(v: ContactVehicleDto) {
        val cust = _s.value.open ?: return
        _s.update { it.copy(startingJob = true, error = null) }
        viewModelScope.launch {
            runCatching { api.createJob(cust.id, v.id, service = null) }
                .onSuccess { id ->
                    openJobBus.request(id)
                    _s.update { it.copy(startingJob = false, startedJobId = id, toast = "Job started for ${v.plate}") }
                }
                .onFailure { e -> _s.update { it.copy(startingJob = false, error = e.uiMessage()) } }
        }
    }

    fun consumeStartedJob() = _s.update { it.copy(startedJobId = null) }

    fun clearToast() = _s.update { it.copy(toast = null) }
}
