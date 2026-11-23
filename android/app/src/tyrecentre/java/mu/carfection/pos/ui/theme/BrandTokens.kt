package mu.carfection.pos.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import mu.carfection.pos.R

// The tyre centre's design tokens, under the same names Carfectionist's flavor uses, so every
// shared screen takes this look with no code of its own.
//
// 2026-11-24, owner's call: the tyre app takes CARFECTIONIST's look (blue #2B8CFF, Barlow,
// Barlow Condensed, IBM Plex Mono — the same values as src/carfectionist/.../BrandTokens.kt),
// with its own logo and its own New-sale, Payment and Stock layouts (Kite file
// https://kite.new/p/4y3zeeyaa6jwdfgj). The black-pill / lime look of docs/redesign/DESIGN-SPEC.md
// was rejected for the tablet — do not restore it. Tokens only this brand has are in TcTokens.kt.

object Brand {
    const val NAME = "Tyre Centre"
    const val WORDMARK = "TYRE CENTRE"
    const val APP_NAME = "Tyre Centre POS"
    val logo: Int = R.drawable.tc_logo
}

val Accent = Color(0xFF2B8CFF)
val AccentInk = Color(0xFFFFFFFF)
val AccentSoft = Color(0x242B8CFF)      // accent @14%
val AccentLine = Color(0x732B8CFF)      // accent @45%
val AccentBlue = Color(0xFF4F74FF)

val ScreenBg = Color(0xFFF2F4F7)
val CardBg = Color(0xFFFFFFFF)
val Inset = Color(0xFFEEF1F5)
val InsetAlt = Color(0xFFE8ECF1)
val Tile = Color(0xFFF6F8FA)
val NavBg = Color(0xFFFFFFFF)

val TextPrimary = Color(0xFF17202A)
val TextSecondary = Color(0xFF5B6B7A)
val TextMuted = Color(0xFF8494A3)
val Hairline = Color(0x140F1A24)
val HairlineStrong = Color(0x1F0F1A24)

val Success = Color(0xFF1FA361)
val Warning = Color(0xFFC17A00)
val Danger = Color(0xFFD63A3A)
val Plate = Color(0xFFF0C542)

// ─── Fonts (the shared Barlow / IBM Plex Mono files in src/main/res/font) ─────
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
