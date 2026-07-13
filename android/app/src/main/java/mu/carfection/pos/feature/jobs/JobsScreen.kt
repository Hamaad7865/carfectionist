package mu.carfection.pos.feature.jobs

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import mu.carfection.pos.core.network.JobPhotoDto
import mu.carfection.pos.ui.FlowState
import mu.carfection.pos.ui.FlowStepUi
import mu.carfection.pos.ui.FlowStrip
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.LocalPhotoCapture
import androidx.hilt.navigation.compose.hiltViewModel
import mu.carfection.pos.core.money.formatMUR
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
private fun epoch(iso: String?): Long? = iso?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }
private fun clock(iso: String?): String = iso?.let { runCatching { OffsetDateTime.parse(it).atZoneSameInstant(MU).format(HHMM) }.getOrNull() } ?: "—"
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
    if (s.addChecklistOpen) AddChecklistDialog(viewModel)
    s.toast?.let { LaunchedEffect(it) { delay(1800); viewModel.clearToast() } }
    s.toast?.let { Toast(it) }
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
                        Text(formatMUR(p.sellingPriceCents), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary)
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
            cards.forEach { j -> JobCard(j, col, Color(col.dot)) { vm.open(j.id) } }
        }
    }
}

@Composable
private fun JobCard(j: JobBoardDto, col: JobCol, edge: Color, onClick: () -> Unit) {
    val (right, rightC) = when (col) {
        JobCol.SCHEDULED -> clock(j.scheduledAt) to TextMuted
        JobCol.IN_PROGRESS -> {
            val now = System.currentTimeMillis()
            val pausedTotal = j.pausedMs + (epoch(j.pausedAt)?.let { (now - it).coerceAtLeast(0) } ?: 0L)
            val t = epoch(j.startedAt)?.let { elapsedShort((now - it - pausedTotal).coerceAtLeast(0)) } ?: "0m"
            if (j.pausedAt != null) "❚❚ $t" to TextMuted else t to Warning
        }
        JobCol.READY -> clock(j.readyAt) to Success
        JobCol.DELIVERED -> "Done" to TextMuted
    }
    Box(Modifier.clip(RoundedCornerShape(12.dp)).background(CardTile).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = onClick)) {
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
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Avatar(firstName(j.technician?.displayName).ifBlank { "?" }.take(1), 22)
                    Text(firstName(j.technician?.displayName).ifBlank { "Unassigned" }, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextSecondary)
                }
            }
        }
    }
}

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
                if (j.damageMarkers.isNotEmpty()) {
                    val n = j.damageMarkers.size
                    Text("⚠ $n pre-existing damage mark${if (n > 1) "s" else ""} recorded at intake", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = Warning)
                }
                // The car's journey — same five steps as the back office.
                FlowStrip(jobFlow(j))
                // technician
                SectionLabel("TECHNICIAN")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    if (s.technicians.isEmpty()) Text("No active technicians", fontFamily = Barlow, fontSize = 12.5.sp, color = TextMuted)
                    s.technicians.forEach { u ->
                        val on = u.id == j.technicianId
                        Row(Modifier.height(40.dp).background(if (on) AccentSoft else CardTile, RoundedCornerShape(20.dp)).border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(20.dp)).clickable { vm.assignTech(u.id) }.padding(start = 5.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Avatar(firstName(u.displayName).take(1), 29)
                            Text(firstName(u.displayName), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextPrimary)
                        }
                    }
                }
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
                        Box(Modifier.weight(1f).height(48.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.openInvoice() }, contentAlignment = Alignment.Center) {
                            Text("＋  Invoice", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp)
                        }
                        Box(Modifier.weight(1f).height(48.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.openCertIssue() }, contentAlignment = Alignment.Center) {
                            Text("＋  Certificate", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp)
                        }
                    }
                }
                val doneN = j.checklist.count { it.done }
                val (label, action) = when (j.status) {
                    "scheduled" -> "▶  Start job" to { vm.startJob() }
                    "in_progress" -> (if (j.checklist.isNotEmpty() && doneN == j.checklist.size) "Mark ready for collection" else "Mark ready" + if (j.checklist.isNotEmpty()) " ($doneN/${j.checklist.size} checklist)" else "") to { vm.markReady() }
                    // Ensures the quote's priced invoice is waiting in TO COLLECT first.
                    "ready" -> "Go to checkout →" to { vm.goToCheckout(onGoCheckout) }
                    else -> "View invoice" to { vm.close(); onGoCheckout() }
                }
                val muted = j.status == "delivered"
                Box(Modifier.fillMaxWidth().height(56.dp).background(if (muted || s.busy) InsetAlt else Accent, RoundedCornerShape(14.dp)).clickable(enabled = !s.busy) { action() }, contentAlignment = Alignment.Center) {
                    Text(if (s.busy) "Working…" else label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (muted || s.busy) TextSecondary else AccentInk)
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
