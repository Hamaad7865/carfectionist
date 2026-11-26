package mu.carfection.pos.feature.appointments

import mu.carfection.pos.core.network.AppointmentDto
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

val APPOINTMENT_ZONE: ZoneId = ZoneId.of("Indian/Mauritius")

private val LIVE_STATUSES = setOf("scheduled", "confirmed", "arrived")
private const val FOLLOW_UP_DAYS = 3L

enum class AppointmentTab(val label: String) {
    UPCOMING("Upcoming"),
    FOLLOW_UP("Needs follow-up"),
    HISTORY("History"),
}

data class AppointmentMetrics(
    val today: Int,
    val needsFollowUp: Int,
    val thisWeek: Int,
    val overdue: Int,
)

fun AppointmentDto.instant(): Instant? =
    runCatching { OffsetDateTime.parse(scheduledAt).toInstant() }.getOrNull()

fun AppointmentDto.scheduledWhen(zone: ZoneId = APPOINTMENT_ZONE): ZonedDateTime? =
    instant()?.atZone(zone)

fun AppointmentDto.isLive(): Boolean = status in LIVE_STATUSES

fun AppointmentDto.canConvertToJob(): Boolean =
    jobId == null && status in LIVE_STATUSES

fun canBookFollowUpFromJob(status: String): Boolean =
    status == "ready" || status == "delivered"

fun AppointmentDto.isOverdue(now: Instant = Instant.now()): Boolean {
    val scheduled = instant() ?: return false
    return status in setOf("scheduled", "confirmed") && scheduled.isBefore(now)
}

fun AppointmentDto.needsFollowUp(now: Instant = Instant.now()): Boolean {
    val scheduled = instant() ?: return false
    return status in setOf("scheduled", "confirmed") &&
        !scheduled.isAfter(now.plus(Duration.ofDays(FOLLOW_UP_DAYS)))
}

fun appointmentMetrics(
    rows: List<AppointmentDto>,
    now: Instant = Instant.now(),
    zone: ZoneId = APPOINTMENT_ZONE,
): AppointmentMetrics {
    val today = now.atZone(zone).toLocalDate()
    val weekEnd = today.plusDays(6)
    val live = rows.filter(AppointmentDto::isLive)
    return AppointmentMetrics(
        today = live.count { it.scheduledWhen(zone)?.toLocalDate() == today },
        needsFollowUp = rows.count { it.needsFollowUp(now) },
        thisWeek = live.count {
            val date = it.scheduledWhen(zone)?.toLocalDate()
            date != null && !date.isBefore(today) && !date.isAfter(weekEnd)
        },
        overdue = rows.count { it.isOverdue(now) },
    )
}

fun filterAppointments(
    rows: List<AppointmentDto>,
    tab: AppointmentTab,
    query: String,
    now: Instant = Instant.now(),
): List<AppointmentDto> {
    val term = query.trim().lowercase()
    val matchedTab = rows.filter { row ->
        when (tab) {
            AppointmentTab.UPCOMING -> row.isLive()
            AppointmentTab.FOLLOW_UP -> row.needsFollowUp(now)
            AppointmentTab.HISTORY -> !row.isLive()
        }
    }.filter { row ->
        if (term.isEmpty()) return@filter true
        listOfNotNull(
            row.customers?.name,
            row.customers?.phone,
            row.vehicles?.plate,
            row.vehicles?.make,
            row.vehicles?.model,
            row.service,
            row.department,
            row.technician?.displayName,
        ).any { it.lowercase().contains(term) }
    }
    return if (tab == AppointmentTab.HISTORY) {
        matchedTab.sortedByDescending { it.instant() ?: Instant.MIN }
    } else {
        matchedTab.sortedBy { it.instant() ?: Instant.MAX }
    }
}

fun appointmentStatusLabel(status: String): String = when (status) {
    "scheduled" -> "Scheduled"
    "confirmed" -> "Confirmed"
    "arrived" -> "Arrived"
    "done" -> "Done"
    "cancelled" -> "Cancelled"
    "no_show" -> "No-show"
    else -> status.replace('_', ' ').replaceFirstChar(Char::uppercase)
}

fun parseKm(value: String): Int? =
    value.filter(Char::isDigit).take(7).toIntOrNull()

internal fun appointmentDraftError(draft: AppointmentDraft): String? {
    val aligned = parseKm(draft.alignedAtKm)
    val next = parseKm(draft.nextAtKm)
    return when {
        draft.customerName.isBlank() -> "Enter the client's name."
        draft.customerPhone.isBlank() -> "Enter a mobile number for follow-up."
        draft.regNo.isBlank() -> "Enter the vehicle registration."
        draft.make.isBlank() -> "Enter the vehicle make."
        aligned == null -> "Enter the aligned mileage."
        next == null -> "Enter the next mileage."
        next <= aligned -> "Next at must be greater than aligned at."
        draft.service.isBlank() -> "Choose the appointment service."
        draft.durationMinutes.toIntOrNull() == null -> "Enter the appointment duration."
        draft.durationMinutes.toInt() !in 1..1440 -> "Duration must be between 1 and 1440 minutes."
        else -> null
    }
}
