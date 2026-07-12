package mu.carfection.pos.feature.till

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.TillRepository
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.parseMoneyToCents
import mu.carfection.pos.core.network.CashSessionDto
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning
import mu.carfection.pos.core.network.uiMessage
import javax.inject.Inject

data class TillUiState(
    val loading: Boolean = true,
    val session: CashSessionDto? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val justClosed: CashSessionDto? = null,
    val notice: String? = null,          // e.g. "Cash out recorded"
    val cashOutDone: Int = 0,            // bumps so the screen clears its fields
)

@HiltViewModel
class TillViewModel @Inject constructor(
    private val till: TillRepository,
    private val zReport: mu.carfection.pos.core.data.TillZReport,
) : ViewModel() {
    private val _s = MutableStateFlow(TillUiState())
    val state = _s.asStateFlow()

    /**
     * Latched only by the Open-till button — not by `load()` finding an existing session, or
     * reopening this screen to close an already-open till would bounce straight to checkout.
     */
    private val _justOpened = MutableStateFlow(false)
    val justOpened = _justOpened.asStateFlow()
    fun consumeJustOpened() { _justOpened.value = false }

    /**
     * Re-read on every entry. This ViewModel is activity-scoped, so without it a `justClosed`
     * summary would still be on screen next time the till is opened from the counter.
     */
    fun reload() = viewModelScope.launch {
        _s.value = _s.value.copy(loading = true)
        runCatching { till.openSession() }
            .onSuccess { _s.value = TillUiState(loading = false, session = it) }
            .onFailure { _s.value = TillUiState(loading = false, error = it.uiMessage()) }
    }

    fun open(floatText: String) {
        val cents = parseMoneyToCents(floatText) ?: 0
        _s.value = _s.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { till.open(cents) }
                .onSuccess { _s.value = _s.value.copy(busy = false, session = it); _justOpened.value = true }
                .onFailure { _s.value = _s.value.copy(busy = false, error = it.uiMessage()) }
        }
    }

    fun close(countText: String) {
        val id = _s.value.session?.id ?: return
        val cents = parseMoneyToCents(countText) ?: 0
        _s.value = _s.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { till.close(id, cents) }
                .onSuccess { closed ->
                    _s.value = TillUiState(loading = false, session = null, justClosed = closed)
                    // Cashmag parity: the "Clôture de période" slip prints the moment the
                    // till closes. Fire-and-forget — the close itself has committed.
                    launch {
                        val printed = runCatching { zReport.printFor(closed) }.isSuccess
                        _s.value = _s.value.copy(
                            notice = if (printed) "Period-close report printed" else "Till closed — report couldn't reach the printer",
                        )
                    }
                }
                .onFailure { _s.value = _s.value.copy(busy = false, error = it.uiMessage()) }
        }
    }

    /** Petty cash out (Cashmag "Autre"): amount + reason; the server caps it at the drawer. */
    fun cashOut(amountText: String, reason: String) {
        val id = _s.value.session?.id ?: return
        val cents = parseMoneyToCents(amountText) ?: 0
        if (cents <= 0 || reason.isBlank()) {
            _s.value = _s.value.copy(error = "Enter the amount and what the cash was for")
            return
        }
        _s.value = _s.value.copy(busy = true, error = null, notice = null)
        viewModelScope.launch {
            runCatching { till.cashOut(id, cents, reason.trim()) }
                .onSuccess {
                    _s.value = _s.value.copy(
                        busy = false,
                        notice = "Cash out recorded — ${formatMUR(cents)} for “${reason.trim()}”",
                        cashOutDone = _s.value.cashOutDone + 1,
                    )
                }
                .onFailure { _s.value = _s.value.copy(busy = false, error = it.uiMessage()) }
        }
    }
}

