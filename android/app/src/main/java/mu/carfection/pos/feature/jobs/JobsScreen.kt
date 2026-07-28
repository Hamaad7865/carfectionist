package mu.carfection.pos.feature.jobs

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlinx.coroutines.launch
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import mu.carfection.pos.feature.counter.ReceiptPaper
import mu.carfection.pos.core.network.JobPhotoDto
import mu.carfection.pos.core.jobs.JobClock
import mu.carfection.pos.ui.FlowState
import mu.carfection.pos.ui.FlowStepUi
import mu.carfection.pos.ui.FlowStrip
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.LocalPhotoCapture
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.money.formatMUR
import mu.carfection.pos.core.money.grossCents
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.theme.Inset
import kotlinx.coroutines.delay
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.InsetAlt
import mu.carfection.pos.ui.theme.Mono
import mu.carfection.pos.ui.theme.Plate
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private val CardTile = Color(0xFFF1F4F7)
private val MU = ZoneOffset.ofHours(4)
private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
private val DAY = DateTimeFormatter.ofPattern("EEE d MMM")
private fun epoch(iso: String?): Long? = iso?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }
private fun clock(iso: String?): String = iso?.let { runCatching { OffsetDateTime.parse(it).atZoneSameInstant(MU).format(HHMM) }.getOrNull() } ?: "—"

/**
 * A booking has to say WHICH DAY. "14:30" alone is the same card whether the car is due
 * in twenty minutes or a week on Thursday — the day is the whole point of a schedule.
 * Today's jobs stay short ("14:30"); anything else earns its date.
 */
private fun scheduleLabel(iso: String?): String {
    val at = iso?.let { runCatching { OffsetDateTime.parse(it).atZoneSameInstant(MU) }.getOrNull() } ?: return "—"
    val today = OffsetDateTime.now(MU).toLocalDate()
    val hhmm = at.format(HHMM)
    return when (at.toLocalDate()) {
        today -> hhmm
        today.plusDays(1) -> "Tomorrow $hhmm"
        today.minusDays(1) -> "Yesterday $hhmm"
        else -> "${at.format(DAY)} $hhmm"
    }
}

/** How long past its estimate, once a job has overrun it. */
private fun overBy(ms: Long): String = "${elapsedShort(ms)} over"

/** An epoch instant as the shop's wall clock. */
private fun hhmm(ms: Long): String =
    java.time.Instant.ofEpochMilli(ms).atOffset(MU).format(HHMM)
private fun firstName(display: String?): String = (display ?: "").replace(Regex("\\s*\\(.*\\)$"), "").trim().split(" ").firstOrNull().orEmpty()
private fun elapsedShort(ms: Long): String { val m = ms / 60000; return if (m < 60) "${m}m" else "${m / 60}h ${m % 60}m" }
private fun elapsedLong(ms: Long): String { val s = (ms / 1000).coerceAtLeast(0); return "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60) }
private fun vehLabel(j: JobBoardDto): String = listOfNotNull(j.vehicles?.make, j.vehicles?.model).joinToString(" ").ifBlank { "Vehicle" }

private fun Modifier.card(radius: Int = 16) = this.background(CardBg, RoundedCornerShape(radius.dp)).border(1.dp, Hairline, RoundedCornerShape(radius.dp))

@Composable
fun JobsScreen(onGoIntake: () -> Unit, onGoCheckout: () -> Unit, viewModel: JobsViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() } // refresh the board on entry
    // System back closes the work-order drawer before it pops the tab history.
    BackHandler(enabled = s.activeJobId != null) { viewModel.close() }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("JOBS BOARD", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
                val open = s.jobs.count { it.status != "delivered" }
                Text("$open open · tap a card to open the work order", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                Spacer(Modifier.weight(1f))
                OutlineBtn("+ New intake", h = 44) { onGoIntake() }
            }
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                JobCol.entries.forEach { col -> JobColumn(s, viewModel, col, Modifier.weight(1f)) }
            }
        }
        viewModel.active(s)?.let { JobDetailSheet(s, it, viewModel, onGoCheckout) }
    }
    if (s.certOpen) CertIssueDialog(s, viewModel)
    if (s.invoiceOpen) InvoiceDialog(s, viewModel)
    if (s.viewInvoice != null || s.viewInvoiceBusy) ViewInvoiceDialog(s, viewModel)
    if (s.addChecklistOpen) AddChecklistDialog(viewModel)
    if (s.reschedDateOpen) RescheduleDatePicker(viewModel)
    if (s.reschedTimeOpen) RescheduleTimePicker(viewModel)
    s.toast?.let { LaunchedEffect(it) { delay(1800); viewModel.clearToast() } }
    s.toast?.let { Toast(it) }
    // Failures (mark ready / checkout / timer) were captured in state but never
    // shown — the operator saw silent no-ops on money-relevant taps.
    s.error?.let { LaunchedEffect(it) { delay(2600); viewModel.clearToast() } }
    s.error?.let { Toast(it) }
}

