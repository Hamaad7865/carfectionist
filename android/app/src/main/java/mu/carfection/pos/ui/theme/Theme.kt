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

// The colour and font tokens (Accent, ScreenBg, Barlow, Mono, …) and `Brand` come from the
// flavor: src/carfectionist/… and src/tyrecentre/…/ui/theme/BrandTokens.kt.

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
