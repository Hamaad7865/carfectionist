package mu.carfection.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary

// The car's journey — Intake → Quote → Client signs → Job → Invoice — shown
// the same way on the tablet as in the back office, so the owner sees where
// every car stands at a glance.

enum class FlowState { DONE, CURRENT, TODO, DECLINED }
data class FlowStepUi(val label: String, val state: FlowState, val detail: String? = null)

/** Marks the first TODO as CURRENT — "this is where the car stands now". */
fun List<FlowStepUi>.withCurrent(): List<FlowStepUi> {
    val i = indexOfFirst { it.state == FlowState.TODO }
    return if (i < 0) this else mapIndexed { idx, s -> if (idx == i) s.copy(state = FlowState.CURRENT) else s }
}

@Composable
fun FlowStrip(steps: List<FlowStepUi>, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(CardBg, RoundedCornerShape(13.dp))
            .border(1.dp, Hairline, RoundedCornerShape(13.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        steps.forEachIndexed { i, s ->
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Box(Modifier.weight(1f).height(2.dp).background(if (i == 0) CardBg else if (steps[i - 1].state == FlowState.DONE) Accent else Hairline))
                    val (bg, border, mark) = when (s.state) {
                        FlowState.DONE -> Triple(Accent, Accent, "✓")
                        FlowState.DECLINED -> Triple(Danger, Danger, "✕")
                        FlowState.CURRENT -> Triple(CardBg, Accent, "")
                        FlowState.TODO -> Triple(CardBg, Hairline, "")
                    }
                    Box(
                        Modifier.size(22.dp).background(bg, CircleShape).border(2.dp, border, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (mark.isNotEmpty()) Text(mark, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = AccentInk)
                        else if (s.state == FlowState.CURRENT) Box(Modifier.size(8.dp).background(Accent, CircleShape))
                    }
                    Box(Modifier.weight(1f).height(2.dp).background(if (i == steps.lastIndex) CardBg else if (s.state == FlowState.DONE) Accent else Hairline))
                }
                Spacer(Modifier.height(5.dp))
                Text(
                    s.label.uppercase(),
                    fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 0.8.sp,
                    color = when (s.state) {
                        FlowState.DECLINED -> Danger
                        FlowState.TODO -> TextMuted
                        else -> TextPrimary
                    },
                    maxLines = 1, textAlign = TextAlign.Center,
                )
                s.detail?.let {
                    Text(
                        it, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 9.sp, color = TextMuted,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 2.dp),
                    )
                }
            }
            if (i != steps.lastIndex) Spacer(Modifier.width(0.dp))
        }
    }
}
