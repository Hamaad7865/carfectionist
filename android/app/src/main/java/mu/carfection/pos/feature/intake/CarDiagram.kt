package mu.carfection.pos.feature.intake

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.ui.theme.Barlow

/** Top-view car body, translated exactly from the handoff's SVG (viewBox 260×520). */
private val CarBody: ImageVector = ImageVector.Builder("CarBody", 260.dp, 520.dp, 260f, 520f).apply {
    val wheel = SolidColor(Color(0xFFAEBAC6))
    fun PathBuilder.rr(x: Float, y: Float, w: Float, h: Float, r: Float) {
        moveTo(x + r, y); lineTo(x + w - r, y); arcTo(r, r, 0f, false, true, x + w, y + r)
        lineTo(x + w, y + h - r); arcTo(r, r, 0f, false, true, x + w - r, y + h)
        lineTo(x + r, y + h); arcTo(r, r, 0f, false, true, x, y + h - r)
        lineTo(x, y + r); arcTo(r, r, 0f, false, true, x + r, y); close()
    }
    // wheels
    path(fill = wheel) { rr(30f, 84f, 20f, 72f, 10f); rr(210f, 84f, 20f, 72f, 10f); rr(30f, 368f, 20f, 72f, 10f); rr(210f, 368f, 20f, 72f, 10f) }
    // body
    path(fill = SolidColor(Color(0xFFE7EBF0)), stroke = SolidColor(Color(0x66101A24)), strokeLineWidth = 2f) {
        moveTo(130f, 14f); curveTo(176f, 14f, 199f, 30f, 203f, 62f); lineTo(209f, 116f)
        curveTo(213f, 152f, 215f, 198f, 215f, 252f); lineTo(215f, 356f)
        curveTo(215f, 404f, 211f, 446f, 204f, 472f); curveTo(197f, 499f, 168f, 508f, 130f, 508f)
        curveTo(92f, 508f, 63f, 499f, 56f, 472f); curveTo(49f, 446f, 45f, 404f, 45f, 356f); lineTo(45f, 252f)
        curveTo(45f, 198f, 47f, 152f, 51f, 116f); lineTo(57f, 62f); curveTo(61f, 30f, 84f, 14f, 130f, 14f); close()
    }
    val hair = SolidColor(Color(0x2E101A24)); val glass = SolidColor(Color(0x2E4678A0)); val glassStroke = SolidColor(Color(0x40101A24))
    path(stroke = hair, strokeLineWidth = 1.6f) { moveTo(72f, 108f); curveTo(102f, 96f, 158f, 96f, 188f, 108f) }
    path(fill = glass, stroke = glassStroke, strokeLineWidth = 1.6f) { moveTo(76f, 134f); curveTo(104f, 122f, 156f, 122f, 184f, 134f); lineTo(174f, 178f); curveTo(146f, 169f, 114f, 169f, 86f, 178f); close() }
    path(stroke = SolidColor(Color(0x1F101A24)), strokeLineWidth = 1.6f) { moveTo(84f, 188f); lineTo(81f, 328f); moveTo(176f, 188f); lineTo(179f, 328f) }
    path(fill = glass, stroke = glassStroke, strokeLineWidth = 1.6f) { moveTo(86f, 340f); curveTo(114f, 350f, 146f, 350f, 174f, 340f); lineTo(182f, 378f); curveTo(152f, 390f, 108f, 390f, 78f, 378f); close() }
    path(stroke = hair, strokeLineWidth = 1.6f) { moveTo(76f, 452f); curveTo(108f, 462f, 152f, 462f, 184f, 452f) }
    val mirror = SolidColor(Color(0xFFE7EBF0)); val mirrorStroke = SolidColor(Color(0x59101A24))
    path(fill = mirror, stroke = mirrorStroke, strokeLineWidth = 1.6f) { moveTo(45f, 146f); lineTo(28f, 154f); lineTo(28f, 170f); lineTo(45f, 175f); close() }
    path(fill = mirror, stroke = mirrorStroke, strokeLineWidth = 1.6f) { moveTo(215f, 146f); lineTo(232f, 154f); lineTo(232f, 170f); lineTo(215f, 175f); close() }
}.build()

data class DamageMarker(val xFrac: Float, val yFrac: Float, val letter: String, val color: Color)

@Composable
fun DamageDiagram(
    markers: List<DamageMarker>,
    onTap: (xFrac: Float, yFrac: Float) -> Unit,
    onRemove: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier) {
        val w = maxWidth; val h = maxHeight
        Image(
            painter = rememberVectorPainter(CarBody),
            contentDescription = "Vehicle condition diagram",
            modifier = Modifier.fillMaxSize().pointerInput(Unit) {
                detectTapGestures { off -> onTap(off.x / size.width, off.y / size.height) }
            },
        )
        markers.forEachIndexed { i, m ->
            Box(
                Modifier.size(26.dp)
                    .offset(x = w * m.xFrac - 13.dp, y = h * m.yFrac - 13.dp)
                    .background(m.color, CircleShape)
                    .border(2.dp, Color(0xD9FFFFFF), CircleShape)
                    .clickable { onRemove(i) },
                contentAlignment = Alignment.Center,
            ) { Text(m.letter, color = Color(0xFF0B0D0F), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
        }
    }
}
