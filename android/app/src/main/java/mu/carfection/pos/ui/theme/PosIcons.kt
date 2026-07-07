package mu.carfection.pos.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The handoff's nav-rail icons, drawn as exact 24×24 stroke vectors (stroke 1.8,
 * round caps/joins) from the SVG path data in design-reference/Detailing-POS.html.
 * Tint recolours the stroke, so `Icon(tint = …)` gives the active/inactive colour.
 */

private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
    moveTo(cx + r, cy)
    arcTo(r, r, 0f, false, isPositiveArc = true, cx - r, cy)
    arcTo(r, r, 0f, false, isPositiveArc = true, cx + r, cy)
    close()
}

private fun PathBuilder.roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) {
    moveTo(x + r, y)
    lineTo(x + w - r, y); arcTo(r, r, 0f, false, true, x + w, y + r)
    lineTo(x + w, y + h - r); arcTo(r, r, 0f, false, true, x + w - r, y + h)
    lineTo(x + r, y + h); arcTo(r, r, 0f, false, true, x, y + h - r)
    lineTo(x, y + r); arcTo(r, r, 0f, false, true, x + r, y)
    close()
}

private fun strokeIcon(name: String, block: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        path(
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
            pathBuilder = block,
        )
    }.build()

object PosIcons {
    // person + plus
    val Intake: ImageVector = strokeIcon("Intake") {
        circle(10f, 8f, 3.4f)
        moveTo(4.2f, 19.6f); curveToRelative(0.7f, -3.4f, 3.1f, -5.3f, 5.8f, -5.3f); curveToRelative(2.7f, 0f, 5.1f, 1.9f, 5.8f, 5.3f)
        moveTo(18.5f, 6.5f); verticalLineToRelative(5f); moveTo(16f, 9f); horizontalLineToRelative(5f)
    }

    // document
    val Quote: ImageVector = strokeIcon("Quote") {
        moveTo(7f, 3.5f); horizontalLineToRelative(6.8f); lineTo(18.5f, 8f); verticalLineToRelative(12.5f); horizontalLineTo(7f); close()
        moveTo(13.5f, 3.5f); verticalLineTo(8f); horizontalLineToRelative(5f)
        moveTo(9.8f, 12.5f); horizontalLineToRelative(4.4f); moveTo(9.8f, 16f); horizontalLineToRelative(4.4f)
    }

    // three kanban bars
    val Jobs: ImageVector = strokeIcon("Jobs") {
        roundRect(3.2f, 4f, 4.9f, 12f, 1.4f)
        roundRect(9.6f, 4f, 4.9f, 16f, 1.4f)
        roundRect(16f, 4f, 4.9f, 8.5f, 1.4f)
    }

    // card reader
    val Checkout: ImageVector = strokeIcon("Checkout") {
        roundRect(2.8f, 6.5f, 18.4f, 11.5f, 2f)
        circle(12f, 12.2f, 2.7f)
        moveTo(6f, 9.6f); horizontalLineToRelative(0.01f); moveTo(18f, 14.9f); horizontalLineToRelative(0.01f)
    }

    // cube
    val Stock: ImageVector = strokeIcon("Stock") {
        moveTo(12f, 3f); lineToRelative(8f, 4.4f); verticalLineToRelative(9.2f); lineTo(12f, 21f); lineToRelative(-8f, -4.4f); verticalLineTo(7.4f); close()
        moveTo(4.2f, 7.6f); lineTo(12f, 12f); lineToRelative(7.8f, -4.4f); moveTo(12f, 12f); verticalLineToRelative(8.6f)
    }

    // medal
    val Warranty: ImageVector = strokeIcon("Warranty") {
        circle(12f, 9.5f, 5.3f)
        moveTo(9.5f, 13.9f); lineTo(8f, 21f); lineToRelative(4f, -2.3f); lineTo(16f, 21f); lineToRelative(-1.5f, -7.1f)
        moveTo(10f, 9.7f); lineToRelative(1.5f, 1.5f); lineToRelative(2.7f, -3f)
    }

    // gauge (stroke) + centre dot (fill)
    val Today: ImageVector = ImageVector.Builder("Today", 24.dp, 24.dp, 24f, 24f).apply {
        path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
            moveTo(4f, 16.5f); arcToRelative(8.3f, 8.3f, 0f, true, true, 16f, 0f)
            moveTo(12f, 16.5f); lineToRelative(3.8f, -4.6f)
        }
        path(fill = SolidColor(Color.Black)) { circle(12f, 16.5f, 1.3f) }
    }.build()
}
