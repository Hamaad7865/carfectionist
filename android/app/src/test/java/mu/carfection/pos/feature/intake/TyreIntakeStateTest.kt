package mu.carfection.pos.feature.intake

import mu.carfection.pos.core.database.CustomerEntity
import mu.carfection.pos.core.network.VehicleDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TyreIntakeStateTest {
    private val customer = CustomerEntity(id = "c1", name = "A. Soobramanien", phone = "57283140")
    private val vehicle = VehicleDto(id = "v1", plate = "RM 8421", make = "Toyota", model = "Yaris")

    @Test
    fun `tyre replacement requires a size before the quote can start`() {
        val state = IntakeState(
            customer = customer,
            vehicles = listOf(vehicle),
            picked = listOf(vehicle),
            tyreServices = setOf(TyreIntakeService.REPLACEMENT),
        )

        assertFalse(state.canStartTyreIntake)
        assertFalse(state.hasTyreRequest)
        assertTrue(state.copy(tyreSize = "185/65 R14").canStartTyreIntake)
    }

    @Test
    fun `non-tyre work does not require a tyre size`() {
        val state = IntakeState(
            customer = customer,
            vehicles = listOf(vehicle),
            picked = listOf(vehicle),
            tyreServices = setOf(TyreIntakeService.PUNCTURE),
        )

        assertTrue(state.canStartTyreIntake)
    }

    @Test
    fun `customer vehicle and requested work are all mandatory`() {
        val readyExceptCustomer = IntakeState(
            vehicles = listOf(vehicle),
            picked = listOf(vehicle),
            tyreServices = setOf(TyreIntakeService.BALANCING),
        )
        val readyExceptVehicle = IntakeState(
            customer = customer,
            tyreServices = setOf(TyreIntakeService.BALANCING),
        )
        val readyExceptWork = IntakeState(
            customer = customer,
            vehicles = listOf(vehicle),
            picked = listOf(vehicle),
        )

        assertFalse(readyExceptCustomer.canStartTyreIntake)
        assertFalse(readyExceptVehicle.canStartTyreIntake)
        assertFalse(readyExceptWork.canStartTyreIntake)
    }

    @Test
    fun `front and rear positions imply two tyres while all wheels implies four`() {
        assertEquals(2, WheelPosition.FRONT.defaultTyreQuantity)
        assertEquals(2, WheelPosition.REAR.defaultTyreQuantity)
        assertEquals(4, WheelPosition.ALL.defaultTyreQuantity)
    }
}
