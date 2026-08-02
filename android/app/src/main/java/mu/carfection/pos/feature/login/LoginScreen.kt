package mu.carfection.pos.feature.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.R
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.OfflinePinStore
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.core.network.PinAuthApi
import mu.carfection.pos.core.sync.ConnectivityObserver
import mu.carfection.pos.core.network.PinLoginException
import mu.carfection.pos.core.network.RosterEntry
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Tile
import javax.inject.Inject

data class LoginUiState(
    val configured: Boolean = true,
    val loadingRoster: Boolean = true,
    val roster: List<RosterEntry> = emptyList(),
    val rosterError: String? = null,
    val selectedId: String? = null,
    val pin: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    // The roster on screen came from this tablet's cache, not the server — the outage
    // sign-in. PINs verify locally, and only for staff who have signed in here before.
    val offlineRoster: Boolean = false,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val session: SessionRepository,
    private val catalog: CatalogRepository,
    private val pinApi: PinAuthApi,
    private val offlinePins: OfflinePinStore,
    private val connectivity: ConnectivityObserver,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState(configured = pinApi.configured, loadingRoster = pinApi.configured))
    val state = _state.asStateFlow()

    init { if (pinApi.configured) loadRoster() }

    fun loadRoster() {
        // only block the panel when there's nothing to show — a re-entry refresh is silent
        _state.update { it.copy(loadingRoster = it.roster.isEmpty(), rosterError = null) }
        viewModelScope.launch {
            runCatching { pinApi.roster() }
                .onSuccess { r ->
                    offlinePins.rememberRoster(r) // the tiles the NEXT outage will show
                    _state.update { it.copy(loadingRoster = false, roster = r, offlineRoster = false) }
                }
                .onFailure {
                    // The server is out of reach. The last roster it served still names the
                    // staff — show it, and let the local verifiers decide who gets in.
                    val cached = offlinePins.cachedRoster()
                    _state.update {
                        if (cached.isNotEmpty()) it.copy(loadingRoster = false, roster = cached, offlineRoster = true, rosterError = null)
                        else it.copy(
                            loadingRoster = false,
                            rosterError = if (it.roster.isEmpty()) "Can't reach the login server. Check the connection and try again." else null,
                        )
                    }
                }
        }
    }

    /**
     * The sign-in screen (re)entered composition — start clean for the next operator. This
     * ViewModel is activity-scoped, so without it a logout brought the previous login's state
     * back with it: busy=true from the successful submit froze the whole keypad.
     */
    fun onShown() {
        _state.update { it.copy(busy = false, pin = "", selectedId = null, error = null) }
        if (pinApi.configured) loadRoster()
    }

    fun pick(id: String) = _state.update { it.copy(selectedId = id, pin = "", error = null) }
    fun cancel() = _state.update { it.copy(selectedId = null, pin = "", error = null) }
    fun backspace() = _state.update { if (it.pin.isNotEmpty() && !it.busy) it.copy(pin = it.pin.dropLast(1)) else it }

    fun press(digit: String) {
        val s = _state.value
        if (s.busy || s.pin.length >= 4) return
        val id = s.selectedId ?: run { _state.update { it.copy(error = "Pick your name first") }; return }
        val pin = s.pin + digit
        _state.update { it.copy(pin = pin, error = null) }
        if (pin.length == 4) submit(id, pin)
    }

    private fun submit(appUserId: String, pin: String) {
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            // ── the server first, whenever it might answer ────────────────────────
            // Its verdict is authoritative in BOTH directions: a success mints the real
            // session (and refreshes this tablet's local verifier for the next outage);
            // a refusal is final and never falls through to the local check — the local
            // verifier must never overrule the server while the server is reachable.
            if (connectivity.online.value) {
                runCatching {
                    val sess = pinApi.pinLogin(appUserId, pin, session.deviceId())
                    session.signInWithPin(sess) // flips isLoggedIn -> the shell replaces this screen
                    offlinePins.rememberSuccessfulLogin(
                        RosterEntry(sess.operator.appUserId, sess.operator.displayName, sess.operator.role),
                        pin,
                    )
                    // Warm the offline cache — best-effort. The sign-in has already succeeded;
                    // a failed refresh must not read as a failed login (the fall-through below
                    // would run the offline check over a session that is already live).
                    runCatching { catalog.refresh() }
                }.onSuccess {
                    // Reset for the NEXT operator: this activity-scoped ViewModel survives the
                    // logout, and a lingering busy=true would freeze the keypad on re-login.
                    _state.update { it.copy(busy = false, pin = "", selectedId = null, error = null) }
                    return@launch
                }.onFailure { e ->
                    if (e is PinLoginException) {
                        // The server SAW the PIN and said no. If the local verifier would
                        // have said yes, the PIN was changed from the web — drop the stale
                        // verifier so the old PIN stops unlocking this tablet offline.
                        offlinePins.noteServerRefusal(appUserId, pin)
                        val msg =
                            if (e.reason.contains("lock", true) || e.lockedUntil != null)
                                "Too many tries — locked for a moment. Ask an owner if this persists."
                            else "Wrong PIN — try again"
                        _state.update { it.copy(busy = false, pin = "", error = msg) }
                        return@launch
                    }
                    // The request never got an answer (mid-transition network) — the offline
                    // path below is exactly for that.
                }
            }

            // ── no server in reach: the tablet's own verifier decides ─────────────
            when (val r = offlinePins.verifyOffline(appUserId, pin)) {
                is OfflinePinStore.Result.Ok -> {
                    session.signInOffline(r.operator) // no tokens minted — see SessionRepository
                    _state.update { it.copy(busy = false, pin = "", selectedId = null, error = null) }
                }
                OfflinePinStore.Result.WrongPin ->
                    _state.update { it.copy(busy = false, pin = "", error = "Wrong PIN — try again") }
                is OfflinePinStore.Result.Locked ->
                    _state.update {
                        it.copy(
                            busy = false, pin = "",
                            error = "Too many tries — locked for ${(r.remainingMs / 1000).coerceAtLeast(1)}s.",
                        )
                    }
                OfflinePinStore.Result.Unknown ->
                    _state.update {
                        it.copy(
                            busy = false, pin = "",
                            // The roster sync distributes verifiers, so this is now rare: a PIN
                            // newer than this tablet's last moment online.
                            error = "Offline — this tablet doesn't have your sign-in details yet. " +
                                "They arrive when it's next online; try another staff member for now.",
                        )
                    }
            }
        }
    }
}

