package mu.carfection.pos.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What reception hands the quote builder: the picked customer + vehicle, the condition
 * markers (as the `jobs.damage_markers` json the web also reads: {x, y, type} fractions),
 * and any intake photos already sitting in storage. Markers and photos are stamped onto
 * the job when the quote is ACCEPTED — there is no job before that.
 */
data class IntakeHandoff(
    val customerId: String,
    val customerName: String,
    val vehicleId: String,
    val plate: String?,
    val vehLabel: String,
    val markers: JsonArray,
    val markerCount: Int,
    val photoPaths: List<String>,
)

/** Latched (not an event): the quote builder may not exist yet when intake publishes. */
@Singleton
class IntakeHandoffBus @Inject constructor() {
    private val _pending = MutableStateFlow<IntakeHandoff?>(null)
    val pending = _pending.asStateFlow()
    fun publish(h: IntakeHandoff) { _pending.value = h }
    fun consume() { _pending.value = null }
}
