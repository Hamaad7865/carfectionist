package mu.carfection.pos.feature.appointments

import mu.carfection.pos.core.network.AppointmentDto
import mu.carfection.pos.core.network.JobCustomerDto
import mu.carfection.pos.core.network.JobVehicleDto
import mu.carfection.pos.core.network.appointmentDisplayNotes
import mu.carfection.pos.core.network.isMissingAppointmentAlignmentColumns
import mu.carfection.pos.core.network.legacyAlignmentNotes
import mu.carfection.pos.core.network.withLegacyAlignment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class AppointmentsModelTest {
    private val now = Instant.parse("2026-11-26T06:00:00Z")

    @Test
    fun `metrics separate today follow-up week and overdue bookings`() {
        val rows = listOf(
            row("1", "2026-11-26T06:30:00Z", "scheduled"),
            row("2", "2026-11-25T08:00:00Z", "confirmed"),
            row("3", "2026-11-28T09:00:00Z", "scheduled"),
            row("4", "2026-12-10T09:00:00Z", "scheduled"),
            row("5", "2026-11-24T09:00:00Z", "cancelled"),
        )

        val metrics = appointmentMetrics(rows, now)

        assertEquals(1, metrics.today)
        assertEquals(3, metrics.needsFollowUp)
        assertEquals(2, metrics.thisWeek)
        assertEquals(1, metrics.overdue)
    }

    @Test
    fun `follow-up filter includes overdue and due soon but not later or history`() {
        val rows = listOf(
            row("overdue", "2026-11-25T08:00:00Z", "scheduled"),
            row("soon", "2026-11-28T08:00:00Z", "confirmed"),
            row("later", "2026-12-10T08:00:00Z", "scheduled"),
            row("done", "2026-11-25T08:00:00Z", "done"),
        )

        assertEquals(
            listOf("overdue", "soon"),
            filterAppointments(rows, AppointmentTab.FOLLOW_UP, "", now).map(AppointmentDto::id),
        )
    }

    @Test
    fun `only finished jobs may book a follow-up and only live unlinked appointments convert`() {
        assertTrue(canBookFollowUpFromJob("ready"))
        assertTrue(canBookFollowUpFromJob("delivered"))
        assertFalse(canBookFollowUpFromJob("in_progress"))

        val scheduled = row("scheduled", "2026-11-30T04:30:00Z", "scheduled")
        assertTrue(scheduled.canConvertToJob())
        assertFalse(scheduled.copy(jobId = "job-1").canConvertToJob())
        assertFalse(scheduled.copy(status = "cancelled").canConvertToJob())
    }

    @Test
    fun `search matches customer registration and make case insensitively`() {
        val toyota = row("toyota", "2026-11-26T08:00:00Z", "scheduled").copy(
            customers = JobCustomerDto(name = "Anil Ram"),
            vehicles = JobVehicleDto(plate = "RM 8421", make = "Toyota", model = "Vitz"),
        )
        val nissan = row("nissan", "2026-11-26T09:00:00Z", "scheduled").copy(
            customers = JobCustomerDto(name = "Sanjay M"),
            vehicles = JobVehicleDto(plate = "1234 AG", make = "Nissan", model = "Qashqai"),
        )

        assertEquals(
            listOf("toyota"),
            filterAppointments(listOf(toyota, nissan), AppointmentTab.UPCOMING, "rM 8421", now).map(AppointmentDto::id),
        )
        assertEquals(
            listOf("nissan"),
            filterAppointments(listOf(toyota, nissan), AppointmentTab.UPCOMING, "NISSAN", now).map(AppointmentDto::id),
        )
    }

    @Test
    fun `appointment draft requires increasing next mileage`() {
        val valid = AppointmentDraft(
            customerName = "A. Souparmanien",
            customerPhone = "5920 1840",
            regNo = "RM 8421",
            make = "Toyota",
            alignedAtKm = "84,500",
            nextAtKm = "89,500",
        )

        assertNull(appointmentDraftError(valid))
        assertEquals(
            "Next at must be greater than aligned at.",
            appointmentDraftError(valid.copy(nextAtKm = "84,500")),
        )
        assertTrue(parseKm("89,500") == 89_500)
        assertFalse(parseKm("  km ") != null)
    }

    @Test
    fun `legacy note marker preserves alignment values without showing metadata`() {
        val notes = legacyAlignmentNotes(
            notes = "Vehicle pulls left",
            alignedOn = "2026-06-24",
            alignedAtKm = 84_500,
            nextAtKm = 89_500,
        )
        val restored = row("legacy", "2026-11-30T04:30:00Z", "scheduled")
            .copy(notes = notes)
            .withLegacyAlignment()

        assertEquals("2026-06-24", restored.alignedOn)
        assertEquals(84_500, restored.alignedAtKm)
        assertEquals(89_500, restored.nextAtKm)
        assertEquals("Vehicle pulls left", appointmentDisplayNotes(restored.notes))
    }

    @Test
    fun `known missing column errors use compatibility storage`() {
        assertTrue(
            IllegalStateException("column appointments.aligned_on does not exist")
                .isMissingAppointmentAlignmentColumns(),
        )
        assertFalse(
            IllegalStateException("next_at_km must be greater than aligned_at_km")
                .isMissingAppointmentAlignmentColumns(),
        )
    }

    private fun row(id: String, whenAt: String, status: String) = AppointmentDto(
        id = id,
        customerId = "customer-$id",
        vehicleId = "vehicle-$id",
        scheduledAt = whenAt,
        status = status,
    )
}
