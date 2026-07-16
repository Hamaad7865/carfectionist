package mu.carfection.pos.feature.till

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.money.rupeesToCents
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
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
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

/** One row of "check your cash register before closing". */
data class MethodRow(
    val method: String,
    val takings: Double,
    val accumulation: Double,
    val remit: Boolean = false, // ticked = swept to the bank on validation
)

data class TillUiState(
    val loading: Boolean = true,
    val session: CashSessionDto? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val justClosed: CashSessionDto? = null,
    val notice: String? = null,          // e.g. "Cash out recorded"
    val cashOutDone: Int = 0,            // bumps so the screen clears its fields
    // ── the Cashmag close ──────────────────────────────────────────────────
    val preClose: List<MethodRow>? = null,   // non-null = the check-your-register screen is up
    val expectedCash: Double = 0.0,
    val serviceNo: Int = 1,
    val closeChoiceOpen: Boolean = false,    // "Cloture de periode": service or day?
    val confirmDay: Boolean = false,         // "day closure is final"
    val z: mu.carfection.pos.core.network.ZReportDto? = null, // the slip, once cut
    val bizName: String = "Carfectionist",   // for the "Sale modes" line
    // ── emailing the Z ──────────────────────────────────────────────────────
    val emailOpen: Boolean = false,
    val emailTo: String = "",
    val emailBusy: Boolean = false,
    val emailResult: String? = null,         // "Sent" or an error
)

