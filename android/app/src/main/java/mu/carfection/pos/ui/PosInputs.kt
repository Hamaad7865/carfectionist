package mu.carfection.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary

/** The handoff's flat filled input — a coloured box, no Material outline/label. */
@Composable
fun FilledInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
    radius: Dp = 11.dp,
    bg: Color = CardBg,
    fontFamily: FontFamily = Barlow,
    fontSize: TextUnit = 15.sp,
    leadingSearch: Boolean = false,
) {
    val shape = RoundedCornerShape(radius)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = TextStyle(color = TextPrimary, fontFamily = fontFamily, fontSize = fontSize),
        cursorBrush = SolidColor(Accent),
        modifier = modifier.height(height).background(bg, shape).border(1.dp, Color(0x1F101A24), shape),
    ) { inner ->
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            if (leadingSearch) Icon(Icons.Default.Search, null, tint = TextMuted, modifier = Modifier.padding(start = 15.dp, end = 11.dp)) else Box(Modifier.padding(start = 14.dp))
            Box(Modifier.padding(end = 14.dp)) {
                if (value.isEmpty()) Text(placeholder, color = TextMuted, fontFamily = fontFamily, fontSize = fontSize)
                inner()
            }
        }
    }
}
