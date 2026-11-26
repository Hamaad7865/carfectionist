package mu.carfection.pos.core.network

private val LEGACY_ALIGNMENT =
    Regex("""^\[tc-alignment:v1\|(\d{4}-\d{2}-\d{2})\|(\d+)\|(\d+)]$""", RegexOption.MULTILINE)

/**
 * Transitional storage for tablets running before the alignment-column migration.
 * The marker is namespaced, human-readable in the web, and removed from the Android UI.
 */
internal fun legacyAlignmentNotes(
    notes: String?,
    alignedOn: String?,
    alignedAtKm: Int?,
    nextAtKm: Int?,
): String? {
    val clean = appointmentDisplayNotes(notes)
    val marker = if (alignedOn != null && alignedAtKm != null && nextAtKm != null) {
        "[tc-alignment:v1|$alignedOn|$alignedAtKm|$nextAtKm]"
    } else {
        null
    }
    return listOfNotNull(clean, marker).joinToString("\n").ifBlank { null }
}

internal fun appointmentDisplayNotes(notes: String?): String =
    notes.orEmpty().replace(LEGACY_ALIGNMENT, "").trim()

internal fun AppointmentDto.withLegacyAlignment(): AppointmentDto {
    if (alignedOn != null && alignedAtKm != null && nextAtKm != null) return this
    val match = LEGACY_ALIGNMENT.find(notes.orEmpty()) ?: return this
    return copy(
        alignedOn = alignedOn ?: match.groupValues[1],
        alignedAtKm = alignedAtKm ?: match.groupValues[2].toIntOrNull(),
        nextAtKm = nextAtKm ?: match.groupValues[3].toIntOrNull(),
    )
}

internal fun Throwable.isMissingAppointmentAlignmentColumns(): Boolean {
    var current: Throwable? = this
    repeat(6) {
        val message = current?.message.orEmpty()
        if (
            (
                message.contains("schema cache", ignoreCase = true) ||
                    message.contains("does not exist", ignoreCase = true) ||
                    message.contains("could not find", ignoreCase = true)
                ) &&
            listOf("aligned_on", "aligned_at_km", "next_at_km").any {
                message.contains(it, ignoreCase = true)
            }
        ) return true
        current = current?.cause
    }
    return false
}