@HiltViewModel
class TillViewModel @Inject constructor(
    private val till: TillRepository,
    private val zReport: mu.carfection.pos.core.data.TillZReport,
    private val sendApi: mu.carfection.pos.core.network.DocumentSendApi,
    private val session: mu.carfection.pos.core.data.SessionRepository,
    private val catalog: mu.carfection.pos.core.data.CatalogRepository,
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
        // Closing the till flips the till gate, which re-mounts this screen and re-runs
        // reload(). The Z that was just cut must survive that, or the operator never sees the
        // slip they just closed on — it flashed past and went straight back to "open the till".
        val z = _s.value.z
        val notice = _s.value.notice
        _s.value = _s.value.copy(loading = true)
        runCatching { till.openSession() }
            .onSuccess { _s.value = TillUiState(loading = false, session = it, z = z, notice = notice) }
            .onFailure { _s.value = TillUiState(loading = false, error = it.uiMessage(), z = z, notice = notice) }
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

    // ── Closing, the way the owner's till does it ────────────────────────────
    /** Step 1: "CHECK YOUR CASH REGISTER BEFORE CLOSING". */
    fun beginClose() {
        val id = _s.value.session?.id ?: return
        _s.value = _s.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { till.preClose(id) }
                .onSuccess { (rows, expected, serviceNo) ->
                    _s.value = _s.value.copy(busy = false, preClose = rows, expectedCash = expected, serviceNo = serviceNo)
                }
                .onFailure { _s.value = _s.value.copy(busy = false, error = it.uiMessage()) }
        }
    }

    fun cancelClose() = run { _s.value = _s.value.copy(preClose = null, closeChoiceOpen = false, confirmDay = false) }

    /** Ticking a method banks its whole accumulation when the close is validated. */
    fun toggleRemit(method: String) {
        val rows = _s.value.preClose ?: return
        _s.value = _s.value.copy(preClose = rows.map { if (it.method == method) it.copy(remit = !it.remit) else it })
    }

    /** Step 2: "Cloture de periode" — close this service, or seal the whole day? */
    fun askCloseChoice() = run { _s.value = _s.value.copy(closeChoiceOpen = true) }
    fun askConfirmDay() = run { _s.value = _s.value.copy(confirmDay = true) }
    fun cancelConfirmDay() = run { _s.value = _s.value.copy(confirmDay = false) }

    /**
     * Closes the service: counts the drawer, banks what was ticked, cuts the Z. When
     * [alsoDay] the day is sealed afterwards — no more money until it is reopened.
     */
    fun closeNow(countText: String, note: String, alsoDay: Boolean) {
        val sess = _s.value.session ?: return
        val counted = (parseMoneyToCents(countText) ?: 0) / 100.0
        val remit = _s.value.preClose.orEmpty().filter { it.remit }.map { it.method }
        _s.value = _s.value.copy(busy = true, error = null, closeChoiceOpen = false, confirmDay = false)
        viewModelScope.launch {
            runCatching {
                val z = till.closeService(sess.id, counted, remit, note)
                if (alsoDay && sess.tradingDayId != null) till.closeDay(sess.tradingDayId) else z
            }
                .onSuccess { z ->
                    val biz = runCatching { catalog.receiptBiz().name }.getOrNull() ?: "Carfectionist"
                    _s.value = TillUiState(loading = false, session = null, z = z, preClose = null, bizName = biz)
                    // The close has COMMITTED. Printing is a separate act that can fail
                    // without taking the cash-up with it — and the report screen offers Print.
                    launch {
                        val printed = runCatching { zReport.print(z) }.isSuccess
                        _s.value = _s.value.copy(
                            notice = if (printed) "${z.number} printed" else "${z.number} cut — the printer didn't answer. Tap Print to try again.",
                        )
                    }
                }
                .onFailure { _s.value = _s.value.copy(busy = false, error = it.uiMessage()) }
        }
    }

    /** Reprint the slip from its frozen totals — the same paper, however long after. */
    fun printZ() {
        val z = _s.value.z ?: return
        viewModelScope.launch {
            val ok = runCatching { zReport.print(z) }.isSuccess
            _s.value = _s.value.copy(notice = if (ok) "${z.number} printed" else "The printer didn't answer")
        }
    }

    fun doneWithZ() = run { _s.value = _s.value.copy(z = null, notice = null, emailOpen = false, emailTo = "", emailResult = null) }

    /**
     * Hand the till over. The shift is closed, so sign out and drop to the roster login — the
     * next person picks their own name and PIN instead of inheriting whoever closed. Without
     * this, re-opening the till carried on as the previous operator.
     */
    fun signOutAndHandOver() = viewModelScope.launch {
        _s.value = _s.value.copy(z = null, notice = null, emailOpen = false, emailResult = null)
        runCatching { session.signOut() }
    }

    fun openEmailZ() = run { _s.value = _s.value.copy(emailOpen = true, emailResult = null) }
    fun setEmailTo(t: String) = run { _s.value = _s.value.copy(emailTo = t, emailResult = null) }
    fun closeEmailZ() = run { _s.value = _s.value.copy(emailOpen = false, emailResult = null) }

    /** Email the just-closed Z-report as a PDF, through the web send pipeline. */
    fun emailZ() {
        val z = _s.value.z ?: return
        val to = _s.value.emailTo.trim()
        if (to.isEmpty()) return
        _s.value = _s.value.copy(emailBusy = true, emailResult = null)
        viewModelScope.launch {
            val err = runCatching { sendApi.sendZReport(z.id, to, session.deviceId()) }.getOrElse { it.message }
            _s.value = _s.value.copy(emailBusy = false, emailResult = err ?: "Sent", emailOpen = err != null)
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
                        Text("DISBURSEMENT", color = TextMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
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
                        BigButton(if (s.busy) "Working…" else "Close till & count", enabled = !s.busy) { viewModel.beginClose() }
                    }
                }
            }
        }
    }

    // ── Step 1: check your cash register before closing ──────────────────────
    s.preClose?.let { rows ->
        CheckRegisterDialog(
            rows = rows,
            serviceNo = s.serviceNo,
            expectedCash = s.expectedCash,
            countText = countText,
            onCount = { countText = it },
            onToggle = viewModel::toggleRemit,
            onCancel = viewModel::cancelClose,
            onValidate = viewModel::askCloseChoice,
        )
    }

    // ── Step 2: close this service, or seal the whole day ────────────────────
    if (s.closeChoiceOpen) {
        var note by remember { mutableStateOf("") }
        ClosePeriodDialog(
            serviceNo = s.serviceNo,
            note = note,
            onNote = { note = it },
            busy = s.busy,
            onCloseService = { viewModel.closeNow(countText, note, alsoDay = false) },
            onCloseDay = viewModel::askConfirmDay,
            onBack = viewModel::cancelClose,
        )
        if (s.confirmDay) {
            ConfirmDayDialog(
                onCancel = viewModel::cancelConfirmDay,
                onOk = { viewModel.closeNow(countText, note, alsoDay = true) },
            )
        }
    }

    // ── The slip ─────────────────────────────────────────────────────────────
    s.z?.let { z ->
        ZReportDialog(
            z = z, bizName = s.bizName, notice = s.notice,
            emailOpen = s.emailOpen, emailTo = s.emailTo, emailBusy = s.emailBusy, emailResult = s.emailResult,
            onPrint = viewModel::printZ,
            onOpenEmail = viewModel::openEmailZ, onEmailTo = viewModel::setEmailTo, onSendEmail = viewModel::emailZ, onCancelEmail = viewModel::closeEmailZ,
            onHandOver = viewModel::signOutAndHandOver,
            onDone = { viewModel.doneWithZ(); viewModel.reload() },
        )
    }
}

