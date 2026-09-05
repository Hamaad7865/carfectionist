package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import javax.inject.Inject
import javax.inject.Singleton

/**
 * One car reception took in: which car, and the condition it arrived in — the markers
 * as the `jobs.damage_markers` json the web also reads ({x, y, type} percentages), and
 * any photos already sitting in storage.
 */
data class HandoffCar(
    val vehicleId: String,
    val plate: String?,
    val label: String,
    val markers: JsonArray,
    val markerCount: Int,
    val photoPaths: List<String>,
)

/**
 * What reception hands the quote builder: the picked customer and EVERY car they brought
 * in on this visit. Markers and photos are stamped onto each car's job when the quote is
 * ACCEPTED — there is no job before that.
 *
 * A visit is one or many cars. Yogen arriving with three is one hand-over, one quotation
 * and one bill; it was never three separate trips through reception.
 */
data class IntakeHandoff(
    val customerId: String,
    val customerName: String,
    // Carried so the quote's send dialog can prefill WhatsApp/email. Without these a quote
    // started at intake opened with an empty number and staff had to type it from the card.
    val customerPhone: String? = null,
    val customerEmail: String? = null,
    val cars: List<HandoffCar>,
) {
    /** The first car — what a single-car quote builds on, exactly as it always did. */
    val vehicleId: String get() = cars.first().vehicleId
    val plate: String? get() = cars.first().plate
    val vehLabel: String get() = cars.first().label
    val markerCount: Int get() = cars.sumOf { it.markerCount }
    /** Every car's markers in one array — for the one-car case this IS that car's array. */
    val markers: JsonArray get() =
        if (cars.size == 1) cars.first().markers
        else buildJsonArray { cars.forEach { c -> c.markers.forEach { add(it) } } }
    val photoPaths: List<String> get() = cars.flatMap { it.photoPaths }
}

/** Latched (not an event): the quote builder may not exist yet when intake publishes. */
@Singleton
class IntakeHandoffBus @Inject constructor() {
    private val _pending = MutableStateFlow<IntakeHandoff?>(null)
    val pending = _pending.asStateFlow()
    fun publish(h: IntakeHandoff) { _pending.value = h }
    fun consume() { _pending.value = null }
}
