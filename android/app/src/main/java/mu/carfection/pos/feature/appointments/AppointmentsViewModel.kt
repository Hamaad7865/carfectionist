package mu.carfection.pos.feature.appointments

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.AppointmentFromJobBus
import mu.carfection.pos.core.data.OpenJobBus
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.network.AppointmentDto
import mu.carfection.pos.core.network.AppointmentUpdateDto
import mu.carfection.pos.core.network.CustomerDto
import mu.carfection.pos.core.network.NewAppointmentDto
import mu.carfection.pos.core.network.NewCustomerDto
import mu.carfection.pos.core.network.NewVehicleDto
import mu.carfection.pos.core.network.PosApi
import mu.carfection.pos.core.network.VehicleDto
import mu.carfection.pos.core.network.uiMessage
import mu.carfection.pos.core.network.appointmentDisplayNotes
import java.time.LocalDate
import java.time.LocalTime
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import javax.inject.Inject

data class AppointmentDraft(
    val editingId: String? = null,
    val customerId: String? = null,
    val customerName: String = "",
    val customerPhone: String = "",
    val customerMatches: List<CustomerDto> = emptyList(),
    val searchingCustomers: Boolean = false,
    val vehicleId: String? = null,
    val vehicleOptions: List<VehicleDto> = emptyList(),
    val loadingVehicles: Boolean = false,
    val regNo: String = "",
    val make: String = "",
    val model: String = "",
    val colour: String = "",
    val alignedAtKm: String = "",
    val alignedOn: LocalDate = LocalDate.now(APPOINTMENT_ZONE),
    val nextAtKm: String = "",
    val scheduledDate: LocalDate = LocalDate.now(APPOINTMENT_ZONE).plusDays(1),
    val scheduledTime: LocalTime = LocalTime.of(8, 30),
    val service: String = "Wheel alignment",
    val durationMinutes: String = "45",
    val notes: String = "",
)

data class AppointmentsState(
    val loading: Boolean = true,
    val appointments: List<AppointmentDto> = emptyList(),
    val tab: AppointmentTab = AppointmentTab.UPCOMING,
    val query: String = "",
    val editor: AppointmentDraft? = null,
    val detailId: String? = null,
    val saving: Boolean = false,
    val busyId: String? = null,
    val error: String? = null,
    val toast: String? = null,
    val goToJobs: Boolean = false,
)