/** Distinct avatar colours per operator, cycled by roster position (handoff palette). */
private val AvatarColors = listOf(
    Color(0xFF2B8CFF), Color(0xFF8B5CF6), Color(0xFFF08C2E),
    Color(0xFF22A06B), Color(0xFF5B5BD6), Color(0xFFE5484D),
)

private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return when {
        parts.size >= 2 -> "${parts[0].first()}${parts[1].first()}".uppercase()
        parts.isNotEmpty() -> parts[0].take(2).uppercase()
        else -> "?"
    }
}

@Composable
fun LoginScreen(viewModel: LoginViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.onShown() } // fresh keypad + roster on every (re)entry
    // Handoff "Switch user" modal: dimmed backdrop, centred 660dp card, roster | keypad.
    Box(Modifier.fillMaxSize().background(ScreenBg)) {
        Box(Modifier.fillMaxSize().background(Color(0x730F1A24)))
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when {
                !s.configured -> NotConfiguredCard()
                else -> Row(
                    Modifier.width(660.dp).height(IntrinsicSize.Min)
                        .background(CardBg, RoundedCornerShape(22.dp))
                        .border(1.dp, Color(0x1F0F1A24), RoundedCornerShape(22.dp))
                        .padding(20.dp),
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    RosterPanel(Modifier.weight(1f).fillMaxHeight(), s, viewModel)
                    KeypadPanel(s, viewModel)
                }
            }
        }
    }
}

