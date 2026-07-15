package mu.carfection.pos.feature.update

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mu.carfection.pos.core.update.UpdateState

/**
 * The self-update surface. Sits at the top of the app tree so it can appear over any
 * screen (even the login), because a stale build is a shop-wide problem, not one tied
 * to a tab. Non-blocking: "Later" dismisses; the check runs again next launch.
 */
@Composable
fun UpdateOverlay(vm: UpdateViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    when (val s = state) {
        is UpdateState.Available -> Scrim {
            Card {
                Text("Update available", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
                Text("Version ${s.manifest.versionName} is ready to install.", fontSize = 13.sp, color = Muted)
                if (s.manifest.notes.isNotBlank()) {
                    Text(s.manifest.notes, fontSize = 12.5.sp, color = Muted, modifier = Modifier.padding(top = 2.dp))
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Btn("Later", outlined = true, modifier = Modifier.weight(1f)) { vm.dismiss() }
                    Btn("Update", modifier = Modifier.weight(1.4f)) { vm.install(s.manifest) }
                }
            }
        }
        is UpdateState.Downloading -> Scrim(dismissible = false) {
            Card {
                Text("Downloading update…", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                Text("${s.percent}%", fontSize = 13.sp, color = Muted)
                Spacer(Modifier.height(4.dp))
                LinearProgressIndicator(progress = { s.percent / 100f }, modifier = Modifier.fillMaxWidth())
                Text("Keep the app open until the installer appears.", fontSize = 11.5.sp, color = Muted)
            }
        }
        is UpdateState.Error -> Scrim {
            Card {
                Text("Update", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                Text(s.message, fontSize = 13.sp, color = Rose)
                Spacer(Modifier.height(4.dp))
                Btn("OK", modifier = Modifier.fillMaxWidth()) { vm.dismiss() }
            }
        }
        UpdateState.Idle -> Unit
    }
}

private val Ink = Color(0xFF101A24)
private val Muted = Color(0xFF5B6B7A)
private val Rose = Color(0xFFD63A3A)
private val Accent = Color(0xFF2B8CFF)

@Composable
private fun Scrim(dismissible: Boolean = true, content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color(0x88101A24)),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun Card(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.width(360.dp).background(Color.White, RoundedCornerShape(18.dp)).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun Btn(label: String, modifier: Modifier = Modifier, outlined: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier
            .height(48.dp)
            .background(if (outlined) Color.White else Accent, RoundedCornerShape(12.dp))
            .then(if (outlined) Modifier.border(1.dp, Color(0x33101A24), RoundedCornerShape(12.dp)) else Modifier)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (outlined) Ink else Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}