@Composable
fun TillScreen(
    onBack: () -> Unit,
    onOpened: () -> Unit,
    // Owner-mandated gate: no back arrow, with a banner saying why the operator is here.
    forced: Boolean = false,
    forcedBanner: String? = null,
    viewModel: TillViewModel = hiltViewModel(),
) {
    val s by viewModel.state.collectAsState()
    var floatText by remember { mutableStateOf("") }
    var countText by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { viewModel.reload() }

    // Opening the till is a step on the way to selling — go straight to the counter.
    val justOpened by viewModel.justOpened.collectAsState()
    LaunchedEffect(justOpened) {
        if (justOpened) { viewModel.consumeJustOpened(); onOpened() }
    }

    Column(Modifier.fillMaxSize().background(ScreenBg).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!forced) {
                Box(Modifier.clickable(onClick = onBack)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = TextSecondary) }
                Spacer(Modifier.width(12.dp))
            }
            Text("Cash till", color = TextPrimary, fontFamily = Condensed, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        }
        if (forced && forcedBanner != null) {
            Spacer(Modifier.height(12.dp))
            Box(
                Modifier.fillMaxWidth().background(Color(0x24C17A00), RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
            ) { Text(forcedBanner, color = Warning, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold) }
        }
        Spacer(Modifier.height(20.dp))

        Box(
            Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp))
                .border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(24.dp),
        ) {
            when {
                s.loading -> Text("Loading…", color = TextSecondary)
                s.justClosed != null -> {
                    val c = s.justClosed!!
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("TILL CLOSED", color = Success, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.5.sp)
                        Field2("Expected in drawer", formatMUR(((c.expectedCash ?: 0.0) * 100).toLong()))
                        Field2("Counted", formatMUR(((c.closingCount ?: 0.0) * 100).toLong()))
                        val varianceCents = ((c.variance ?: 0.0) * 100).toLong()
                        Field2("Variance", formatMUR(varianceCents), if (varianceCents == 0L) Success else Warning)
                        s.notice?.let { Text(it, color = TextSecondary, fontSize = 13.sp) }
                        if (forced) {
                            Spacer(Modifier.height(4.dp))
                            BigButton("Continue — open today's till", enabled = true) { viewModel.reload() }
                        }
                    }
                }
                s.session == null -> {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("Till is closed", color = TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("Enter the opening cash float to start taking payments.", color = TextSecondary, fontSize = 13.sp)
                        OutlinedTextField(floatText, { floatText = it }, label = { Text("Opening float (Rs)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                        s.error?.let { Text(it, color = Danger, fontSize = 13.sp) }
                        BigButton(if (s.busy) "Opening…" else "Open till", enabled = !s.busy) { viewModel.open(floatText) }
                    }
                }
                else -> {
                    val sess = s.session!!
                    var outAmount by remember { mutableStateOf("") }
                    var outReason by remember { mutableStateOf("") }
                    // A recorded cash-out clears its own fields for the next one.
                    LaunchedEffect(s.cashOutDone) { if (s.cashOutDone > 0) { outAmount = ""; outReason = "" } }
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("Till is OPEN", color = Success, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                        Field2("Opening float", formatMUR((sess.openingFloat * 100).toLong()))
                        sess.openedAt?.let { Field2("Opened", it.take(16).replace("T", " ")) }

                        Spacer(Modifier.height(4.dp))
                        Text("PETTY CASH OUT", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                        Text("Take cash from the drawer for a small purchase — it comes off the expected count.", color = TextSecondary, fontSize = 13.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(outAmount, { outAmount = it }, label = { Text("Amount (Rs)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(150.dp))
                            OutlinedTextField(outReason, { outReason = it }, label = { Text("What for") }, singleLine = true, modifier = Modifier.weight(1f))
                        }
                        s.notice?.let { Text(it, color = Success, fontSize = 13.sp) }
                        MinorButton(if (s.busy) "Working…" else "Take cash out", enabled = !s.busy) { viewModel.cashOut(outAmount, outReason) }

                        Spacer(Modifier.height(4.dp))
                        Text("Close the till by counting the cash drawer:", color = TextSecondary, fontSize = 13.sp)
                        OutlinedTextField(countText, { countText = it }, label = { Text("Counted cash (Rs)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                        s.error?.let { Text(it, color = Danger, fontSize = 13.sp) }
                        BigButton(if (s.busy) "Closing…" else "Close till & count", enabled = !s.busy) { viewModel.close(countText) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Field2(label: String, value: String, valueColor: Color = TextPrimary) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, color = TextMuted, fontSize = 13.sp)
        Spacer(Modifier.weight(1f))
        Text(value, color = valueColor, fontFamily = Mono, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun BigButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(52.dp).background(if (enabled) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (enabled) AccentInk else TextMuted, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
}

/** Secondary action — quieter than the accent CTA so "Close till" stays the headline. */
@Composable
private fun MinorButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(44.dp).background(InsetAlt, RoundedCornerShape(11.dp))
            .border(1.dp, Hairline, RoundedCornerShape(11.dp))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (enabled) TextPrimary else TextMuted, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
}