@Composable
private fun RosterPanel(modifier: Modifier, s: LoginUiState, vm: LoginViewModel) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.padding(top = 4.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(28.dp).background(Color(0xFF0B0D0F), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.logo_carfectionist), contentDescription = "Carfectionist", modifier = Modifier.size(26.dp))
            }
            Text("SIGN IN", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 18.sp, letterSpacing = 1.5.sp)
        }
        when {
            s.loadingRoster -> Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.dp, color = Accent)
            }
            s.rosterError != null -> Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(s.rosterError, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp)
                Box(Modifier.height(42.dp).background(Accent, RoundedCornerShape(11.dp)).clickable { vm.loadRoster() }.padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                    Text("Retry", color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                }
            }
            s.roster.isEmpty() -> Text("No staff with a PIN yet. Set one from the web app's Team settings.", color = TextMuted, fontFamily = Barlow, fontSize = 13.sp)
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                s.roster.chunked(2).forEachIndexed { rowIx, pair ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEachIndexed { colIx, u ->
                            StaffTile(Modifier.weight(1f), u, AvatarColors[(rowIx * 2 + colIx) % AvatarColors.size], u.appUserId == s.selectedId) { vm.pick(u.appUserId) }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        if (s.offlineRoster) {
            // Say it plainly BEFORE a PIN is typed: the gate still works, and for whom.
            // "Already knows" = has a verifier, from the server's roster or a past
            // sign-in here — not "has used this tablet", which server seeding outgrew.
            Text(
                "Offline — sign-in still works for staff the tablet already knows.",
                color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp,
            )
            Spacer(Modifier.height(4.dp))
        }
        Text("Tap your name, then enter your 4-digit PIN.", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp)
    }
}

@Composable
private fun StaffTile(modifier: Modifier, u: RosterEntry, avatarColor: Color, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier
            .background(if (selected) AccentSoft else Tile, RoundedCornerShape(13.dp))
            .border(1.5.dp, if (selected) AccentLine else Color.Transparent, RoundedCornerShape(13.dp))
            .clickable(onClick = onClick).padding(horizontal = 11.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(36.dp).background(avatarColor, CircleShape), contentAlignment = Alignment.Center) {
            Text(initials(u.displayName), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Color.White)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(u.displayName, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary, maxLines = 1)
            Text(u.role.replaceFirstChar { it.uppercase() }, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted, maxLines = 1)
        }
    }
}

@Composable
private fun KeypadPanel(s: LoginUiState, vm: LoginViewModel) {
    Row(Modifier.width(257.dp)) {
        Box(Modifier.width(1.dp).fillMaxHeight().background(Color(0x170F1A24)))
        Column(
            Modifier.padding(start = 18.dp).weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // PIN dots
            Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp), horizontalArrangement = Arrangement.Center) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    repeat(4) { i ->
                        Box(Modifier.size(13.dp).background(if (i < s.pin.length) Accent else Color.Transparent, CircleShape).border(1.5.dp, Color(0x4D0F1A24), CircleShape))
                    }
                }
            }
            s.error?.let { Text(it, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, modifier = Modifier.fillMaxWidth()) }
            // keypad
            val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫")
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                keys.chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        row.forEach { k -> Key(Modifier.weight(1f), k, s.busy) {
                            when (k) { "" -> {}; "⌫" -> vm.backspace(); else -> vm.press(k) }
                        } }
                    }
                }
            }
            Box(
                Modifier.fillMaxWidth().height(44.dp).border(1.dp, Color(0x2E0F1A24), RoundedCornerShape(11.dp)).clickable { vm.cancel() },
                contentAlignment = Alignment.Center,
            ) { Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }
        }
    }
}

@Composable
private fun Key(modifier: Modifier, label: String, busy: Boolean, onClick: () -> Unit) {
    if (label.isBlank()) { Box(modifier.height(52.dp)); return }
    Box(
        modifier.height(52.dp).background(InsetAlt, RoundedCornerShape(11.dp)).border(1.dp, Color(0x120F1A24), RoundedCornerShape(11.dp))
            .clickable(enabled = !busy, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (busy && label != "⌫") CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
        else Text(label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, color = TextPrimary)
    }
}

@Composable
private fun NotConfiguredCard() {
    Column(
        Modifier.width(460.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(30.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("CARFECTIONIST", color = Accent, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = 2.sp)
        Text("PIN login isn't set up on this tablet yet", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(
            "Add the Supabase URL and the shared device key to local.properties (supabase.url / pos.deviceKey), then rebuild.",
            color = TextSecondary, fontFamily = Barlow, fontSize = 13.sp, lineHeight = 19.sp,
        )
    }
}
