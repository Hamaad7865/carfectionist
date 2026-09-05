package mu.carfection.pos.feature.intake

import mu.carfection.pos.core.network.VehicleDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A customer arrives with three cars, and that is one visit.
 *
 * The state rules are pinned here rather than in an instrumented test because they are what
 * decides which JOB CARD a scratch ends up on. Marking the Hilux and having the note appear
 * on the Swift's card would be worse than not recording it at all: the shop would be holding
 * a damage report for a car that never had that damage.
 */
class MultiCarIntakeTest {

    private fun car(id: String, plate: String) = VehicleDto(id = id, plate = plate, make = "Toyota", model = "Hilux")

    private val hilux = car("v1", "2087 JL 25")
    private val almera = car("v2", "1234 AB 22")
    private val swift = car("v3", "9876 ZZ 19")

    private fun picked(vararg v: VehicleDto) = IntakeState(picked = v.toList(), activeId = v.firstOrNull()?.id)

    @Test
    fun `the open tab decides which car the panel is showing`() {
        val s = picked(hilux, almera, swift).copy(activeId = "v2")
        assertEquals(almera, s.vehicle)
    }

    @Test
    fun `with no tab named, the first ticked car is the one on screen`() {
        assertEquals(hilux, picked(hilux, almera).copy(activeId = null).vehicle)
    }

    @Test
    fun `each car keeps its own damage notes`() {
        val s = picked(hilux, almera, swift).copy(
            activeId = "v2",
            markersByCar = mapOf(
                "v1" to listOf(DamageMarker(0.1f, 0.1f, "S", DamageType.SCRATCH.color)),
                "v2" to listOf(
                    DamageMarker(0.2f, 0.2f, "D", DamageType.DENT.color),
                    DamageMarker(0.3f, 0.3f, "C", DamageType.CHIP.color),
                ),
            ),
        )
        // The panel shows the OPEN car's notes only — never the visit's whole pile.
        assertEquals(2, s.markers.size)
        assertEquals("D", s.markers.first().letter)
        // The footer counts the visit.
        assertEquals(3, s.markerTotal)
    }

    @Test
    fun `photos are filed against the car whose tab is open`() {
        val s = picked(hilux, almera).copy(
            activeId = "v1",
            photosByCar = mapOf("v1" to listOf("a.jpg"), "v2" to listOf("b.jpg", "c.jpg")),
        )
        assertEquals(listOf("a.jpg"), s.photoPaths)
        assertEquals(listOf("b.jpg", "c.jpg"), s.copy(activeId = "v2").photoPaths)
    }

    /**
     * A car nobody ticked has no condition on screen and nothing to hand over. Reading the
     * map by the open tab (rather than merging everything) is what guarantees that.
     */
    @Test
    fun `an untouched car shows no marks and no photos`() {
        val s = picked(hilux, almera).copy(activeId = "v2", markersByCar = mapOf("v1" to listOf(DamageMarker(0.1f, 0.1f, "S", DamageType.SCRATCH.color))))
        assertEquals(emptyList<DamageMarker>(), s.markers)
        assertEquals(emptyList<String>(), s.photoPaths)
    }

    @Test
    fun `nothing ticked is nothing to quote`() {
        val s = IntakeState()
        assertNull(s.vehicle)
        assertEquals(0, s.markerTotal)
    }
}
