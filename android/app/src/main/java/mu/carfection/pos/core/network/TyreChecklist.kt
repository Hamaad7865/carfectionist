package mu.carfection.pos.core.network

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A tyre centre's job card checklist. Mirrors TYRE_CHECKLIST in
 * apps/web/src/features/jobs/checklist.ts — change both together.
 */
internal val TYRE_CHECKLIST_LABELS = listOf(
    "Tyres & wheels checked",
    "Fitting / repair work",
    "Wheel nuts torqued & pressures set",
    "Final check & test",
)

/** The detailing default the quote→job RPCs seed on every new job. */
internal val DETAILING_CHECKLIST_LABELS = listOf(
    "Intake photos & damage check",
    "Wash & prep",
    "Service work",
    "Final inspection",
)

internal fun tyreChecklistJson(): JsonArray =
    JsonArray(TYRE_CHECKLIST_LABELS.map { buildJsonObject { put("label", it); put("done", false) } })

/**
 * Swap only an untouched checklist: empty, or the detailing default with nothing ticked.
 * The RPCs are idempotent (a re-tap returns the same job), so this must never wipe work.
 */
internal fun shouldSwapForTyre(checklist: List<ChecklistItemDto>): Boolean =
    checklist.isEmpty() || (checklist.map { it.label } == DETAILING_CHECKLIST_LABELS && checklist.none { it.done })
