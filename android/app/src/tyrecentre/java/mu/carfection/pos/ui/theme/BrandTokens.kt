package mu.carfection.pos.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import mu.carfection.pos.R

// The tyre centre's design tokens (docs/redesign/DESIGN-SPEC.md §2–3), under the same names
// Carfectionist's flavor uses, so every shared screen takes this look with no code of its own.
// Tokens only this brand has (lime highlight, company colours) are in TcTokens.kt.

object Brand {
    const val NAME = "Tyre Centre"
    const val WORDMARK = "TYRE CENTRE"
    const val APP_NAME = "Tyre Centre POS"
    val logo: Int = R.drawable.tc_logo
}

val Accent = Color(0xFF0F1720)          // primary: the black pill
val AccentInk = Color(0xFFFFFFFF)       // on-primary
val AccentSoft = Color(0x1A0F1720)      // primary @10% — selected soft fills
val AccentLine = Color(0x590F1720)      // primary @35%
val AccentBlue = Color(0xFF6A5CFF)      // avatar gradient partner

val ScreenBg = Color(0xFFE8ECF1)        // app
val CardBg = Color(0xFFFFFFFF)          // card
val Inset = Color(0xFFF4F6F9)           // sub
val InsetAlt = Color(0xFFEBEEF2)        // sidebar-active: keys / unselected chips
val Tile = Color(0xFFFFFFFF)            // tiles are white cards on the app background
val NavBg = Color(0xFFF7F8FA)           // sidebar

val TextPrimary = Color(0xFF111927)     // ink
val TextSecondary = Color(0xFF68737F)   // muted
val TextMuted = Color(0xFF8C96A1)       // faint
val Hairline = Color(0x120F1720)        // line rgba(15,23,32,.07)
val HairlineStrong = Color(0x1F0F1720)

val Success = Color(0xFF0DA77C)
val Warning = Color(0xFFB07C14)
val Danger = Color(0xFFD63B50)
val Plate = Color(0xFFF0C542)

// ─── Fonts (OFL, bundled in src/tyrecentre/res/font) ──────────────────────────
// The shared screens call the UI family `Barlow`, the display family `Condensed` and the
// numbers family `Mono`; here they are Manrope, Archivo and JetBrains Mono.
val Manrope = FontFamily(
    Font(R.font.manrope_400, FontWeight.Normal),
    Font(R.font.manrope_500, FontWeight.Medium),
    Font(R.font.manrope_600, FontWeight.SemiBold),
    Font(R.font.manrope_700, FontWeight.Bold),
    Font(R.font.manrope_800, FontWeight.ExtraBold),
)
val Archivo = FontFamily(
    Font(R.font.archivo_300, FontWeight.Light),
    Font(R.font.archivo_500, FontWeight.Medium),
    Font(R.font.archivo_600, FontWeight.SemiBold),
    Font(R.font.archivo_700, FontWeight.Bold),
)
val JetBrainsMono = FontFamily(
    Font(R.font.jetbrains_mono_400, FontWeight.Normal),
    Font(R.font.jetbrains_mono_500, FontWeight.Medium),
    Font(R.font.jetbrains_mono_600, FontWeight.SemiBold),
    Font(R.font.jetbrains_mono_700, FontWeight.Bold),
)
val Barlow: FontFamily = Manrope
val Condensed: FontFamily = Archivo
val Mono: FontFamily = JetBrainsMono
