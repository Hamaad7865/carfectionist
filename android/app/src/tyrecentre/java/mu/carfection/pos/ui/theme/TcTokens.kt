package mu.carfection.pos.ui.theme

import androidx.compose.ui.graphics.Color

// Tokens only the tyre centre has (DESIGN-SPEC §2), for its own Till and Paid screens.
val TcHighlight = Color(0xFFDDF57A)     // lime: ready to pay, count badges, arrow knob
val TcOnHighlight = Color(0xFF3F4A00)
val TcTrack = Color(0xFFE2E8EF)
val TcFainter = Color(0xFF9AA3AD)
val TcBody = Color(0xFF2A3747)
val TcDangerSoft = Color(0xFFFDECEE)
val TcDangerInk = Color(0xFFB42339)

/** One issuing company's colour set, chosen by its position in the company order. */
data class EntityColours(
    val accent: Color,
    val soft: Color,
    val tint: Color,
    val border: Color,
    val dash: Color,
    val ink: Color,
    val icon: Color,
)

private val ENTITY_COLOURS = listOf(
    EntityColours(Color(0xFFF5A623), Color(0xFFFFF2DB), Color(0xFFFFFBF2), Color(0xFFF7E2B8), Color(0xFFEBD3A2), Color(0xFF9A6200), Color(0xFFC98200)),
    EntityColours(Color(0xFF2B8CFF), Color(0xFFE6F1FF), Color(0xFFF5F9FF), Color(0xFFCFE2FF), Color(0xFFBFD8FA), Color(0xFF1E6FE0), Color(0xFF1E6FE0)),
    EntityColours(Color(0xFF0DA77C), Color(0xFFDDF5EC), Color(0xFFF3FBF8), Color(0xFFBDE8D8), Color(0xFFA5DCC8), Color(0xFF07745A), Color(0xFF0A8C6A)),
    EntityColours(Color(0xFF8B5CF6), Color(0xFFEFE8FE), Color(0xFFF8F5FF), Color(0xFFDCCFFC), Color(0xFFCBB8FA), Color(0xFF6236D9), Color(0xFF7346E8)),
)

/** The colours for the company at [index] in the shop's company order (0 = first). */
fun entityColours(index: Int): EntityColours = ENTITY_COLOURS[index.coerceAtLeast(0) % ENTITY_COLOURS.size]