@Composable
private fun InvoiceDialog(s: JobsState, vm: JobsViewModel) {
    val job = vm.active(s)
    Dialog(onDismissRequest = vm::closeInvoice) {
        Column(
            Modifier.width(480.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("CREATE INVOICE", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.2.sp, color = TextPrimary)
            Text(
                "${job?.customers?.name ?: "—"} · ${job?.let { vehLabel(it) } ?: "Vehicle"}${job?.vehicles?.plate?.let { " · $it" } ?: ""}",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary,
            )
            SectionLabel("SERVICE")
            FilledInput(value = s.invoiceService, onValueChange = vm::setInvoiceService, placeholder = "What was done", modifier = Modifier.fillMaxWidth(), bg = Inset)
            SectionLabel("AMOUNT (Rs, excl. VAT)")
            FilledInput(value = s.invoiceAmountText, onValueChange = vm::setInvoiceAmount, placeholder = "0.00", modifier = Modifier.fillMaxWidth(), bg = Inset)
            Text("VAT 15% is added automatically when the invoice is issued.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
            Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(52.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(13.dp)).clickable { vm.closeInvoice() }, contentAlignment = Alignment.Center) {
                    Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextSecondary)
                }
                val ok = s.invoiceService.isNotBlank() && s.invoiceAmountText.isNotBlank() && !s.invoiceBusy
                Box(Modifier.weight(1.5f).height(52.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = ok) { vm.issueInvoice() }, contentAlignment = Alignment.Center) {
                    Text(if (s.invoiceBusy) "Creating…" else "Create invoice", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (ok) AccentInk else TextMuted)
                }
            }
        }
    }
}

/**
 * The job's bill, on screen. A delivered job's invoice is PAID, so it is not in checkout's
 * TO COLLECT — sending the operator there showed them nothing. This shows the slip exactly as
 * it prints, and lets them print it again or send it to the customer.
 */
@Composable
private fun ViewInvoiceDialog(s: JobsState, vm: JobsViewModel) {
    var email by remember(s.viewCustEmail) { mutableStateOf(s.viewCustEmail ?: "") }
    var phone by remember(s.viewCustPhone) { mutableStateOf(s.viewCustPhone ?: "") }
    Dialog(onDismissRequest = vm::closeInvoiceView, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Row(
            Modifier.width(880.dp).background(CardBg, RoundedCornerShape(22.dp)).border(1.dp, Hairline, RoundedCornerShape(22.dp)).padding(24.dp),
            horizontalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // ── the slip, as it prints ──────────────────────────────────────────
            Box(Modifier.width(300.dp).heightIn(max = 620.dp).verticalScroll(rememberScrollState())) {
                s.viewInvoice?.let { ReceiptPaper(it, Modifier.fillMaxWidth()) }
            }

            // ── read it, print it, send it ─────────────────────────────────────
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("INVOICE", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = 1.2.sp, color = TextPrimary)
                        Text(
                            if (s.viewInvoiceBusy) "Loading…" else "${s.viewInvoice?.invoiceNo ?: "—"} · ${s.viewInvoice?.customer ?: ""}",
                            fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary,
                        )
                    }
                    Box(Modifier.size(40.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = vm::closeInvoiceView), contentAlignment = Alignment.Center) {
                        Text("✕", fontFamily = Barlow, fontSize = 15.sp, color = TextSecondary)
                    }
                }

                s.viewInvoice?.let { d ->
                    Text(formatMUR(d.totalCents), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 38.sp, color = TextPrimary)
                    // A deposit is not settlement: with anything still owed, the headline says
                    // so — "Paid in cash" over an open balance misleads the operator.
                    Text(
                        when {
                            d.balanceDueCents > 0 && d.payLabel != null -> "${formatMUR(d.balanceDueCents)} still owed"
                            d.balanceDueCents > 0 -> "On account — ${formatMUR(d.balanceDueCents)} owed"
                            else -> d.payLabel?.let { "Paid in ${it.lowercase()}" } ?: "Settled"
                        },
                        fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.sp,
                        color = if (d.balanceDueCents > 0) Warning else Success,
                    )
                }

                Box(Modifier.fillMaxWidth().height(48.dp).background(Accent, RoundedCornerShape(12.dp)).clickable(onClick = vm::printInvoice), contentAlignment = Alignment.Center) {
                    Text("Print", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, color = AccentInk)
                }

                SectionLabel("EMAIL")
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledInput(value = email, onValueChange = { email = it }, placeholder = "customer@email.com", modifier = Modifier.weight(1f), bg = Inset)
                    Box(
                        Modifier.width(92.dp).height(48.dp).background(if (s.sendBusy || email.isBlank()) InsetAlt else Accent, RoundedCornerShape(12.dp))
                            .clickable(enabled = !s.sendBusy && email.isNotBlank()) { vm.sendInvoice("email", email) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (s.sendBusy) "…" else "Send", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = if (s.sendBusy || email.isBlank()) TextMuted else AccentInk)
                    }
                }

                SectionLabel("WHATSAPP")
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledInput(value = phone, onValueChange = { phone = it }, placeholder = "+230 5XXX XXXX", modifier = Modifier.weight(1f), bg = Inset)
                    Box(
                        Modifier.width(92.dp).height(48.dp).background(if (s.sendBusy || phone.isBlank()) InsetAlt else Color(0xFF25D366), RoundedCornerShape(12.dp))
                            .clickable(enabled = !s.sendBusy && phone.isNotBlank()) { vm.sendInvoice("whatsapp", phone) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (s.sendBusy) "…" else "Send", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = if (s.sendBusy || phone.isBlank()) TextMuted else Color(0xFF06231A))
                    }
                }

                s.sendDone?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Success) }
                s.sendError?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = Danger) }
            }
        }
    }
}