@HiltViewModel
class AppointmentsViewModel @Inject constructor(
    private val api: PosApi,
    private val catalog: CatalogRepository,
    private val session: SessionRepository,
    private val appointmentFromJobBus: AppointmentFromJobBus,
    private val openJobBus: OpenJobBus,
) : ViewModel() {
    private val _state = MutableStateFlow(AppointmentsState())
    val state = _state.asStateFlow()

    private var loadGeneration = 0
    private var customerSearch: Job? = null

    init {
        viewModelScope.launch {
            appointmentFromJobBus.pending.collect { job ->
                if (job != null) {
                    appointmentFromJobBus.consume()
                    openFromFinishedJob(job)
                }
            }
        }
    }

    /** Refresh-on-entry: another tablet or the web can create a booking at any time. */
    fun onShown() = load(quiet = _state.value.appointments.isNotEmpty())

    fun load(quiet: Boolean = false) {
        val generation = ++loadGeneration
        if (!quiet) _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val blocked = session.readsUnavailableReason()
            if (generation != loadGeneration) return@launch
            if (blocked != null) {
                _state.update { it.copy(loading = false, error = blocked) }
                return@launch
            }
            runCatching { api.fetchAppointments() }
                .onSuccess { rows ->
                    if (generation != loadGeneration) return@onSuccess
                    _state.update {
                        it.copy(
                            loading = false,
                            error = null,
                            appointments = rows,
                            detailId = it.detailId?.takeIf { id -> rows.any { row -> row.id == id } },
                        )
                    }
                }
                .onFailure { e ->
                    if (generation == loadGeneration) {
                        _state.update { it.copy(loading = false, error = e.uiMessage()) }
                    }
                }
        }
    }

    fun setTab(tab: AppointmentTab) = _state.update { it.copy(tab = tab) }
    fun setQuery(query: String) = _state.update { it.copy(query = query) }

    fun openNew() {
        customerSearch?.cancel()
        _state.update { it.copy(editor = AppointmentDraft(), detailId = null, error = null) }
    }

    private fun openFromFinishedJob(job: mu.carfection.pos.core.network.JobBoardDto) {
        val customerId = job.customerId ?: return
        val vehicleId = job.vehicleId ?: return
        val customer = CustomerDto(
            id = customerId,
            name = job.customers?.name.orEmpty(),
            phone = job.customers?.phone,
        )
        val vehicle = VehicleDto(
            id = vehicleId,
            plate = job.vehicles?.plate.orEmpty(),
            make = job.vehicles?.make,
            model = job.vehicles?.model,
            colour = job.vehicles?.colour,
        )
        val finishedAt = job.deliveredAt ?: job.readyAt
        val alignedOn = finishedAt?.let(::parseLocalDate)
            ?: LocalDate.now(APPOINTMENT_ZONE)
        _state.update {
            it.copy(
                editor = AppointmentDraft(
                    customerId = customerId,
                    customerName = customer.name,
                    customerPhone = customer.phone.orEmpty(),
                    customerMatches = listOf(customer),
                    vehicleId = vehicleId,
                    vehicleOptions = listOf(vehicle),
                    regNo = vehicle.plate,
                    make = vehicle.make.orEmpty(),
                    model = vehicle.model.orEmpty(),
                    colour = vehicle.colour.orEmpty(),
                    alignedOn = alignedOn,
                    service = job.notes.orEmpty().ifBlank { "Wheel alignment" },
                    durationMinutes = job.estimatedMinutes?.toString() ?: "45",
                    notes = "Follow-up from JOB-${job.id.take(8).uppercase(Locale.ROOT)}",
                ),
                detailId = null,
                error = null,
            )
        }
    }

    fun edit(id: String) {
        val row = _state.value.appointments.firstOrNull { it.id == id } ?: return
        customerSearch?.cancel()
        val scheduledDateTime = row.scheduledWhen()?.toLocalDateTime()
        val customer = row.customers
        val vehicle = row.vehicles
        val selectedCustomer = CustomerDto(
            id = row.customerId,
            name = customer?.name.orEmpty(),
            phone = customer?.phone,
        )
        val selectedVehicle = VehicleDto(
            id = row.vehicleId,
            plate = vehicle?.plate.orEmpty(),
            make = vehicle?.make,
            model = vehicle?.model,
            colour = vehicle?.colour,
        )
        _state.update {
            it.copy(
                editor = AppointmentDraft(
                    editingId = row.id,
                    customerId = row.customerId,
                    customerName = customer?.name.orEmpty(),
                    customerPhone = customer?.phone.orEmpty(),
                    customerMatches = listOf(selectedCustomer),
                    vehicleId = row.vehicleId,
                    vehicleOptions = listOf(selectedVehicle),
                    regNo = vehicle?.plate.orEmpty(),
                    make = vehicle?.make.orEmpty(),
                    model = vehicle?.model.orEmpty(),
                    colour = vehicle?.colour.orEmpty(),
                    alignedAtKm = row.alignedAtKm?.let(::thousands) ?: "",
                    alignedOn = row.alignedOn?.let { raw -> runCatching { LocalDate.parse(raw) }.getOrNull() }
                        ?: LocalDate.now(APPOINTMENT_ZONE),
                    nextAtKm = row.nextAtKm?.let(::thousands) ?: "",
                    scheduledDate = scheduledDateTime?.toLocalDate() ?: LocalDate.now(APPOINTMENT_ZONE).plusDays(1),
                    scheduledTime = scheduledDateTime?.toLocalTime() ?: LocalTime.of(8, 30),
                    service = row.service.orEmpty().ifBlank { "Wheel alignment" },
                    durationMinutes = row.durationMinutes?.toString() ?: "45",
                    notes = appointmentDisplayNotes(row.notes),
                ),
                detailId = null,
                error = null,
            )
        }
    }

    fun closeEditor() {
        customerSearch?.cancel()
        _state.update { it.copy(editor = null, saving = false, error = null) }
    }

    fun openDetail(id: String) = _state.update { it.copy(detailId = id, editor = null) }
    fun closeDetail() = _state.update { it.copy(detailId = null) }

    fun setCustomerName(name: String) {
        _state.update {
            it.copy(
                editor = it.editor?.copy(
                    customerId = null,
                    customerName = name,
                    customerMatches = emptyList(),
                    searchingCustomers = name.trim().length >= 2,
                    vehicleId = null,
                    vehicleOptions = emptyList(),
                    regNo = "",
                    make = "",
                    model = "",
                    colour = "",
                ),
            )
        }
        searchCustomer(name)
    }

    fun chooseCustomer(customer: CustomerDto) {
        customerSearch?.cancel()
        val generationDraft = customer
        _state.update {
            it.copy(
                editor = it.editor?.copy(
                    customerId = customer.id,
                    customerName = customer.name,
                    customerPhone = customer.phone.orEmpty(),
                    customerMatches = emptyList(),
                    searchingCustomers = false,
                    vehicleId = null,
                    vehicleOptions = emptyList(),
                    loadingVehicles = true,
                    regNo = "",
                    make = "",
                    model = "",
                    colour = "",
                ),
            )
        }
        viewModelScope.launch {
            runCatching { api.fetchVehicles(customer.id) }
                .onSuccess { vehicles ->
                    _state.update {
                        if (it.editor?.customerId != generationDraft.id) return@update it
                        val selected = vehicles.singleOrNull()
                        it.copy(
                            editor = it.editor.copy(
                                vehicleOptions = vehicles,
                                vehicleId = selected?.id,
                                regNo = selected?.plate.orEmpty(),
                                make = selected?.make.orEmpty(),
                                model = selected?.model.orEmpty(),
                                colour = selected?.colour.orEmpty(),
                                loadingVehicles = false,
                            ),
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        if (it.editor?.customerId != generationDraft.id) return@update it
                        it.copy(
                            editor = it.editor?.copy(loadingVehicles = false),
                            error = e.uiMessage(),
                        )
                    }
                }
        }
    }

    fun chooseVehicle(vehicle: VehicleDto) {
        updateEditor {
            copy(
                vehicleId = vehicle.id,
                regNo = vehicle.plate,
                make = vehicle.make.orEmpty(),
                model = vehicle.model.orEmpty(),
                colour = vehicle.colour.orEmpty(),
            )
        }
    }

    fun setPhone(value: String) = updateEditor { copy(customerPhone = value) }
    fun setRegNo(value: String) = updateEditor { copy(regNo = value.uppercase(Locale.ROOT).take(24), vehicleId = null) }
    fun setMake(value: String) = updateEditor { copy(make = value.take(48)) }
    fun setModel(value: String) = updateEditor { copy(model = value.take(48)) }
    fun setColour(value: String) = updateEditor { copy(colour = value.take(32)) }
    fun setAlignedKm(value: String) = updateEditor { copy(alignedAtKm = digitsOnly(value, 7)) }
    fun setNextKm(value: String) = updateEditor { copy(nextAtKm = digitsOnly(value, 7)) }
    fun setAlignedOn(value: LocalDate) = updateEditor { copy(alignedOn = value) }
    fun setScheduledDate(value: LocalDate) = updateEditor { copy(scheduledDate = value) }
    fun setScheduledTime(value: LocalTime) = updateEditor { copy(scheduledTime = value) }
    fun setService(value: String) = updateEditor { copy(service = value.take(100)) }
    fun setDuration(value: String) = updateEditor { copy(durationMinutes = digitsOnly(value, 4)) }
    fun setNotes(value: String) = updateEditor { copy(notes = value.take(500)) }

    fun save() {
        val draft = _state.value.editor ?: return
        appointmentDraftError(draft)?.let { message ->
            _state.update { it.copy(error = message) }
            return
        }
        if (_state.value.saving) return
        _state.update { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            val blocked = session.readsUnavailableReason()
            if (blocked != null) {
                _state.update { it.copy(saving = false, error = blocked) }
                return@launch
            }
            runCatching { saveDraft(draft) }
                .onSuccess { saved ->
                    _state.update {
                        val rows = if (draft.editingId == null) {
                            (it.appointments + saved).distinctBy(AppointmentDto::id)
                        } else {
                            it.appointments.map { row -> if (row.id == saved.id) saved else row }
                        }
                        it.copy(
                            appointments = rows,
                            editor = null,
                            detailId = null,
                            saving = false,
                            error = null,
                            toast = if (draft.editingId == null) "Appointment booked" else "Appointment updated",
                        )
                    }
                }
                .onFailure { e ->
                    _state.update { it.copy(saving = false, error = e.uiMessage()) }
                }
        }
    }

    fun setStatus(id: String, status: String) {
        if (_state.value.busyId != null) return
        _state.update { it.copy(busyId = id, error = null) }
        viewModelScope.launch {
            runCatching { api.setAppointmentStatus(id, status) }
                .onSuccess {
                    _state.update {
                        it.copy(
                            appointments = it.appointments.map { row ->
                                if (row.id == id) row.copy(status = status) else row
                            },
                            busyId = null,
                            error = null,
                            toast = "Appointment marked ${appointmentStatusLabel(status).lowercase()}",
                        )
                    }
                }
                .onFailure { e ->
                    _state.update { it.copy(busyId = null, error = e.uiMessage()) }
                }
        }
    }

    fun convertToJob(id: String, startNow: Boolean) {
        if (_state.value.busyId != null) return
        val row = _state.value.appointments.firstOrNull { it.id == id } ?: return
        if (!row.canConvertToJob()) {
            _state.update { it.copy(error = "This appointment is not available to become a job") }
            return
        }
        _state.update { it.copy(busyId = id, error = null) }
        viewModelScope.launch {
            runCatching { api.convertAppointmentToJob(id, startNow) }
                .onSuccess { jobId ->
                    _state.update {
                        it.copy(
                            appointments = it.appointments.map { row ->
                                if (row.id == id) {
                                    row.copy(jobId = jobId, status = if (startNow) "arrived" else row.status)
                                } else row
                            },
                            busyId = null,
                            detailId = null,
                            error = null,
                            toast = if (startNow) "Job started now" else "Job scheduled",
                            goToJobs = true,
                        )
                    }
                    openJobBus.request(jobId)
                }
                .onFailure { e ->
                    _state.update { it.copy(busyId = null, error = e.uiMessage()) }
                }
        }
    }

    fun openJob(jobId: String) {
        openJobBus.request(jobId)
        _state.update { it.copy(goToJobs = true, detailId = null) }
    }

    fun consumeGoToJobs() = _state.update { it.copy(goToJobs = false) }

    fun clearToast() = _state.update { it.copy(toast = null) }

    private suspend fun saveDraft(draft: AppointmentDraft): AppointmentDto {
        val tenantId = requireNotNull(catalog.tenantId()) { "Not synced yet — pull the catalogue first." }
        val plate = draft.regNo.trim().uppercase(Locale.ROOT)
        val holder = api.plateHolder(plate)
        val existingCustomerId = draft.customerId

        if (holder != null && existingCustomerId != null && holder.customer.id != existingCustomerId) {
            error("$plate already belongs to ${holder.customer.name}.")
        }

        val customer = holder?.customer
            ?: existingCustomerId?.let { CustomerDto(it, draft.customerName.trim(), draft.customerPhone.trim().ifBlank { null }) }
            ?: api.findExistingCustomer(draft.customerName, draft.customerPhone)
            ?: api.insertCustomer(
                NewCustomerDto(
                    tenantId = tenantId,
                    name = draft.customerName.trim(),
                    phone = draft.customerPhone.trim().ifBlank { null },
                ),
            )

        var vehicle = holder?.vehicle
            ?: draft.vehicleId?.takeIf { id ->
                draft.vehicleOptions.any { it.id == id && normalizePlate(it.plate) == normalizePlate(plate) }
            }?.let { id ->
                draft.vehicleOptions.first { it.id == id }
            }
            ?: api.insertVehicle(
                NewVehicleDto(
                    tenantId = tenantId,
                    customerId = customer.id,
                    plate = plate,
                    make = draft.make.trim().ifBlank { null },
                    model = draft.model.trim().ifBlank { null },
                    colour = draft.colour.trim().ifBlank { null },
                ),
            )
        val desiredMake = draft.make.trim().ifBlank { null }
        val desiredModel = draft.model.trim().ifBlank { null }
        val desiredColour = draft.colour.trim().ifBlank { null }
        if (
            vehicle.make != desiredMake ||
            vehicle.model != desiredModel ||
            vehicle.colour != desiredColour
        ) {
            api.updateVehicleDetails(vehicle.id, desiredMake, desiredModel, desiredColour)
            vehicle = vehicle.copy(make = desiredMake, model = desiredModel, colour = desiredColour)
        }

        val scheduledAt = draft.scheduledDate
            .atTime(draft.scheduledTime)
            .atZone(APPOINTMENT_ZONE)
            .toInstant()
            .toString()
        val payload = AppointmentUpdateDto(
            customerId = customer.id,
            vehicleId = vehicle.id,
            service = draft.service.trim().ifBlank { null },
            scheduledAt = scheduledAt,
            durationMinutes = draft.durationMinutes.toIntOrNull(),
            notes = draft.notes.trim().ifBlank { null },
            alignedOn = draft.alignedOn.toString(),
            alignedAtKm = parseKm(draft.alignedAtKm),
            nextAtKm = parseKm(draft.nextAtKm),
        )

        return if (draft.editingId != null) {
            api.updateAppointment(draft.editingId, payload)
            _state.value.appointments.first { it.id == draft.editingId }.copy(
                customerId = customer.id,
                vehicleId = vehicle.id,
                service = payload.service,
                scheduledAt = scheduledAt,
                durationMinutes = payload.durationMinutes,
                notes = payload.notes,
                alignedOn = payload.alignedOn,
                alignedAtKm = payload.alignedAtKm,
                nextAtKm = payload.nextAtKm,
                customers = mu.carfection.pos.core.network.JobCustomerDto(
                    name = customer.name,
                    phone = customer.phone,
                ),
                vehicles = mu.carfection.pos.core.network.JobVehicleDto(
                    plate = vehicle.plate,
                    make = vehicle.make,
                    model = vehicle.model,
                    colour = vehicle.colour,
                ),
            )
        } else {
            api.insertAppointment(
                NewAppointmentDto(
                    tenantId = tenantId,
                    customerId = customer.id,
                    vehicleId = vehicle.id,
                    service = payload.service,
                    scheduledAt = scheduledAt,
                    durationMinutes = payload.durationMinutes,
                    notes = payload.notes,
                    alignedOn = payload.alignedOn,
                    alignedAtKm = payload.alignedAtKm,
                    nextAtKm = payload.nextAtKm,
                    createdBy = session.operatorId,
                ),
            )
        }
    }

    private fun searchCustomer(query: String) {
        customerSearch?.cancel()
        val term = query.trim()
        if (term.length < 2) {
            updateEditor { copy(searchingCustomers = false, customerMatches = emptyList()) }
            return
        }
        customerSearch = viewModelScope.launch {
            delay(250)
            runCatching {
                coroutineScope {
                    val byName = async { api.searchCustomers(term) }
                    val byPlate = async { api.searchCustomersByPlate(term) }
                    (byName.await() + byPlate.await()).distinctBy(CustomerDto::id)
                }
            }
                .onSuccess { rows ->
                    _state.update {
                        if (it.editor?.customerName?.trim() != term) return@update it
                        it.copy(
                            editor = it.editor.copy(
                                searchingCustomers = false,
                                customerMatches = rows,
                            ),
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        if (it.editor?.customerName?.trim() != term) return@update it
                        it.copy(
                            editor = it.editor?.copy(searchingCustomers = false),
                            error = e.uiMessage(),
                        )
                    }
                }
        }
    }

    private fun updateEditor(block: AppointmentDraft.() -> AppointmentDraft) {
        _state.update { it.copy(editor = it.editor?.block()) }
    }

    private companion object {
        fun digitsOnly(value: String, max: Int): String = value.filter(Char::isDigit).take(max)
        fun normalizePlate(value: String): String = value.filter(Char::isLetterOrDigit).uppercase(Locale.ROOT)
        fun thousands(value: Int): String =
            String.format(Locale.US, "%,d", value)
        fun parseLocalDate(value: String): LocalDate? =
            runCatching { Instant.parse(value).atZone(APPOINTMENT_ZONE).toLocalDate() }
                .getOrNull()
                ?: runCatching { OffsetDateTime.parse(value).atZoneSameInstant(APPOINTMENT_ZONE).toLocalDate() }
                    .getOrNull()
    }
}
