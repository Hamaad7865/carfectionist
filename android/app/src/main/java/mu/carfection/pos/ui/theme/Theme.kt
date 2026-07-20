package mu.carfection.pos.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import mu.carfection.pos.R

// ─── Design tokens — LIGHT theme; layout per the Detailing POS handoff ────────
// Accent re-brand 2026-07-09 (user request): the POS must match the WEB app's
// brand palette (apps/web globals.css) — blue #2B8CFF family, not handoff teal.
val Accent = Color(0xFF2B8CFF)          // --color-brand (same as the web app)
val AccentInk = Color(0xFFFFFFFF)       // text on accent
val AccentSoft = Color(0x242B8CFF)      // accent @14%
val AccentLine = Color(0x732B8CFF)      // accent @45%
val AccentBlue = Color(0xFF4F74FF)      // gradient partner = web --color-brand-2

val ScreenBg = Color(0xFFF2F4F7)        // main area
val CardBg = Color(0xFFFFFFFF)          // surfaces / cards
val Inset = Color(0xFFEEF1F5)           // inputs / display cards
val InsetAlt = Color(0xFFE8ECF1)        // keys / method chips (unselected)
val Tile = Color(0xFFF6F8FA)            // product tiles
val NavBg = Color(0xFFFFFFFF)

val TextPrimary = Color(0xFF17202A)
val TextSecondary = Color(0xFF5B6B7A)
val TextMuted = Color(0xFF8494A3)
val Hairline = Color(0x140F1A24)        // rgba(15,26,36,.08)
val HairlineStrong = Color(0x1F0F1A24)

val Success = Color(0xFF1FA361)         // paid / change
val Warning = Color(0xFFC17A00)         // balance due / on-account
val Danger = Color(0xFFD63A3A)          // remove / cancel
val Plate = Color(0xFFF0C542)

// ─── Fonts ────────────────────────────────────────────────────────────────────
val Barlow = FontFamily(
    Font(R.font.barlow_regular, FontWeight.Normal),
    Font(R.font.barlow_medium, FontWeight.Medium),
    Font(R.font.barlow_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_bold, FontWeight.Bold),
    Font(R.font.barlow_extrabold, FontWeight.ExtraBold),
)
val Condensed = FontFamily(
    Font(R.font.barlow_condensed_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_condensed_bold, FontWeight.Bold),
)
val Mono = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
)

private val PosColors = lightColorScheme(
    primary = Accent,
    onPrimary = AccentInk,
    secondary = Success,
    background = ScreenBg,
    onBackground = TextPrimary,
    surface = CardBg,
    onSurface = TextPrimary,
    surfaceVariant = Inset,
    onSurfaceVariant = TextSecondary,
    outline = Hairline,
    error = Danger,
    onError = Color.White,
)

private val PosType = Typography().run {
    val b = Barlow
    copy(
        bodyLarge = bodyLarge.copy(fontFamily = b),
        bodyMedium = bodyMedium.copy(fontFamily = b),
        bodySmall = bodySmall.copy(fontFamily = b),
        labelLarge = labelLarge.copy(fontFamily = b),
        labelMedium = labelMedium.copy(fontFamily = b),
        labelSmall = labelSmall.copy(fontFamily = b),
        titleLarge = titleLarge.copy(fontFamily = b),
        titleMedium = titleMedium.copy(fontFamily = b),
        titleSmall = titleSmall.copy(fontFamily = b),
    )
}

/**
 * How much bigger every piece of text runs than the design handoff specified.
 *
 * The staff work this tablet standing, at arm's length, often in daylight — they
 * reported the whole UI as "really small". Rather than re-typing a few hundred
 * fontSize values (and missing some), we raise the font scale for the entire app
 * from one place: every `.sp` in every screen multiplies by this. Layout is
 * unaffected — `.dp` boxes keep their size — so the only thing that changes is
 * legibility. Tune THIS number if they want it bigger still.
 */
const val PosFontScale = 1.22f

@Composable
fun CarfectionistPosTheme(content: @Composable () -> Unit) {
    val base = LocalDensity.current
    // Scale text only: same density (so every dp keeps its physical size), higher
    // fontScale (so every sp grows).
    val scaled = Density(density = base.density, fontScale = base.fontScale * PosFontScale)
    CompositionLocalProvider(LocalDensity provides scaled) {
        MaterialTheme(colorScheme = PosColors, typography = PosType) {
            androidx.compose.material3.ProvideTextStyle(
                TextStyle(fontFamily = Barlow, color = TextPrimary),
                content,
            )
        }
    }
}
