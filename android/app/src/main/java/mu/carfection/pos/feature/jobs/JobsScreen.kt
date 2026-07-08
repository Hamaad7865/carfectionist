package mu.carfection.pos.feature.jobs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
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
        JobCol.IN_PROGRESS -> (epoch(j.startedAt)?.let { elapsedShort(System.currentTimeMillis() - it) } ?: "0m") to Warning
        JobCol.READY -> clock(j.readyAt) to Success
        JobCol.DELIVERED -> "Done" to TextMuted
    }
    Box(Modifier.clip(RoundedCornerShape(12.dp)).background(CardTile).border(1.dp, Hairline, RoundedCornerShape(12.dp)).clickable(onClick = onClick)) {
        Row {
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
                    PhotoColumn("BEFORE", Modifier.weight(1f), showAdd = false, vm)
                    PhotoColumn("AFTER", Modifier.weight(1f), showAdd = true, vm)
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
                    "ready" -> "Go to checkout →" to { vm.close(); onGoCheckout() }
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
    val elapsed = when {
        running && started != null -> now - started
        j.status == "ready" && started != null && readyE != null -> readyE - started
        else -> 0L
    }
    Row(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(15.dp)).border(1.dp, Hairline, RoundedCornerShape(15.dp)).padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SectionLabel("TIME ON JOB")
            Text(elapsedLong(elapsed), fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 38.sp, letterSpacing = 1.sp, color = if (running) TextPrimary else TextSecondary)
        }
        when (j.status) {
            "scheduled" -> Box(Modifier.height(54.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { vm.startJob() }.padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
                Text("▶  Start", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
            }
            "in_progress" -> Box(Modifier.height(54.dp).background(Color(0x24C17A00), RoundedCornerShape(13.dp)).border(1.dp, Color(0x66C17A00), RoundedCornerShape(13.dp)).padding(horizontal = 22.dp), contentAlignment = Alignment.Center) {
                Text("● Running", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Warning)
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
        if (j.checklist.isEmpty()) Text("No checklist on this job.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        j.checklist.forEachIndexed { i, c ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).clickable { vm.toggleChecklist(i) }.padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Box(Modifier.size(26.dp).background(if (c.done) Accent else Color.Transparent, RoundedCornerShape(8.dp)).border(1.5.dp, if (c.done) Accent else Color(0x4D101A24), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                    if (c.done) Text("✓", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = AccentInk)
                }
                Text(c.label, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = if (c.done) TextMuted else TextPrimary)
            }
        }
    }
}

@Composable
private fun PhotoColumn(label: String, modifier: Modifier, showAdd: Boolean, vm: JobsViewModel) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        SectionLabel(label)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            if (!showAdd) {
                Box(Modifier.weight(1f).height(56.dp).border(1.5.dp, Color(0x2E101A24), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    Text("None", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, color = TextMuted)
                }
            } else {
                Box(Modifier.weight(1f).height(56.dp).border(1.5.dp, Color(0x40101A24), RoundedCornerShape(10.dp)).clickable { vm.note("Photo capture is a later milestone") }, contentAlignment = Alignment.Center) {
                    Text("＋ ADD", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, color = TextSecondary)
                }
            }
        }
    }
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