/** "CHECK YOUR CASH REGISTER BEFORE CLOSING" — what each method took, what has piled up,
 *  and what gets banked when this is validated. */
@Composable
private fun CheckRegisterDialog(
    rows: List<MethodRow>,
    serviceNo: Int,
    expectedCash: Double,
    countText: String,
    onCount: (String) -> Unit,
    onToggle: (String) -> Unit,
    onCancel: () -> Unit,
    onValidate: () -> Unit,
) {
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.width(720.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("CHECK YOUR CASH REGISTER BEFORE CLOSING", color = TextPrimary, fontFamily = Condensed, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text(
                "Ticked payments are remitted to the bank when you validate. Anything left unticked keeps accumulating in the till.",
                color = TextSecondary, fontSize = 12.5.sp,
            )
            Spacer(Modifier.height(4.dp))

            rows.forEach { r ->
                Row(
                    Modifier.fillMaxWidth().background(InsetAlt, RoundedCornerShape(12.dp)).clickable { onToggle(r.method) }.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(r.method.replace('_', ' ').uppercase(), color = TextPrimary, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
                        Text(formatMUR(rupeesToCents(r.takings)), color = TextSecondary, fontFamily = Mono, fontSize = 14.sp)
                    }
                    Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(end = 14.dp)) {
                        Text("CASH FLOAT ACCUMULATION", color = TextMuted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                        Text(formatMUR(rupeesToCents(r.accumulation)), color = TextPrimary, fontFamily = Mono, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                    // The tick: banked on validation.
                    Box(
                        Modifier.width(26.dp).height(26.dp)
                            .background(if (r.remit) Success else Color.Transparent, RoundedCornerShape(6.dp))
                            .border(1.5.dp, if (r.remit) Success else Hairline, RoundedCornerShape(6.dp)),
                        contentAlignment = Alignment.Center,
                    ) { if (r.remit) Text("✓", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                }
            }

            Spacer(Modifier.height(4.dp))
            Field2("Expected in the drawer", formatMUR(rupeesToCents(expectedCash)))
            OutlinedTextField(
                countText, onCount, label = { Text("Counted cash (Rs)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onCancel),
                    contentAlignment = Alignment.Center,
                ) { Text("Back", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Box(
                    Modifier.weight(1.4f).height(50.dp).background(Accent, RoundedCornerShape(13.dp)).clickable(onClick = onValidate),
                    contentAlignment = Alignment.Center,
                ) { Text("Validate", color = AccentInk, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

/** "Cloture de periode" — close THIS service, or seal the whole day. */
@Composable
private fun ClosePeriodDialog(
    serviceNo: Int,
    note: String,
    onNote: (String) -> Unit,
    busy: Boolean,
    onCloseService: () -> Unit,
    onCloseDay: () -> Unit,
    onBack: () -> Unit,
) {
    Dialog(onDismissRequest = onBack) {
        Column(
            Modifier.width(460.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Close the till", color = TextPrimary, fontFamily = Condensed, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(note, onNote, label = { Text("Note for this service (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            BigButton(if (busy) "Closing…" else "Close service $serviceNo", enabled = !busy, onClick = onCloseService)

            Box(
                Modifier.fillMaxWidth().height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(enabled = !busy, onClick = onCloseDay),
                contentAlignment = Alignment.Center,
            ) { Text("Close the day", color = Warning, fontSize = 14.5.sp, fontWeight = FontWeight.Bold) }

            Box(Modifier.fillMaxWidth().height(40.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                Text("Back", color = TextSecondary, fontSize = 14.sp)
            }
        }
    }
}

/** The day is final. Say so plainly before it is. */
@Composable
private fun ConfirmDayDialog(onCancel: () -> Unit, onOk: () -> Unit) {
    Dialog(onDismissRequest = onCancel) {
        Column(
            Modifier.width(420.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Close the day", color = TextPrimary, fontFamily = Condensed, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            Text(
                "Day closure is final: no more sales, payments or refunds today. Reopening it needs your PIN.",
                color = Danger, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onCancel),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Box(
                    Modifier.weight(1f).height(50.dp).background(Danger, RoundedCornerShape(13.dp)).clickable(onClick = onOk),
                    contentAlignment = Alignment.Center,
                ) { Text("Close the day", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

/** The slip, straight from the Z's frozen totals. */
@Composable
private fun ZReportDialog(
    z: mu.carfection.pos.core.network.ZReportDto,
    bizName: String,
    notice: String?,
    emailOpen: Boolean,
    emailTo: String,
    emailBusy: Boolean,
    emailResult: String?,
    onPrint: () -> Unit,
    onOpenEmail: () -> Unit,
    onEmailTo: (String) -> Unit,
    onSendEmail: () -> Unit,
    onCancelEmail: () -> Unit,
    onHandOver: () -> Unit,
    onDone: () -> Unit,
) {
    // Read the frozen totals defensively — every figure was fixed at close, so nothing is
    // recomputed. Mirrors ZSlip.kt so the screen, the paper and the emailed PDF agree.
    fun JsonObject.num(k: String) = this[k]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
    fun JsonObject.int(k: String) = num(k).toInt()
    fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content?.takeIf { it != "null" }
    fun JsonObject.arr(k: String) = (this[k] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonObject } ?: emptyList()
    fun mny(r: Double) = formatMUR(rupeesToCents(r))

    val t = z.totals
    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.width(600.dp).heightIn(max = 720.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)),
        ) {
            // header — the owner's Cashmag "Clôture de période" masthead, centred.
            Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(bizName.uppercase(), color = TextPrimary, fontFamily = Condensed, fontSize = 21.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                Text("Period close", color = TextSecondary, fontFamily = Barlow, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                t.str("device")?.let { Text("Device $it", color = TextMuted, fontFamily = Barlow, fontSize = 12.sp) }
                Text("${z.number} · ${z.closedAt?.take(16)?.replace('T', ' ') ?: ""}", color = TextMuted, fontFamily = Mono, fontSize = 12.sp)
            }
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))

            // the full breakdown — scrollable, laid out as Cashmag's service cards + the period
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val services = t.arr("services")
                // The aggregate (Period + detail) figures: a service close that carries the whole
                // day has a `period` block; a day close is already the aggregate at the top level.
                val periodT = (t["period"] as? JsonObject) ?: t
                // A day (or a service close carrying the day) shows every service as its own card;
                // a lone single-service close is one card.
                val serviceCards = if (services.isNotEmpty()) services else listOf(t)
                serviceCards.forEach { s -> ServiceCard(s, z.scope) { mny(it) } }

                // The Period card aggregates the services; a lone single-service close already is it.
                if (services.isNotEmpty()) PeriodCard(periodT) { mny(it) }

                // ── The period's detail, from the aggregate ──────────────────────────
                DetailCard("Categories", periodT.arr("categories").isNotEmpty()) {
                    periodT.arr("categories").forEach { c -> ZRow("${c.int("lines")} ${c.str("name")?.uppercase()}", mny(c.num("incl"))) }
                }
                DetailCard("User as cashier", periodT.arr("cashiers").isNotEmpty()) {
                    periodT.arr("cashiers").forEach { c ->
                        ZRow(c.str("name") ?: "—", mny(c.num("total")), strong = true)
                        c.arr("methods").forEach { m -> ZRow(m.str("method")?.replace('_', ' ')?.uppercase() ?: "?", mny(m.num("amount")), indent = true) }
                    }
                }
                DetailCard("Sales person", periodT.arr("cashiers").isNotEmpty()) {
                    periodT.arr("cashiers").forEach { c -> ZRow(c.str("name") ?: "—", mny(c.num("total"))) }
                }
                DetailCard("VAT", periodT.arr("vat").isNotEmpty()) {
                    periodT.arr("vat").forEach { v ->
                        ZRow(enVatLabel(v.str("label")), mny(v.num("vat")), strong = true)
                        ZRow("excl. ${mny(v.num("excl"))}", "incl. ${mny(v.num("incl"))}", TextMuted, indent = true)
                    }
                }
                // Petty cash paid OUT of the drawer — the drawer maths always knew; now the screen does.
                (periodT["movements"] as? JsonObject)?.takeIf { it.int("count") > 0 }?.let { mvz ->
                    DetailCard("Paid out", true) {
                        ZRow("${mvz.int("count")} movement${if (mvz.int("count") == 1) "" else "s"}", mny(mvz.num("total")), strong = true)
                    }
                }
                DetailCard("Sale modes", true) {
                    ZRow("SALES [${bizName.uppercase()}]", mny(periodT.num("total_incl")), strong = true)
                    periodT.arr("vat").forEach { v -> ZRow(enVatLabel(v.str("label")), mny(v.num("vat")), TextMuted, indent = true) }
                }
            }

            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                notice?.let { Text(it, color = TextSecondary, fontSize = 12.5.sp) }
                if (emailOpen) {
                    FilledInput(value = emailTo, onValueChange = onEmailTo, placeholder = "Email address", modifier = Modifier.fillMaxWidth(), bg = Inset)
                    emailResult?.let { Text(it, color = if (it == "Sent") Success else Danger, fontSize = 12.5.sp) }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onCancelEmail), contentAlignment = Alignment.Center) {
                            Text("Cancel", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                        val ok = emailTo.isNotBlank() && !emailBusy
                        Box(Modifier.weight(1.4f).height(50.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = ok, onClick = onSendEmail), contentAlignment = Alignment.Center) {
                            Text(if (emailBusy) "Sending…" else "Send PDF", color = if (ok) AccentInk else TextMuted, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                } else {
                    emailResult?.let { Text(it, color = if (it == "Sent") Success else Danger, fontSize = 12.5.sp) }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onPrint), contentAlignment = Alignment.Center) {
                            Text("Print", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                        Box(Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable(onClick = onOpenEmail), contentAlignment = Alignment.Center) {
                            Text("Email", color = TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    // The till is closed — the next person should sign in as themselves, so hand
                    // over is the headline. "Stay signed in" is the escape hatch when the same
                    // operator is carrying straight on.
                    Box(Modifier.fillMaxWidth().height(50.dp).background(Accent, RoundedCornerShape(13.dp)).clickable(onClick = onHandOver), contentAlignment = Alignment.Center) {
                        Text("Sign out — hand over the till", color = AccentInk, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    }
                    Box(Modifier.fillMaxWidth().height(40.dp).clickable(onClick = onDone), contentAlignment = Alignment.Center) {
                        Text("Stay signed in", color = TextSecondary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

// ── Z-report JSON helpers (top-level so the card composables can read the frozen
//    totals; ZReportDialog keeps its own locals for its inline lambdas) ──────────
/** VAT rate labels are frozen in the owner's Cashmag French — show them in English. */
private fun enVatLabel(l: String?): String = (l ?: "")
    .replace("TAUX NORMAL", "STANDARD").replace("EXONERE", "EXEMPT").replace("EXONÉRÉ", "EXEMPT")
    .replaceFirst(Regex("^TAUX "), "RATE ")
private fun JsonObject.zn(k: String) = this[k]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
private fun JsonObject.zi(k: String) = zn(k).toInt()
private fun JsonObject.zs(k: String) = this[k]?.jsonPrimitive?.content?.takeIf { it != "null" }
private fun JsonObject.za(k: String) = (this[k] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonObject } ?: emptyList()

@Composable
private fun ZRow(label: String, value: String, valueColor: Color = TextPrimary, indent: Boolean = false, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(start = if (indent) 14.dp else 0.dp)) {
        Text(label, color = if (indent) TextSecondary else TextPrimary, fontFamily = Barlow, fontSize = 13.sp, fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal)
        Spacer(Modifier.weight(1f))
        Text(value, color = valueColor, fontFamily = Mono, fontSize = 13.sp, fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium)
    }
}

/** The blue "Service N" pill that heads each card, like the owner's Cashmag screen. */
@Composable
private fun ColumnScope.ZPill(text: String) {
    Box(Modifier.align(Alignment.CenterHorizontally).background(Accent, RoundedCornerShape(16.dp)).padding(horizontal = 20.dp, vertical = 6.dp)) {
        Text(text, color = AccentInk, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 0.5.sp)
    }
}

/** A rounded card the Z sections sit in (matches the second screenshot). */
@Composable
private fun ZCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(14.dp)).border(1.dp, Hairline, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
        content = content,
    )
}

/** The "Means of payment" block — cash split + each other method, from a service or the day. */
@Composable
private fun MeansOfPayment(o: JsonObject, mny: (Double) -> String) {
    Spacer(Modifier.height(4.dp))
    Text("Means of payment", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp)
    o.za("methods").forEach { m ->
        val name = m.zs("method")?.replace('_', ' ')?.uppercase() ?: "?"
        if (name == "CASH") {
            ZRow("CASH", mny(m.zn("gross")), indent = true)
            ZRow("CHANGE", mny(m.zn("change")), indent = true)
            ZRow("CASHBACK", mny(0.0), indent = true)
            ZRow("CASH NET", mny(m.zn("net")), indent = true, strong = true)
        } else {
            ZRow("${m.zi("count")} $name", mny(m.zn("net")), indent = true)
        }
    }
    (o["customer_credit"] as? JsonObject)?.let { c ->
        if (c.zn("amount") != 0.0) ZRow("${c.zi("count")} CUSTOMER CREDIT", mny(c.zn("amount")), indent = true)
    }
}

/** One service's card: the Service pill, its floats + totals, and its means of payment. */
@Composable
private fun ServiceCard(s: JsonObject, scope: String, mny: (Double) -> String) = ZCard {
    ZPill("Service ${s.zi("service_no")}")
    Spacer(Modifier.height(4.dp))
    ZRow("Initial cash float", mny(s.zn("float_initial")))
    ZRow("Final cash float", mny(s.zn("float_final")))
    Spacer(Modifier.height(2.dp))
    ZRow("Total service incl. tax", mny(s.zn("total_incl")), strong = true)
    ZRow("${s.zi("tickets")} tickets", "Avg. ${mny(s.zn("avg_basket"))}", TextMuted)
    ZRow("Delete items", "0", TextMuted)
    ZRow("Deleted bills", s.zi("voided_bills").toString(), TextMuted)
    ZRow("Canceled orders", "0", TextMuted)
    if (scope != "day" && s.zn("variance") != 0.0) ZRow("Variance", mny(s.zn("variance")), Warning)
    MeansOfPayment(s, mny)
}

/** For a whole-day close, the aggregated "Period" card after the services. */
@Composable
private fun PeriodCard(t: JsonObject, mny: (Double) -> String) = ZCard {
    ZPill("Period")
    Spacer(Modifier.height(4.dp))
    ZRow("Total incl. tax", mny(t.zn("total_incl")), strong = true)
    ZRow("${t.zi("tickets")} tickets", "Avg. ${mny(t.zn("avg_basket"))}", TextMuted)
    if (t.zi("reversals") > 0) ZRow("${t.zi("reversals")} reversals", "", TextMuted)
    MeansOfPayment(t, mny)
}

/** A titled detail card (Categories, User as cashier, Sales person, VAT, Sale modes). */
@Composable
private fun DetailCard(title: String, show: Boolean, content: @Composable ColumnScope.() -> Unit) {
    if (!show) return
    ZCard {
        Text(title.uppercase(), color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.2.sp)
        Spacer(Modifier.height(2.dp))
        content()
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