@Composable
private fun CertIssueDialog(s: JobsState, vm: JobsViewModel) {
    val job = vm.active(s)
    val products = vm.certProducts(s)
    Dialog(onDismissRequest = vm::closeCertIssue) {
        Column(
            Modifier.width(520.dp).background(CardBg, RoundedCornerShape(20.dp)).border(1.dp, Hairline, RoundedCornerShape(20.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Text("ISSUE WARRANTY CERTIFICATE", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.2.sp, color = TextPrimary)
            Text(
                "${job?.customers?.name ?: "—"} · ${job?.let { vehLabel(it) } ?: "Vehicle"}${job?.vehicles?.plate?.let { " · $it" } ?: ""}",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary,
            )
            SectionLabel("PRODUCT APPLIED")
            Column(Modifier.heightIn(max = 210.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                products.forEach { p ->
                    val on = p.id == s.certProductId
                    Row(
                        Modifier.fillMaxWidth().background(if (on) AccentSoft else Color(0xFFF4F7F9), RoundedCornerShape(11.dp))
                            .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(11.dp))
                            .clickable { vm.pickCertProduct(p.id) }.padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(p.name, Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(formatMUR(if (s.pricesInclVat) grossCents(p.sellingPriceCents, p.vatRatePct) else p.sellingPriceCents), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary)
                    }
                }
            }
            SectionLabel("WARRANTY TERM")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                CERT_TERMS.forEach { (months, label) ->
                    val on = months == s.certTermMonths
                    Box(
                        Modifier.weight(1f).height(42.dp).background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(11.dp))
                            .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(11.dp))
                            .clickable { vm.pickCertTerm(months) },
                        contentAlignment = Alignment.Center,
                    ) { Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (on) Accent else TextSecondary) }
                }
            }
            Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(52.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(13.dp)).clickable { vm.closeCertIssue() }, contentAlignment = Alignment.Center) {
                    Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextSecondary)
                }
                val ok = s.certProductId != null && !s.certBusy
                Box(Modifier.weight(1.5f).height(52.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(13.dp)).clickable(enabled = ok) { vm.issueCert() }, contentAlignment = Alignment.Center) {
                    Text(if (s.certBusy) "Issuing…" else "Issue certificate", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (ok) AccentInk else TextMuted)
                }
            }
        }
    }
}

