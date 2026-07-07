package mu.carfection.pos.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Carfectionist identity — gold monogram on near-black (matches the brand +
// printed documents), with the studio's status colours.
val Gold = Color(0xFFD4AF37)
val GoldDeep = Color(0xFFB8942A)
val Ink = Color(0xFF0E1013)
val Surface1 = Color(0xFF171B20)
val Surface2 = Color(0xFF1F242B)
val Line = Color(0xFF2A313A)
val TextHi = Color(0xFFF2F4F7)
val TextMid = Color(0xFFA7B1BC)
val TextLow = Color(0xFF6C7783)
val Mint = Color(0xFF34C98E) // success / change
val Amber = Color(0xFFF5A623) // warning / balance due / on-account
val Rose = Color(0xFFFF5468) // danger

private val PosColors = darkColorScheme(
    primary = Gold,
    onPrimary = Color(0xFF151208),
    secondary = Mint,
    onSecondary = Ink,
    background = Ink,
    onBackground = TextHi,
    surface = Surface1,
    onSurface = TextHi,
    surfaceVariant = Surface2,
    onSurfaceVariant = TextMid,
    outline = Line,
    error = Rose,
    onError = Color.White,
)

@Composable
fun CarfectionistPosTheme(content: @Composable () -> Unit) {
    // The shop floor runs dark, always — no light theme on the till.
    isSystemInDarkTheme() // (intentionally ignored)
    MaterialTheme(colorScheme = PosColors, content = content)
}
