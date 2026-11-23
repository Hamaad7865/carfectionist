package mu.carfection.pos.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import mu.carfection.pos.R

// Carfectionist's design tokens. Every flavor supplies this same set of names (see
// src/tyrecentre/.../BrandTokens.kt); the screens read only these. These values are the
// shop's live look — change them only on purpose, never as a side effect of the other brand.

/** Who this build is for: the name on the splash, the login and anything printed by the app. */
object Brand {
    const val NAME = "Carfectionist"
    const val WORDMARK = "CARFECTIONIST"
    const val APP_NAME = "Carfectionist POS"
    val logo: Int = R.drawable.logo_carfectionist
}

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