@Composable
private fun JobColumn(s: JobsState, vm: JobsViewModel, col: JobCol, modifier: Modifier) {
    val cards = vm.jobsFor(s, col)
    Column(modifier.fillMaxHeight().card(15)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(8.dp).background(Color(col.dot), CircleShape))
            Text(col.label.uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.2.sp, color = TextPrimary)
            Spacer(Modifier.weight(1f))
            Box(Modifier.height(22.dp).widthIn(min = 22.dp).background(InsetAlt, RoundedCornerShape(11.dp)).padding(horizontal = 7.dp), contentAlignment = Alignment.Center) {
                Text(cards.size.toString(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, color = TextSecondary)
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 8.dp, end = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            cards.forEach { j ->
                // Delivered cards can be swiped away the moment the car leaves; the rest are
                // live work and must stay put.
                JobCard(
                    j, col, Color(col.dot),
                    onDismiss = if (col == JobCol.DELIVERED) ({ vm.dismissDelivered(j.id) }) else null,
                ) { vm.open(j.id) }
            }
            if (col == JobCol.DELIVERED && cards.isNotEmpty()) {
                Text(
                    "Swipe a card away to clear it — they leave on their own after 48h.",
                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 15.sp,
                    color = TextMuted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun JobCard(j: JobBoardDto, col: JobCol, edge: Color, onDismiss: (() -> Unit)? = null, onClick: () -> Unit) {
    val now = System.currentTimeMillis()
    val (right, rightC) = when (col) {
        // The day, not just the hour — a job booked for Thursday must not read as "now".
        JobCol.SCHEDULED -> scheduleLabel(j.scheduledAt) to TextMuted
        JobCol.IN_PROGRESS -> {
            val t = JobClock.elapsedMs(j, now)?.let { elapsedShort(it) } ?: "0m"
            val eta = JobClock.estimatedFinishMs(j, now)
            when {
                j.pausedAt != null -> "❚❚ $t" to TextMuted
                // Past its estimate: say by how much, in the colour of a problem.
                eta != null && now > eta -> overBy(now - eta) to Danger
                else -> t to Warning
            }
        }
        JobCol.READY -> clock(j.readyAt) to Success
        JobCol.DELIVERED -> "Done" to TextMuted
    }
    // When the car should be done — never invented: a job nobody estimated says nothing.
    val etaLabel: String? = JobClock.estimatedFinishMs(j, now)
        ?.takeIf { col == JobCol.SCHEDULED || col == JobCol.IN_PROGRESS }
        ?.let { "est. ${hhmm(it)}" }
    // Swipe-to-clear (delivered only): the card follows the finger, fades as it goes, and
    // is gone past 40% of its width; anything short of that springs back.
    val offsetX = remember(j.id) { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val swipe = if (onDismiss == null) Modifier else Modifier.pointerInput(j.id) {
        val gone = size.width * 0.4f
        detectHorizontalDragGestures(
            onHorizontalDrag = { change, delta -> change.consume(); scope.launch { offsetX.snapTo(offsetX.value + delta) } },
            onDragCancel = { scope.launch { offsetX.animateTo(0f, tween(160)) } },
            onDragEnd = {
                scope.launch {
                    if (abs(offsetX.value) > gone) {
                        offsetX.animateTo(sign(offsetX.value) * size.width, tween(150))
                        onDismiss()
                    } else offsetX.animateTo(0f, tween(160))
                }
            },
        )
    }
    Box(
        Modifier.offset { IntOffset(offsetX.value.roundToInt(), 0) }
            .graphicsLayer { alpha = 1f - (abs(offsetX.value) / (size.width.takeIf { it > 0 } ?: 1).toFloat()).coerceIn(0f, 0.85f) }
            .then(swipe)
            .clip(RoundedCornerShape(12.dp)).background(CardTile).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = onClick),
    ) {
        // IntrinsicSize.Min gives the row a resolved height — without it the edge
        // stripe's fillMaxHeight() collapses to zero and the stripe never shows.
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(edge))
            Column(Modifier.padding(start = 12.dp, top = 11.dp, end = 11.dp, bottom = 11.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    PlateBadge(j.vehicles?.plate ?: "—")
                    Spacer(Modifier.weight(1f))
                    Text(right, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = rightC)
                }
                Text(vehLabel(j), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(j.notes?.ifBlank { null } ?: "—", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, lineHeight = 15.sp, color = TextMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Avatar(firstName(j.technician?.displayName).ifBlank { "?" }.take(1), 22)
                    Text(firstName(j.technician?.displayName).ifBlank { "Unassigned" }, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextSecondary)
                    if (etaLabel != null) {
                        Spacer(Modifier.weight(1f))
                        Text(etaLabel, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun JobDetailSheet(s: JobsState, j: JobBoardDto, vm: JobsViewModel, onGoCheckout: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color(0x66101A24)).clickable(onClick = vm::close))
        Column(Modifier.align(Alignment.CenterEnd).width(560.dp).fillMaxHeight().background(CardBg).border(1.dp, Hairline)) {
            // header
            val (chip, chipBg, chipC) = statusChip(j.status)
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Text("JOB-${j.id.take(4).uppercase()}", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 1.2.sp, color = TextPrimary)
                Box(Modifier.height(25.dp).background(chipBg, RoundedCornerShape(13.dp)).padding(horizontal = 11.dp), contentAlignment = Alignment.Center) {
                    Text(chip, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp, color = chipC)
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(42.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(12.dp)).clickable(onClick = vm::close), contentAlignment = Alignment.Center) { Text("✕", fontFamily = Barlow, fontSize = 16.sp, color = TextSecondary) }
            }
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            // body
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(j.customers?.name ?: "—", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        j.customers?.phone?.let { Text(it, fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted) }
                    }
                    PlateBadge(j.vehicles?.plate ?: "—", big = true)
                    Text(listOfNotNull(vehLabel(j), j.vehicles?.colour).joinToString(" · "), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextSecondary)
                }
                // What the customer ordered — the services off the job's quote, so the work order
                // is detailed here instead of making the tech open the quote to find out.
                if (s.detailLines.isNotEmpty()) {
                    Column(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp)).padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("WORK ORDERED", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.2.sp, color = TextMuted)
                        s.detailLines.forEach { l ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                                Text("${l.qty.toInt()}×", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextMuted)
                                Text(l.title, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = TextPrimary, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
                // When the car is booked in — the scheduled time, shown on the work order.
                // A still-scheduled job can be re-timed here; once it's running (auto-started
                // at its slot, or started by hand) the start moment is history, so the tap goes.
                if (j.scheduledAt != null || j.status == "scheduled") {
                    Row(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp)).padding(horizontal = 13.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Scheduled", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextMuted)
                        Spacer(Modifier.weight(1f))
                        Text(j.scheduledAt?.let { scheduleLabel(it) } ?: "Not set", fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextPrimary)
                        if (j.status == "scheduled") {
                            Text(
                                if (j.scheduledAt == null) "Set time" else "Reschedule",
                                fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = Accent,
                                modifier = Modifier.clickable(enabled = !s.busy) { vm.openReschedule() }.padding(start = 12.dp),
                            )
                        }
                    }
                }
                if (j.damageMarkers.isNotEmpty()) {
                    val n = j.damageMarkers.size
                    Text("⚠ $n pre-existing damage mark${if (n > 1) "s" else ""} recorded at intake", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = Warning)
                }
                // The car's journey — same five steps as the back office.
                FlowStrip(jobFlow(j))
                // technicians — the LEAD (tap) plus everyone else on the car (long-press)
                SectionLabel("TECHNICIANS")
                Text(
                    "Tap to set the lead · long-press to add or remove a second pair of hands",
                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted,
                )
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    if (s.technicians.isEmpty()) Text("No active technicians — add one in Settings", fontFamily = Barlow, fontSize = 12.5.sp, color = TextMuted)
                    s.technicians.forEach { u ->
                        val lead = u.id == j.technicianId
                        val onCrew = u.id in s.crew
                        val on = lead || onCrew
                        Row(
                            Modifier.height(40.dp)
                                .background(if (on) AccentSoft else CardTile, RoundedCornerShape(20.dp))
                                .border(if (lead) 2.dp else if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(20.dp))
                                .combinedClickable(
                                    onClick = { vm.assignTech(u.id) },
                                    onLongClick = { vm.toggleCrew(j.id, u.id) },
                                )
                                .padding(start = 5.dp, end = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            Avatar(firstName(u.displayName).take(1), 29)
                            Text(firstName(u.displayName), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextPrimary)
                            // The lead is named on the job and every report; the rest are crew.
                            if (lead) Text("LEAD", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 8.5.sp, letterSpacing = 0.8.sp, color = Accent)
                        }
                    }
                }
                CommentsCard(s, j, vm)
                // timer
                if (j.status != "delivered") TimerCard(j, vm)
                // checklist
                ChecklistCard(j, vm)
                // before / after
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PhotoColumn("BEFORE", "before", Modifier.weight(1f), s, vm)
                    PhotoColumn("AFTER", "after", Modifier.weight(1f), s, vm)
                }
            }
            // footer action
            Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                if (j.status == "ready" || j.status == "delivered") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        if (j.invoices.none { it.docType == "invoice" && it.status != "void" }) Box(Modifier.weight(1f).height(48.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.openInvoice() }, contentAlignment = Alignment.Center) {
                            Text("＋  Invoice", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp)
                        }
                        Box(Modifier.weight(1f).height(48.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.openCertIssue() }, contentAlignment = Alignment.Center) {
                            Text("＋  Certificate", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp)
                        }
                    }
                }
                val doneN = j.checklist.count { it.done }
                val liveInv = j.invoices.firstOrNull { it.docType == "invoice" && it.status != "void" }
                val (label, action) = when {
                    j.status == "scheduled" -> "▶  Start job" to { vm.startJob() }
                    j.status == "in_progress" -> (if (j.checklist.isNotEmpty() && doneN == j.checklist.size) "Mark ready for collection" else "Mark ready" + if (j.checklist.isNotEmpty()) " ($doneN/${j.checklist.size} checklist)" else "") to { vm.markReady() }
                    // Bill settled before the car was done: checkout has nothing to collect, so
                    // the handover is recorded here — the only ready→delivered path for prepaid.
                    j.status == "ready" && liveInv?.status == "paid" -> "Car collected — mark delivered" to { vm.deliverPaidJob() }
                    // Ensures the quote's priced invoice is waiting in TO COLLECT first.
                    j.status == "ready" -> "Go to checkout →" to { vm.goToCheckout(onGoCheckout) }
                    // A car can leave OWING (on account): its bill stays in TO COLLECT until it
                    // is paid — say so, instead of pretending delivered means settled.
                    liveInv != null && liveInv.status != "paid" -> "Balance owed — view invoice" to { vm.openInvoiceView() }
                    else -> "View invoice" to { vm.openInvoiceView() }
                }
                val muted = j.status == "delivered"
                Box(Modifier.fillMaxWidth().height(56.dp).background(if (muted || s.busy) InsetAlt else Accent, RoundedCornerShape(14.dp)).clickable(enabled = !s.busy) { action() }, contentAlignment = Alignment.Center) {
                    Text(if (s.busy) "Working…" else label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (muted || s.busy) TextSecondary else AccentInk)
                }
                // A booking that won't happen can be cancelled (owner/manager) — the server
                // resolves the bill in the same stroke: drafts go, unpaid bills void, money
                // already taken is refunded through a booked credit note.
                if (j.status == "scheduled" || j.status == "in_progress") {
                    var cancelOpen by remember(j.id) { mutableStateOf(false) }
                    var cancelWhy by remember(j.id) { mutableStateOf("") }
                    Box(Modifier.fillMaxWidth().clickable { cancelOpen = !cancelOpen }.padding(top = 4.dp), contentAlignment = Alignment.Center) {
                        Text("Cancel job…", color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    if (cancelOpen) {
                        FilledInput(cancelWhy, { cancelWhy = it }, placeholder = "Reason for cancelling (required)", modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                        Box(
                            Modifier.fillMaxWidth().height(44.dp).padding(top = 6.dp)
                                .background(if (cancelWhy.isBlank()) InsetAlt else Danger, RoundedCornerShape(11.dp))
                                .clickable(enabled = cancelWhy.isNotBlank() && !s.busy) { vm.cancelJob(cancelWhy.trim()); cancelOpen = false },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (cancelWhy.isBlank()) "Enter the reason above first" else "Cancel job — bill resolves automatically",
                                color = if (cancelWhy.isBlank()) TextMuted else Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TimerCard(j: JobBoardDto, vm: JobsViewModel) {
    val started = epoch(j.startedAt)
    val readyE = epoch(j.readyAt)
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(j.id, j.status) { while (j.status == "in_progress") { now = System.currentTimeMillis(); delay(1000) } }
    val running = j.status == "in_progress"
    val paused = j.pausedAt != null
    // While paused, `now` and the open pause grow in step, so the display freezes.
    val pausedTotal = j.pausedMs + (epoch(j.pausedAt)?.let { (now - it).coerceAtLeast(0) } ?: 0L)
    val elapsed = when {
        running && started != null -> (now - started - pausedTotal).coerceAtLeast(0)
        j.status == "ready" && started != null && readyE != null -> (readyE - started - j.pausedMs).coerceAtLeast(0)
        else -> 0L
    }
    Row(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(15.dp)).border(1.dp, Hairline, RoundedCornerShape(15.dp)).padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SectionLabel(if (running && paused) "TIME ON JOB — PAUSED" else "TIME ON JOB")
            Text(elapsedLong(elapsed), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 38.sp, letterSpacing = 1.sp, color = if (running && !paused) TextPrimary else TextSecondary)
        }
        when (j.status) {
            "scheduled" -> Box(Modifier.height(54.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { vm.startJob() }.padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
                Text("▶  Start", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
            }
            "in_progress" -> Box(
                Modifier.height(54.dp)
                    .background(if (paused) InsetAlt else Color(0x24C17A00), RoundedCornerShape(13.dp))
                    .border(1.dp, if (paused) Hairline else Color(0x66C17A00), RoundedCornerShape(13.dp))
                    .clickable { vm.togglePause() }
                    .padding(horizontal = 22.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (paused) "▶  Resume" else "❚❚  Pause", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (paused) TextSecondary else Warning)
            }
            else -> Box(Modifier.height(54.dp).background(InsetAlt, RoundedCornerShape(13.dp)).padding(horizontal = 22.dp), contentAlignment = Alignment.Center) {
                Text("Finished", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextSecondary)
            }
        }
    }
}

@Composable
private fun ChecklistCard(j: JobBoardDto, vm: JobsViewModel) {
    val doneN = j.checklist.count { it.done }
    val pct = if (j.checklist.isEmpty()) 0f else doneN.toFloat() / j.checklist.size
    Column(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(15.dp)).border(1.dp, Hairline, RoundedCornerShape(15.dp)).padding(horizontal = 16.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionLabel("CHECKLIST")
            Box(Modifier.weight(1f).height(5.dp).clip(RoundedCornerShape(3.dp)).background(InsetAlt)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(pct).background(Accent, RoundedCornerShape(3.dp)))
            }
            Text("$doneN/${j.checklist.size}", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextSecondary)
        }
        if (j.checklist.isEmpty()) Text("No checklist yet — add the steps for this job.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        val editable = j.status != "delivered"
        j.checklist.forEachIndexed { i, c ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).clickable(enabled = editable) { vm.toggleChecklist(i) }.padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Box(Modifier.size(26.dp).background(if (c.done) Accent else Color.Transparent, RoundedCornerShape(8.dp)).border(1.5.dp, if (c.done) Accent else Color(0x4D101A24), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                    if (c.done) Text("✓", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = AccentInk)
                }
                Text(c.label, Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = if (c.done) TextMuted else TextPrimary)
                if (editable) Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).clickable { vm.removeChecklistItem(i) }, contentAlignment = Alignment.Center) {
                    Text("✕", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextMuted)
                }
            }
        }
        if (editable) Box(
            Modifier.fillMaxWidth().height(38.dp).dashedRect(Color(0x40101A24), 10.dp).clickable { vm.openAddChecklist() },
            contentAlignment = Alignment.Center,
        ) { Text("＋ Add item", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary) }
    }
}

@Composable
private fun AddChecklistDialog(vm: JobsViewModel) {
    var text by remember { mutableStateOf("") }
    Dialog(onDismissRequest = vm::closeAddChecklist) {
        Column(
            Modifier.width(420.dp).background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Add checklist item", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = TextPrimary)
            FilledInput(value = text, onValueChange = { text = it }, placeholder = "e.g. Clay bar & decontaminate", modifier = Modifier.fillMaxWidth(), bg = Inset)
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(48.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable { vm.closeAddChecklist() }, contentAlignment = Alignment.Center) {
                    Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary)
                }
                val ok = text.isNotBlank()
                Box(Modifier.weight(1.3f).height(48.dp).background(if (ok) Accent else InsetAlt, RoundedCornerShape(12.dp)).clickable(enabled = ok) { vm.addChecklistItem(text) }, contentAlignment = Alignment.Center) {
                    Text("Add", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (ok) AccentInk else TextMuted)
                }
            }
        }
    }
}

/** Dashed rounded outline (Compose has no dashed-border modifier). */
private fun Modifier.dashedRect(color: Color, radius: Dp, stroke: Dp = 1.5.dp) = this.drawBehind {
    val sw = stroke.toPx(); val r = radius.toPx()
    drawRoundRect(color = color, topLeft = Offset(sw / 2, sw / 2), size = Size(size.width - sw, size.height - sw), cornerRadius = CornerRadius(r, r), style = Stroke(width = sw, pathEffect = PathEffect.dashPathEffect(floatArrayOf(sw * 5, sw * 4))))
}

@Composable
private fun PhotoColumn(label: String, phase: String, modifier: Modifier, s: JobsState, vm: JobsViewModel) {
    val ctx = LocalContext.current
    val shots = s.photos.filter { it.phase == phase }
    // The camera launcher lives on the Activity (see LocalPhotoCapture) so its result survives
    // a Compose teardown; the pending target + upload live on the (Activity-scoped) ViewModel.
    val launcher = LocalPhotoCapture.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && launcher != null) launchCapture(ctx, phase, vm, launcher)
        else if (!granted) vm.note("Camera permission is needed to add a photo")
    }
    fun capture() {
        val l = launcher ?: return
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            launchCapture(ctx, phase, vm, l)
        else permission.launch(Manifest.permission.CAMERA)
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        SectionLabel(label)
        FlowRowPhotos(shots, s.photoUrls)
        val uploading = s.photoUploading == phase
        Box(
            Modifier.fillMaxWidth().height(56.dp).dashedRect(Color(0x40101A24), 10.dp).clickable(enabled = !uploading) { capture() },
            contentAlignment = Alignment.Center,
        ) {
            if (uploading) Text("Uploading…", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
            else Text("＋ ${if (shots.isEmpty()) "Take photo" else "Add another"}", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, color = TextSecondary)
        }
    }
}

@Composable
private fun FlowRowPhotos(shots: List<JobPhotoDto>, urls: Map<String, String>) {
    if (shots.isEmpty()) return
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        shots.forEach { p ->
            val url = urls[p.id]
            Box(Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(Inset).border(1.dp, Hairline, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                if (url != null) AsyncImage(model = url, contentDescription = "${p.phase} photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Text("…", color = TextMuted, fontSize = 13.sp)
            }
        }
    }
}

/** Create the capture temp file, record it as pending on the ViewModel, fire the camera. */
private fun launchCapture(
    ctx: android.content.Context,
    phase: String,
    vm: JobsViewModel,
    camera: androidx.activity.result.ActivityResultLauncher<android.net.Uri>,
) {
    val (file, uri) = mu.carfection.pos.ui.newCaptureFile(ctx)
    vm.beginCapture(phase, file)
    camera.launch(uri)
}

// ── small shared bits ─────────────────────────────────────────────────────────
@Composable private fun SectionLabel(t: String) = Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.4.sp, color = TextMuted)
@Composable private fun PlateBadge(text: String, big: Boolean = false) = Box(Modifier.background(Plate, RoundedCornerShape(if (big) 5.dp else 4.dp)).padding(horizontal = if (big) 9.dp else 7.dp, vertical = if (big) 4.dp else 3.dp)) {
    Text(text, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = if (big) 12.5.sp else 11.sp, letterSpacing = 0.4.sp, color = Color(0xFF151208))
}
@Composable private fun Avatar(letter: String, size: Int) = Box(Modifier.size(size.dp).background(Accent, CircleShape), contentAlignment = Alignment.Center) {
    Text(letter.uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = (size * 0.36f).sp, color = AccentInk)
}
@Composable private fun OutlineBtn(text: String, modifier: Modifier = Modifier, h: Int = 44, onClick: () -> Unit) = Box(modifier.height(h.dp).border(1.dp, Color(0x2E101A24), RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
    Text(text, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary)
}
@Composable private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = Color.White)
    }
}

private fun statusChip(status: String): Triple<String, Color, Color> = when (status) {
    "in_progress" -> Triple("IN PROGRESS", Color(0x26C17A00), Warning)
    "ready" -> Triple("READY", Color(0x261FA361), Success)
    "delivered" -> Triple("DELIVERED", InsetAlt, TextSecondary)
    else -> Triple("SCHEDULED", Color(0x265A67D8), Color(0xFF5A67D8))
}

// ── Lifecycle flow for a job row: Intake → Quote → Signed → Job → Invoice ────
private fun jobFlow(j: JobBoardDto): List<FlowStepUi> {
    val inv = j.invoices.firstOrNull { it.docType == "invoice" && it.status != "void" }
    val hasQuote = j.sourceQuoteId != null
    val signed = j.sourceQuote?.acceptedSignature != null &&
        j.sourceQuote.acceptedSignature !is kotlinx.serialization.json.JsonNull
    return listOf(
        FlowStepUi(
            "Intake",
            if (j.damageMarkers.isNotEmpty()) FlowState.DONE else FlowState.TODO,
            if (j.damageMarkers.isNotEmpty()) "${j.damageMarkers.size} marks" else "walk-in",
        ),
        FlowStepUi("Quote", if (hasQuote) FlowState.DONE else FlowState.TODO, j.sourceQuote?.number),
        FlowStepUi(
            "Signed",
            if (signed || hasQuote) FlowState.DONE else FlowState.TODO,
            if (signed) "client signed" else if (hasQuote) "accepted" else null,
        ),
        FlowStepUi(
            "Job",
            when (j.status) { "delivered" -> FlowState.DONE; "cancelled" -> FlowState.DECLINED; else -> FlowState.CURRENT },
            j.status.replace('_', ' '),
        ),
        FlowStepUi(
            "Invoice",
            when { inv != null -> FlowState.DONE; j.status == "delivered" -> FlowState.CURRENT; else -> FlowState.TODO },
            inv?.let { listOfNotNull(it.number, if (it.status == "paid") "paid" else null).joinToString(" · ") },
        ),
    ) + (j.certificates.firstOrNull()?.let {
        // For ceramic work the journey ends at the warranty certificate — the
        // sixth step appears only when one has been issued.
        listOf(FlowStepUi("Certificate", FlowState.DONE, listOfNotNull(it.number, it.expiresAt?.let { d -> "to $d" }).joinToString(" · ")))
    } ?: emptyList())
}

// ── Reschedule a booking: pick a day, then a time (mirrors the quote screen) ──
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RescheduleDatePicker(vm: JobsViewModel) {
    val st = rememberDatePickerState(initialSelectedDateMillis = System.currentTimeMillis())
    DatePickerDialog(
        onDismissRequest = vm::closeReschedule,
        confirmButton = {
            Text(
                "Next", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent,
                modifier = Modifier.clickable { st.selectedDateMillis?.let { vm.pickRescheduleDate(it) } ?: vm.closeReschedule() }.padding(14.dp),
            )
        },
        dismissButton = {
            Text(
                "Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary,
                modifier = Modifier.clickable { vm.closeReschedule() }.padding(14.dp),
            )
        },
    ) { DatePicker(state = st) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RescheduleTimePicker(vm: JobsViewModel) {
    val now = java.time.LocalTime.now()
    val st = rememberTimePickerState(initialHour = now.hour, initialMinute = now.minute, is24Hour = true)
    Dialog(onDismissRequest = vm::closeReschedule) {
        Column(Modifier.card().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Start time", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, color = TextPrimary)
            TimePicker(state = st)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.weight(1f).height(48.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable { vm.closeReschedule() }, contentAlignment = Alignment.Center) {
                    Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary)
                }
                Box(Modifier.weight(1.3f).height(48.dp).background(Accent, RoundedCornerShape(12.dp)).clickable { vm.pickRescheduleTime(st.hour, st.minute) }, contentAlignment = Alignment.Center) {
                    Text("Reschedule", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
                }
            }
        }
    }
}


/**
 * The job's comment thread — dated and attributed, appended never edited.
 *
 * Distinct from jobs.notes, which is the job's standing description: a comment is
 * "customer called, wants it by 4" or "found a scratch on the bumper", said at a moment by a
 * person, and the value is in knowing who said it and when.
 */
@Composable
private fun CommentsCard(s: JobsState, j: JobBoardDto, vm: JobsViewModel) {
    SectionLabel("COMMENTS")
    Column(
        Modifier.fillMaxWidth().background(CardTile, RoundedCornerShape(14.dp))
            .border(1.dp, Hairline, RoundedCornerShape(14.dp)).padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledInput(
                value = s.commentDraft, onValueChange = vm::setCommentDraft,
                placeholder = "Add a note about this car…",
                modifier = Modifier.weight(1f), height = 44.dp, bg = Inset,
            )
            val can = s.commentDraft.isNotBlank() && !s.commentBusy
            Box(
                Modifier.height(44.dp).background(if (can) Accent else Inset, RoundedCornerShape(12.dp))
                    .clickable(enabled = can) { vm.addComment(j.id) }.padding(horizontal = 18.dp),
                contentAlignment = Alignment.Center,
            ) { Text(if (s.commentBusy) "…" else "Post", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = if (can) AccentInk else TextMuted) }
        }

        if (s.comments.isEmpty()) {
            Text("No comments yet.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        } else {
            s.comments.forEach { c ->
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(c.body, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, lineHeight = 17.sp, color = TextPrimary)
                    Text(
                        listOfNotNull(
                            c.creator?.displayName?.let { firstName(it) },
                            c.createdAt?.let { commentWhen(it) },
                        ).joinToString(" · "),
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted,
                    )
                }
            }
        }
    }
}

/** "2026-07-28T09:12:00Z" → "28 Jul 13:12" in Mauritius time. */
private fun commentWhen(iso: String): String = runCatching {
    java.time.OffsetDateTime.parse(iso)
        .atZoneSameInstant(java.time.ZoneOffset.ofHours(4))
        .format(java.time.format.DateTimeFormatter.ofPattern("dd MMM HH:mm"))
}.getOrDefault(iso.take(16).replace('T', ' '))
