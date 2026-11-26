package mu.carfection.pos.feature.appointments

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.MarkChatUnread
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
import mu.carfection.pos.core.network.AppointmentDto
import mu.carfection.pos.core.network.CustomerDto
import mu.carfection.pos.core.network.VehicleDto
import mu.carfection.pos.core.network.appointmentDisplayNotes
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Danger
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.Inset
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val BLUE_SOFT = Color(0xFFEAF3FF)
private val AMBER_SOFT = Color(0xFFFFF4DF)
private val RED_SOFT = Color(0xFFFFECEA)
private val GREEN_SOFT = Color(0xFFE6F6EE)
private val PURPLE_SOFT = Color(0xFFF0EBFF)
private val SLATE = Color(0xFF24354A)
private const val WIDE_APPOINTMENTS_DP = 1080

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppointmentsScreen(
    onGoJobs: () -> Unit = {},
    viewModel: AppointmentsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.onShown() }
    LaunchedEffect(state.goToJobs) {
        if (state.goToJobs) {
            viewModel.consumeGoToJobs()
            onGoJobs()
        }
    }
    LaunchedEffect(state.toast) {
        if (state.toast != null) {
            delay(2400)
            viewModel.clearToast()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(ScreenBg)) {
        val wide = maxWidth >= WIDE_APPOINTMENTS_DP.dp
        val visible = filterAppointments(state.appointments, state.tab, state.query)
        val metrics = appointmentMetrics(state.appointments)

        Column(
            Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AppointmentsHeader(
                loading = state.loading,
                onRefresh = viewModel::onShown,
                onNew = viewModel::openNew,
            )
            MetricStrip(metrics, state.tab, viewModel::setTab)
            if (state.error != null && state.editor == null && state.detailId == null) {
                ErrorBanner(state.error)
            }

            Row(
                Modifier.weight(1f).fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                AppointmentsList(
                    state = state,
                    rows = visible,
                    onOpen = viewModel::openDetail,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                if (wide) {
                    FollowUpQueue(
                        rows = state.appointments.filter { it.needsFollowUp() }.take(4),
                        onOpen = viewModel::openDetail,
                        modifier = Modifier.width(296.dp).fillMaxHeight(),
                    )
                }
            }
        }

        state.detailId?.let { id ->
            state.appointments.firstOrNull { it.id == id }?.let { row ->
                AppointmentDetailDialog(
                    row = row,
                    busy = state.busyId == id,
                    onDismiss = viewModel::closeDetail,
                    onEdit = { viewModel.edit(row.id) },
                    onStatus = { viewModel.setStatus(row.id, it) },
                    onConvert = { viewModel.convertToJob(row.id, it) },
                    onViewJob = { jobId -> viewModel.openJob(jobId) },
                )
            }
        }
        state.editor?.let { draft ->
            AppointmentEditorDialog(
                draft = draft,
                saving = state.saving,
                error = state.error,
                viewModel = viewModel,
                onDismiss = viewModel::closeEditor,
                onSave = viewModel::save,
            )
        }
        state.toast?.let { message ->
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp),
                shape = RoundedCornerShape(14.dp),
                color = TextPrimary,
                shadowElevation = 10.dp,
            ) {
                Row(
                    Modifier.padding(horizontal = 18.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = null, tint = Success, modifier = Modifier.size(18.dp))
                    Text(message, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
    }
}

@Composable
private fun AppointmentsHeader(loading: Boolean, onRefresh: () -> Unit, onNew: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(62.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("APPOINTMENTS", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 31.sp, lineHeight = 32.sp, letterSpacing = 1.5.sp)
            Text(
                "Book cars in and reach clients before their next alignment is due.",
                color = TextMuted,
                fontFamily = Barlow,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                lineHeight = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                onClick = onRefresh,
                shape = RoundedCornerShape(12.dp),
                color = CardBg,
                border = BorderStroke(1.dp, Hairline),
                modifier = Modifier.size(44.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Accent)
                    else Icon(Icons.Outlined.Refresh, "Refresh appointments", tint = TextSecondary)
                }
            }
            Button(
                onClick = onNew,
                modifier = Modifier.height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.White),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp),
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(7.dp))
                Text("New appointment", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }
    }
}

@Composable
private fun MetricStrip(metrics: AppointmentMetrics, active: AppointmentTab, onTab: (AppointmentTab) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        MetricCard(
            icon = Icons.Outlined.Today,
            accent = Accent,
            soft = BLUE_SOFT,
            value = metrics.today.toString(),
            label = "Today",
            helper = "booked slots",
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            icon = Icons.Outlined.NotificationsActive,
            accent = Warning,
            soft = AMBER_SOFT,
            value = metrics.needsFollowUp.toString(),
            label = "Needs follow-up",
            helper = "due in 3 days",
            selected = active == AppointmentTab.FOLLOW_UP,
            modifier = Modifier.weight(1f),
            onClick = { onTab(AppointmentTab.FOLLOW_UP) },
        )
        MetricCard(
            icon = Icons.Outlined.CalendarMonth,
            accent = Success,
            soft = GREEN_SOFT,
            value = metrics.thisWeek.toString(),
            label = "Next 7 days",
            helper = "active bookings",
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            icon = Icons.Outlined.WarningAmber,
            accent = Danger,
            soft = RED_SOFT,
            value = metrics.overdue.toString(),
            label = "Overdue",
            helper = "needs attention",
            selected = active == AppointmentTab.FOLLOW_UP && metrics.overdue > 0,
            modifier = Modifier.weight(1f),
            onClick = { onTab(AppointmentTab.FOLLOW_UP) },
        )
    }
}

@Composable
private fun MetricCard(
    icon: ImageVector,
    accent: Color,
    soft: Color,
    value: String,
    label: String,
    helper: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .height(82.dp)
            .background(CardBg, RoundedCornerShape(15.dp))
            .border(if (selected) 2.dp else 1.dp, if (selected) accent else Hairline, RoundedCornerShape(15.dp))
            .clip(RoundedCornerShape(15.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(43.dp).background(soft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(21.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                label.uppercase(),
                color = TextMuted,
                fontFamily = Barlow,
                fontWeight = FontWeight.Bold,
                fontSize = 9.5.sp,
                letterSpacing = .35.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(value, color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 27.sp, lineHeight = 27.sp)
                Text(
                    helper,
                    color = TextMuted,
                    fontFamily = Barlow,
                    fontWeight = FontWeight.Medium,
                    fontSize = 9.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(bottom = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun AppointmentsList(
    state: AppointmentsState,
    rows: List<AppointmentDto>,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: AppointmentsViewModel = hiltViewModel()
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(17.dp),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        border = BorderStroke(1.dp, Hairline),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 15.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AppointmentTab.entries.forEach { tab ->
                    val count = when (tab) {
                        AppointmentTab.UPCOMING -> state.appointments.count(AppointmentDto::isLive)
                        AppointmentTab.FOLLOW_UP -> state.appointments.count { it.needsFollowUp() }
                        AppointmentTab.HISTORY -> state.appointments.count { !it.isLive() }
                    }
                    FilterChip(
                        selected = state.tab == tab,
                        onClick = { viewModel.setTab(tab) },
                        label = {
                            Text(
                                "${tab.label}  $count",
                                fontFamily = Barlow,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.5.sp,
                                lineHeight = 16.sp,
                                textAlign = TextAlign.Center,
                                maxLines = 1,
                            )
                        },
                        modifier = Modifier.height(36.dp),
                        shape = RoundedCornerShape(10.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AccentSoft,
                            selectedLabelColor = Accent,
                            containerColor = Inset,
                            labelColor = TextSecondary,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = state.tab == tab,
                            selectedBorderColor = Accent.copy(alpha = .25f),
                            borderColor = Color.Transparent,
                        ),
                    )
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "${rows.size} ${if (rows.size == 1) "booking" else "bookings"}",
                    color = TextMuted,
                    fontFamily = Barlow,
                    fontWeight = FontWeight.Medium,
                    fontSize = 11.5.sp,
                )
            }
            HorizontalDivider(color = Hairline)
            AppointmentFilters(state)
            AppointmentTableHeader()
            if (state.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(color = Accent, modifier = Modifier.size(30.dp), strokeWidth = 3.dp)
                        Text("Loading appointments…", color = TextMuted, fontFamily = Barlow, fontSize = 14.sp)
                    }
                }
            } else if (rows.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(58.dp).background(BLUE_SOFT, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Event, contentDescription = null, tint = Accent, modifier = Modifier.size(27.dp))
                        }
                        Text("No appointments here", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("Try another filter or book a new appointment.", color = TextMuted, fontFamily = Barlow, fontSize = 13.sp)
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(rows, key = AppointmentDto::id) { row ->
                        AppointmentRow(row, onOpen = { onOpen(row.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun AppointmentFilters(state: AppointmentsState) {
    val viewModel: AppointmentsViewModel = hiltViewModel()
    Row(
        Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        OutlinedTextField(
            value = state.query,
            onValueChange = viewModel::setQuery,
            singleLine = true,
            placeholder = {
                Text("Search reg no, client or make", fontFamily = Barlow)
            },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = TextMuted) },
            shape = RoundedCornerShape(11.dp),
            textStyle = TextStyle(fontFamily = Barlow, fontSize = 13.sp, lineHeight = 16.sp),
            colors = appointmentFieldColors(),
            modifier = Modifier.weight(1f).height(56.dp),
        )
        Row(
            Modifier.height(40.dp).background(Inset, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = TextMuted, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                "Soonest first",
                color = TextSecondary,
                fontFamily = Barlow,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                lineHeight = 14.sp,
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun AppointmentTableHeader() {
    Row(
        Modifier.fillMaxWidth().height(36.dp).background(Inset).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TableLabel("WHEN", Modifier.width(92.dp))
        TableLabel("VEHICLE / REG NO", Modifier.weight(1.45f))
        TableLabel("CLIENT", Modifier.weight(1.05f))
        TableLabel("ALIGNED AT", Modifier.width(112.dp))
        TableLabel("NEXT AT", Modifier.width(132.dp))
        TableLabel("STATUS", Modifier.width(116.dp))
        Spacer(Modifier.width(40.dp))
    }
}

@Composable
private fun TableLabel(text: String, modifier: Modifier) {
    Text(
        text,
        modifier = modifier,
        color = TextMuted,
        fontFamily = Barlow,
        fontWeight = FontWeight.Bold,
        fontSize = 9.sp,
        letterSpacing = .6.sp,
        maxLines = 1,
    )
}

@Composable
private fun AppointmentRow(row: AppointmentDto, onOpen: () -> Unit) {
    val context = LocalContext.current
    val whenAt = row.scheduledWhen()
    val overdue = row.isOverdue()
    Row(
        Modifier.fillMaxWidth().height(82.dp).clickable(onClick = onOpen).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(92.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(whenAt?.format(TIME_FMT) ?: "—", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text(
                dayLabel(row),
                color = if (overdue) Danger else TextMuted,
                fontFamily = Barlow,
                fontWeight = FontWeight.Bold,
                fontSize = 9.sp,
                letterSpacing = .3.sp,
                maxLines = 1,
            )
        }
        Row(Modifier.weight(1.45f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(40.dp).background(BLUE_SOFT, RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.DirectionsCar, contentDescription = null, tint = Accent, modifier = Modifier.size(21.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(row.vehicles?.plate?.takeIf(String::isNotBlank) ?: "No plate", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 1)
                Text(
                    listOfNotNull(row.vehicles?.make, row.vehicles?.model).joinToString(" ").ifBlank { "Vehicle details pending" },
                    color = TextMuted,
                    fontFamily = Barlow,
                    fontWeight = FontWeight.Medium,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(Modifier.weight(1.05f).padding(horizontal = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(row.customers?.name ?: "Unknown client", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(row.customers?.phone ?: "No mobile", color = TextMuted, fontFamily = Barlow, fontSize = 10.5.sp, maxLines = 1)
        }
        Column(Modifier.width(112.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(row.alignedAtKm?.let(::formatKm) ?: "—", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
            Text(row.alignedOn?.let(::shortIsoDate) ?: "Not recorded", color = TextMuted, fontFamily = Barlow, fontSize = 9.5.sp, maxLines = 1)
        }
        Column(Modifier.width(132.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            val color = if (overdue) Danger else if (row.needsFollowUp()) Warning else TextPrimary
            Text(row.nextAtKm?.let(::formatKm) ?: "—", color = color, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
            Text(
                if (overdue) "Overdue · ${daysOverdue(row)}d" else whenAt?.format(SHORT_DATE_FMT) ?: "—",
                color = color.copy(alpha = .85f),
                fontFamily = Barlow,
                fontSize = 9.5.sp,
                maxLines = 1,
            )
        }
        Box(Modifier.width(116.dp)) { AppointmentStatusChip(row.status) }
        Box(
            Modifier.size(36.dp).background(Inset, RoundedCornerShape(10.dp)).clickable { callClient(context, row.customers?.phone) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Phone, "Call client", tint = if (row.customers?.phone.isNullOrBlank()) TextMuted else Accent, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(4.dp))
    }
    HorizontalDivider(color = Hairline, modifier = Modifier.padding(start = 16.dp))
}

@Composable
private fun AppointmentStatusChip(status: String) {
    val (ink, bg) = statusColours(status)
    Row(
        Modifier.height(26.dp).background(bg, RoundedCornerShape(999.dp)).padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).background(ink, CircleShape))
        Text(
            appointmentStatusLabel(status),
            color = ink,
            fontFamily = Barlow,
            fontWeight = FontWeight.Bold,
            fontSize = 9.5.sp,
            lineHeight = 12.sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}

@Composable
private fun FollowUpQueue(rows: List<AppointmentDto>, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(17.dp),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        border = BorderStroke(1.dp, Hairline),
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(36.dp).background(AMBER_SOFT, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.MarkChatUnread, contentDescription = null, tint = Warning, modifier = Modifier.size(19.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text("Follow-up queue", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("Due soon and overdue", color = TextMuted, fontFamily = Barlow, fontSize = 10.5.sp)
                }
                CountPill(rows.size, Danger)
            }
            HorizontalDivider(color = Hairline)
            if (rows.isEmpty()) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Icon(Icons.Outlined.Check, contentDescription = null, tint = Success, modifier = Modifier.size(30.dp))
                        Text("All caught up", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("No follow-ups are due.", color = TextMuted, fontFamily = Barlow, fontSize = 11.sp)
                    }
                }
            } else {
                LazyColumn(Modifier.weight(1f)) {
                    items(rows, key = AppointmentDto::id) { row ->
                        FollowUpCard(row, onOpen = { onOpen(row.id) }, onCall = { callClient(context, row.customers?.phone) }, onSms = { smsClient(context, row.customers?.phone) })
                    }
                }
            }
            Surface(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                shape = RoundedCornerShape(13.dp),
                color = Color(0xFFF5F9FF),
                border = BorderStroke(1.dp, Color(0xFFDCEAFF)),
            ) {
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Box(Modifier.size(30.dp).background(BLUE_SOFT, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Event, contentDescription = null, tint = Accent, modifier = Modifier.size(15.dp))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("${rows.count { it.isOverdue() }} overdue", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                        Text("Call or SMS clients before the booked slot passes.", color = TextMuted, fontFamily = Barlow, fontSize = 9.5.sp, lineHeight = 13.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun FollowUpCard(row: AppointmentDto, onOpen: () -> Unit, onCall: () -> Unit, onSms: () -> Unit) {
    val overdue = row.isOverdue()
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Box(
                Modifier.size(36.dp).background(if (overdue) RED_SOFT else AMBER_SOFT, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initials(row.customers?.name),
                    color = if (overdue) Danger else Warning,
                    fontFamily = Barlow,
                    fontWeight = FontWeight.Bold,
                    fontSize = 10.5.sp,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.customers?.name ?: "Unknown", color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, maxLines = 1)
                Text("${row.vehicles?.plate.orEmpty()} · ${row.vehicles?.make.orEmpty()}", color = TextMuted, fontFamily = Barlow, fontSize = 9.5.sp, maxLines = 1)
            }
            CountPill(
                if (overdue) "${daysOverdue(row)}d late" else "Due soon",
                if (overdue) Danger else Warning,
            )
        }
        Text(
            "Next at ${row.nextAtKm?.let(::formatKm) ?: "—"}",
            color = if (overdue) Danger else TextSecondary,
            fontFamily = Barlow,
            fontWeight = FontWeight.SemiBold,
            fontSize = 10.5.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            MiniAction(Icons.Outlined.Phone, "Call", Modifier.weight(1f), onCall)
            MiniAction(Icons.Outlined.Message, "SMS", Modifier.weight(1f), onSms)
        }
    }
    HorizontalDivider(color = Hairline)
}

@Composable
private fun MiniAction(icon: ImageVector, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.height(32.dp).background(Inset, RoundedCornerShape(8.dp)).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(5.dp))
        Text(label, color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 10.sp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppointmentEditorDialog(
    draft: AppointmentDraft,
    saving: Boolean,
    error: String?,
    viewModel: AppointmentsViewModel,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
) {
    var showAlignedDate by rememberSaveable { mutableStateOf(false) }
    var showScheduleDate by rememberSaveable { mutableStateOf(false) }
    var showTime by rememberSaveable { mutableStateOf(false) }

    Dialog(
        onDismissRequest = if (saving) ({}) else onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = !saving),
    ) {
        BoxWithConstraints(
            Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 18.dp),
            contentAlignment = Alignment.Center,
        ) {
            val wide = maxWidth >= 980.dp
            Surface(
                modifier = Modifier.fillMaxWidth().widthIn(max = 1160.dp).heightIn(max = 810.dp),
                shape = RoundedCornerShape(23.dp),
                color = CardBg,
                shadowElevation = 18.dp,
                border = BorderStroke(1.dp, Hairline),
            ) {
                Column(Modifier.fillMaxWidth().heightIn(max = 810.dp)) {
                    Row(
                        Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 22.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(40.dp).background(BLUE_SOFT, RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Accent, modifier = Modifier.size(20.dp))
                        }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(if (draft.editingId == null) "NEW APPOINTMENT" else "EDIT APPOINTMENT", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 25.sp, letterSpacing = .8.sp)
                            Text("Client, vehicle, alignment and booking details", color = TextMuted, fontFamily = Barlow, fontSize = 11.5.sp)
                        }
                        IconButtonBox(Icons.Outlined.Close, "Close", enabled = !saving, onClick = onDismiss)
                    }
                    HorizontalDivider(color = Hairline)
                    if (error != null) {
                        ErrorBanner(error, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp))
                    }
                    Row(Modifier.weight(1f).fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Column(
                            Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(13.dp),
                        ) {
                            EditorSection("CLIENT") {
                                AppointmentClientFields(draft, viewModel)
                            }
                            EditorSection("VEHICLE") {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    AppointmentField(
                                        label = "Reg No",
                                        value = draft.regNo,
                                        onValueChange = viewModel::setRegNo,
                                        modifier = Modifier.weight(1f),
                                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                                        trailing = Icons.Outlined.DirectionsCar,
                                    )
                                    AppointmentField(
                                        label = "Make",
                                        value = draft.make,
                                        onValueChange = viewModel::setMake,
                                        modifier = Modifier.weight(1f),
                                    )
                                    AppointmentField(
                                        label = "Model",
                                        value = draft.model,
                                        onValueChange = viewModel::setModel,
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (wide) {
                                        AppointmentField(
                                            label = "Colour",
                                            value = draft.colour,
                                            onValueChange = viewModel::setColour,
                                            modifier = Modifier.weight(.85f),
                                        )
                                    }
                                }
                            }
                            EditorSection("ALIGNMENT HISTORY", emphasis = true) {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    AppointmentField(
                                        label = "Aligned at",
                                        value = draft.alignedAtKm,
                                        onValueChange = viewModel::setAlignedKm,
                                        modifier = Modifier.weight(1f),
                                        suffix = "km",
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    )
                                    DateField(
                                        label = "Aligned on",
                                        value = draft.alignedOn,
                                        onClick = { showAlignedDate = true },
                                        modifier = Modifier.weight(1f),
                                    )
                                    AppointmentField(
                                        label = "Next at",
                                        value = draft.nextAtKm,
                                        onValueChange = viewModel::setNextKm,
                                        modifier = Modifier.weight(1f),
                                        suffix = "km",
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    )
                                }
                            }
                            EditorSection("SCHEDULE") {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    DateField(
                                        label = "Next appointment",
                                        value = draft.scheduledDate,
                                        onClick = { showScheduleDate = true },
                                        modifier = Modifier.weight(1.15f),
                                    )
                                    TimeField(
                                        value = draft.scheduledTime,
                                        onClick = { showTime = true },
                                        modifier = Modifier.width(128.dp),
                                    )
                                    AppointmentField(
                                        label = "Service",
                                        value = draft.service,
                                        onValueChange = viewModel::setService,
                                        modifier = Modifier.weight(1.4f),
                                    )
                                    AppointmentField(
                                        label = "Duration",
                                        value = draft.durationMinutes,
                                        onValueChange = viewModel::setDuration,
                                        modifier = Modifier.width(102.dp),
                                        suffix = "min",
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    )
                                }
                            }
                            EditorSection("FOLLOW-UP & NOTES") {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    FollowUpChannel(Icons.Outlined.Phone, "Phone call", true)
                                    FollowUpChannel(Icons.Outlined.Message, "SMS", true)
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        "The tyre centre keeps client contact inside the device; no WhatsApp integration is shown.",
                                        color = TextMuted,
                                        fontFamily = Barlow,
                                        fontSize = 10.sp,
                                        lineHeight = 14.sp,
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                OutlinedTextField(
                                    value = draft.notes,
                                    onValueChange = viewModel::setNotes,
                                    label = { Text("Notes (optional)", fontFamily = Barlow) },
                                    placeholder = { Text("e.g. car pulls left at low speed", fontFamily = Barlow) },
                                    minLines = 2,
                                    maxLines = 3,
                                    shape = RoundedCornerShape(11.dp),
                                    textStyle = TextStyle(fontFamily = Barlow, fontSize = 13.sp),
                                    colors = appointmentFieldColors(),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                        if (wide) {
                            AppointmentSummaryCard(draft, Modifier.width(300.dp).fillMaxHeight())
                        }
                    }
                    HorizontalDivider(color = Hairline)
                    Row(
                        Modifier.fillMaxWidth().height(70.dp).padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = onDismiss, enabled = !saving) {
                            Text("Cancel", color = TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = onSave,
                            enabled = !saving,
                            modifier = Modifier.height(44.dp),
                            shape = RoundedCornerShape(11.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.White),
                        ) {
                            if (saving) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            else Icon(Icons.Outlined.CalendarMonth, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (draft.editingId == null) "Confirm appointment" else "Save changes",
                                fontFamily = Barlow,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.5.sp,
                            )
                        }
                    }
                }
            }
        }
    }

    if (showAlignedDate) AppointmentDateDialog(draft.alignedOn, "Aligned on", { showAlignedDate = false }, viewModel::setAlignedOn)
    if (showScheduleDate) AppointmentDateDialog(draft.scheduledDate, "Next appointment", { showScheduleDate = false }, viewModel::setScheduledDate)
    if (showTime) AppointmentTimeDialog(draft.scheduledTime, { showTime = false }, viewModel::setScheduledTime)
}

@Composable
private fun AppointmentClientFields(draft: AppointmentDraft, viewModel: AppointmentsViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = draft.customerName,
                onValueChange = viewModel::setCustomerName,
                readOnly = draft.customerId != null,
                label = { Text("Client name, mobile or reg no", fontFamily = Barlow) },
                placeholder = { Text("Search an existing client", fontFamily = Barlow) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = TextMuted) },
                trailingIcon = {
                    if (draft.searchingCustomers) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = Accent)
                    else if (draft.customerId != null) Icon(Icons.Outlined.Check, contentDescription = "Existing client selected", tint = Success)
                },
                singleLine = true,
                shape = RoundedCornerShape(11.dp),
                textStyle = TextStyle(fontFamily = Barlow, fontSize = 13.sp),
                colors = appointmentFieldColors(),
                modifier = Modifier.weight(1.3f),
            )
            AppointmentField(
                label = "Mobile",
                value = draft.customerPhone,
                onValueChange = viewModel::setPhone,
                modifier = Modifier.weight(.85f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                trailing = Icons.Outlined.Phone,
                readOnly = draft.customerId != null,
            )
        }
        if (draft.customerMatches.isNotEmpty() && draft.customerId == null) {
            Surface(
                shape = RoundedCornerShape(11.dp),
                color = Color(0xFFF8FAFD),
                border = BorderStroke(1.dp, Hairline),
            ) {
                Column(Modifier.fillMaxWidth().padding(6.dp)) {
                    draft.customerMatches.take(4).forEach { customer ->
                        CustomerResult(customer) { viewModel.chooseCustomer(customer) }
                    }
                }
            }
        }
        if (draft.customerId != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Surface(shape = RoundedCornerShape(999.dp), color = GREEN_SOFT) {
                    Text(
                        "Existing client",
                        color = Success,
                        fontFamily = Barlow,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                    )
                }
                if (draft.loadingVehicles) {
                    CircularProgressIndicator(Modifier.size(15.dp), color = Accent, strokeWidth = 2.dp)
                    Text("Loading vehicles…", color = TextMuted, fontFamily = Barlow, fontSize = 10.sp)
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { viewModel.setCustomerName(draft.customerName) }) {
                    Text("Change client", color = Accent, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 10.5.sp)
                }
            }
        }
        if (draft.vehicleOptions.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                draft.vehicleOptions.forEach { vehicle ->
                    VehicleChoice(
                        vehicle = vehicle,
                        selected = vehicle.id == draft.vehicleId,
                        onClick = { viewModel.chooseVehicle(vehicle) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CustomerResult(customer: CustomerDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(42.dp).clickable(onClick = onClick).padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(Modifier.size(29.dp).background(AccentSoft, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Person, contentDescription = null, tint = Accent, modifier = Modifier.size(15.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(customer.name, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp)
            Text(customer.phone ?: "No mobile", color = TextMuted, fontFamily = Barlow, fontSize = 9.5.sp)
        }
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = TextMuted, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun VehicleChoice(vehicle: VehicleDto, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.height(38.dp).background(if (selected) BLUE_SOFT else Inset, RoundedCornerShape(9.dp))
            .border(1.dp, if (selected) Accent.copy(alpha = .5f) else Color.Transparent, RoundedCornerShape(9.dp))
            .clickable(onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(Icons.Outlined.DirectionsCar, contentDescription = null, tint = if (selected) Accent else TextSecondary, modifier = Modifier.size(16.dp))
        Text(vehicle.plate, color = if (selected) Accent else TextSecondary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
    }
}

@Composable
private fun EditorSection(title: String, emphasis: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(if (emphasis) Color(0xFFFAFCFF) else Color.Transparent, RoundedCornerShape(13.dp))
            .then(if (emphasis) Modifier.border(1.dp, Color(0xFFDCE9FA), RoundedCornerShape(13.dp)) else Modifier)
            .padding(if (emphasis) 14.dp else 0.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, color = if (emphasis) Accent else TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = .8.sp)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun AppointmentField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    suffix: String? = null,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
    trailing: ImageVector? = null,
    readOnly: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, fontFamily = Barlow) },
        suffix = suffix?.let { { Text(it, color = TextMuted, fontFamily = Barlow, fontSize = 11.sp) } },
        trailingIcon = trailing?.let { { Icon(it, contentDescription = null, tint = TextMuted, modifier = Modifier.size(17.dp)) } },
        singleLine = true,
        readOnly = readOnly,
        shape = RoundedCornerShape(11.dp),
        textStyle = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
        keyboardOptions = keyboardOptions,
        colors = appointmentFieldColors(),
        modifier = modifier.height(62.dp),
    )
}

@Composable
private fun DateField(label: String, value: LocalDate, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(62.dp),
        shape = RoundedCornerShape(11.dp),
        color = Color.White,
        border = BorderStroke(1.dp, Hairline),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 9.5.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value.format(DATE_FIELD_FMT), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, modifier = Modifier.weight(1f), maxLines = 1)
                Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = TextMuted, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun TimeField(value: LocalTime, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(62.dp),
        shape = RoundedCornerShape(11.dp),
        color = Color.White,
        border = BorderStroke(1.dp, Hairline),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text("Time", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 9.5.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value.format(TIME_FMT_LOCAL), color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = TextMuted, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun FollowUpChannel(icon: ImageVector, text: String, selected: Boolean) {
    Row(
        Modifier.height(36.dp).background(if (selected) GREEN_SOFT else Inset, RoundedCornerShape(9.dp))
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Success, modifier = Modifier.size(15.dp))
        Text(text, color = Success, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 10.5.sp)
    }
}

@Composable
private fun AppointmentSummaryCard(draft: AppointmentDraft, modifier: Modifier = Modifier) {
    Column(
        modifier
            .background(Color(0xFF111F33), RoundedCornerShape(18.dp))
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("APPOINTMENT SUMMARY", color = Color.White, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = .8.sp)
                Text("Review before confirming", color = Color(0xFF8292A8), fontFamily = Barlow, fontSize = 10.sp)
            }
            CountPill(if (draft.editingId == null) "DRAFT" else "EDIT", Accent)
        }
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Box(Modifier.size(48.dp).background(Accent, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.DirectionsCar, contentDescription = null, tint = Color.White, modifier = Modifier.size(25.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(draft.regNo.ifBlank { "REG NO" }, color = Color.White, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = .8.sp)
                Text(listOfNotNull(draft.make.ifBlank { null }, draft.model.ifBlank { null }, draft.colour.ifBlank { null }).joinToString(" · ").ifBlank { "Vehicle details" }, color = Color(0xFFA6B2C3), fontFamily = Barlow, fontSize = 10.sp, maxLines = 2)
            }
        }
        DarkDivider()
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Box(Modifier.size(31.dp).background(Color(0x22FFFFFF), CircleShape), contentAlignment = Alignment.Center) {
                Text(initials(draft.customerName), color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.sp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(draft.customerName.ifBlank { "Client name" }, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
                Text(draft.customerPhone.ifBlank { "Mobile number" }, color = Color(0xFF8191A7), fontFamily = Barlow, fontSize = 9.5.sp)
            }
        }
        DarkDivider()
        DarkLabel(Icons.Outlined.DirectionsCar, "ALIGNMENT TIMELINE")
        Spacer(Modifier.height(12.dp))
        TimelinePoint("Aligned at", formatKmInput(draft.alignedAtKm), Accent)
        Spacer(Modifier.height(18.dp))
        TimelinePoint("Next at", formatKmInput(draft.nextAtKm), Danger)
        DarkDivider()
        DarkLabel(Icons.Outlined.CalendarMonth, "SCHEDULED FOR")
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Column(
                Modifier.size(52.dp).background(Color(0x2B2B8CFF), RoundedCornerShape(11.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(draft.scheduledDate.format(DateTimeFormatter.ofPattern("MMM", Locale.ENGLISH)).uppercase(Locale.ENGLISH), color = Color(0xFF79B2FF), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.sp)
                Text(draft.scheduledDate.dayOfMonth.toString(), color = Color.White, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("${draft.scheduledDate.format(DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH))} at ${draft.scheduledTime.format(TIME_FMT_LOCAL)}", color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp)
                Text("${draft.service.ifBlank { "Service" }} · ${draft.durationMinutes.ifBlank { "—" }} min", color = Color(0xFF8191A7), fontFamily = Barlow, fontSize = 9.5.sp, maxLines = 2)
            }
        }
        DarkDivider()
        DarkLabel(Icons.Outlined.Phone, "FOLLOW-UP")
        Spacer(Modifier.height(11.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DarkChannel(Icons.Outlined.Phone, "Call")
            DarkChannel(Icons.Outlined.Message, "SMS")
        }
        Spacer(Modifier.weight(1f))
        Text(
            "Confirming creates the booking in the shared appointment list.",
            color = Color(0xFF708097),
            fontFamily = Barlow,
            fontSize = 9.sp,
            lineHeight = 13.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun TimelinePoint(label: String, value: String, dot: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Box(Modifier.size(9.dp).background(dot, CircleShape).border(3.dp, dot.copy(alpha = .2f), CircleShape))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, color = Color(0xFF8292A8), fontFamily = Barlow, fontSize = 9.sp)
            Text(value, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
    }
}

@Composable
private fun DarkLabel(icon: ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, contentDescription = null, tint = Color(0xFF7F90A8), modifier = Modifier.size(13.dp))
        Text(label, color = Color(0xFF7F90A8), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 8.5.sp, letterSpacing = .6.sp)
    }
}

@Composable
private fun DarkDivider() {
    Spacer(Modifier.height(15.dp))
    HorizontalDivider(color = Color(0x22FFFFFF))
    Spacer(Modifier.height(15.dp))
}

@Composable
private fun DarkChannel(icon: ImageVector, label: String) {
    Row(
        Modifier.height(34.dp).background(Color(0x18FFFFFF), RoundedCornerShape(9.dp)).padding(horizontal = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Color(0xFF65D5AB), modifier = Modifier.size(14.dp))
        Text(label, color = Color(0xFFDCE5EF), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 10.sp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppointmentDateDialog(value: LocalDate, label: String, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val initial = value.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                picker.selectedDateMillis?.let {
                    onPick(LocalDate.ofEpochDay(it / 86_400_000L))
                }
                onDismiss()
            }) { Text("Select", fontFamily = Barlow, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", fontFamily = Barlow) } },
    ) {
        DatePicker(state = picker, title = { Text(label, fontFamily = Barlow, modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp)) })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppointmentTimeDialog(value: LocalTime, onDismiss: () -> Unit, onPick: (LocalTime) -> Unit) {
    val picker = rememberTimePickerState(initialHour = value.hour, initialMinute = value.minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onPick(LocalTime.of(picker.hour, picker.minute)); onDismiss() }) {
                Text("Select", fontFamily = Barlow, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", fontFamily = Barlow) } },
        title = { Text("Appointment time", fontFamily = Barlow, fontWeight = FontWeight.Bold) },
        text = { TimePicker(state = picker) },
    )
}

@Composable
private fun AppointmentDetailDialog(
    row: AppointmentDto,
    busy: Boolean,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onStatus: (String) -> Unit,
    onConvert: (Boolean) -> Unit,
    onViewJob: (String) -> Unit,
) {
    val context = LocalContext.current
    Dialog(
        onDismissRequest = if (busy) ({}) else onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = !busy),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().widthIn(max = 650.dp).padding(22.dp),
            shape = RoundedCornerShape(22.dp),
            color = CardBg,
            shadowElevation = 18.dp,
        ) {
            Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(43.dp).background(BLUE_SOFT, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.DirectionsCar, contentDescription = null, tint = Accent, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(11.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(row.vehicles?.plate ?: "Appointment", color = TextPrimary, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = .6.sp)
                        Text(listOfNotNull(row.vehicles?.make, row.vehicles?.model).joinToString(" ").ifBlank { "Vehicle" }, color = TextMuted, fontFamily = Barlow, fontSize = 11.sp)
                    }
                    AppointmentStatusChip(row.status)
                    Spacer(Modifier.width(6.dp))
                    IconButtonBox(Icons.Outlined.Close, "Close", !busy, onDismiss)
                }
                HorizontalDivider(color = Hairline)
                Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    DetailTile(Icons.Outlined.Today, "DATE & TIME", row.scheduledWhen()?.format(FULL_DATE_FMT) ?: "—", Modifier.weight(1f))
                    DetailTile(Icons.Outlined.AccessTime, "DURATION", "${row.durationMinutes ?: 45} min", Modifier.weight(.75f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    DetailTile(Icons.Outlined.Person, "CLIENT", row.customers?.name ?: "Unknown", Modifier.weight(1f), row.customers?.phone)
                    DetailTile(Icons.Outlined.Event, "SERVICE", row.service ?: "Wheel alignment", Modifier.weight(1f), row.department)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    DetailTile(Icons.Outlined.DirectionsCar, "ALIGNED AT", row.alignedAtKm?.let(::formatKm) ?: "—", Modifier.weight(1f), row.alignedOn?.let(::shortIsoDate))
                    DetailTile(Icons.Outlined.NotificationsActive, "NEXT AT", row.nextAtKm?.let(::formatKm) ?: "—", Modifier.weight(1f), if (row.isOverdue()) "Overdue" else row.scheduledWhen()?.format(SHORT_DATE_FMT))
                }
                if (appointmentDisplayNotes(row.notes).isNotBlank()) {
                    Surface(shape = RoundedCornerShape(12.dp), color = Inset) {
                        Column(Modifier.fillMaxWidth().padding(13.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("NOTES", color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.sp, letterSpacing = .6.sp)
                            Text(appointmentDisplayNotes(row.notes), color = TextSecondary, fontFamily = Barlow, fontSize = 11.5.sp, lineHeight = 16.sp)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { callClient(context, row.customers?.phone) },
                        enabled = !row.customers?.phone.isNullOrBlank(),
                        modifier = Modifier.weight(1f).height(42.dp),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Outlined.Phone, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Call client", fontFamily = Barlow, fontWeight = FontWeight.SemiBold)
                    }
                    OutlinedButton(
                        onClick = { smsClient(context, row.customers?.phone) },
                        enabled = !row.customers?.phone.isNullOrBlank(),
                        modifier = Modifier.weight(1f).height(42.dp),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Outlined.Message, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Send SMS", fontFamily = Barlow, fontWeight = FontWeight.SemiBold)
                    }
                }
                HorizontalDivider(color = Hairline)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = onEdit, enabled = !busy, modifier = Modifier.height(42.dp), shape = RoundedCornerShape(10.dp)) {
                        Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Edit", fontFamily = Barlow, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.weight(1f))
                    if (row.status == "scheduled") StatusButton("Confirm", Success) { onStatus("confirmed") }
                    if (row.status in setOf("scheduled", "confirmed")) StatusButton("Mark arrived", Accent) { onStatus("arrived") }
                    if (row.status == "arrived") StatusButton("Complete", Success) { onStatus("done") }
                    if (row.status in setOf("scheduled", "confirmed")) StatusButton("Cancel", Danger) { onStatus("cancelled") }
                }
                if (row.canConvertToJob()) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(9.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onConvert(false) },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(44.dp),
                            shape = RoundedCornerShape(11.dp),
                        ) {
                            Icon(Icons.Outlined.CalendarMonth, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(7.dp))
                            Text("Schedule job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, maxLines = 1)
                        }
                        Button(
                            onClick = { onConvert(true) },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(44.dp),
                            shape = RoundedCornerShape(11.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.White),
                        ) {
                            Icon(Icons.Outlined.PlayArrow, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(7.dp))
                            Text("Start now", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.5.sp, maxLines = 1)
                        }
                    }
                } else if (row.jobId != null) {
                    OutlinedButton(
                        onClick = { onViewJob(row.jobId) },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        shape = RoundedCornerShape(11.dp),
                    ) {
                        Text("Open job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
                if (busy) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = Accent, strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Updating appointment…", color = TextMuted, fontFamily = Barlow, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailTile(icon: ImageVector, label: String, value: String, modifier: Modifier = Modifier, sub: String? = null) {
    Surface(modifier = modifier, shape = RoundedCornerShape(12.dp), color = Inset) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(icon, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(17.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, color = TextMuted, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 8.5.sp, letterSpacing = .6.sp)
                Text(value, color = TextPrimary, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                sub?.takeIf(String::isNotBlank)?.let { Text(it, color = TextMuted, fontFamily = Barlow, fontSize = 9.sp, maxLines = 1) }
            }
        }
    }
}

@Composable
private fun StatusButton(label: String, color: Color, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.height(42.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White),
    ) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
}

@Composable
private fun IconButtonBox(icon: ImageVector, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(38.dp).background(Inset, CircleShape).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, description, tint = if (enabled) TextSecondary else TextMuted, modifier = Modifier.size(18.dp)) }
}

@Composable
private fun CountPill(value: Any, color: Color) {
    Surface(shape = RoundedCornerShape(999.dp), color = color.copy(alpha = .12f)) {
        Text(
            value.toString(),
            color = color,
            fontFamily = Barlow,
            fontWeight = FontWeight.Bold,
            fontSize = 9.sp,
            lineHeight = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            maxLines = 1,
        )
    }
}

@Composable
private fun ErrorBanner(message: String?, modifier: Modifier = Modifier.fillMaxWidth()) {
    message ?: return
    Row(
        modifier.background(RED_SOFT, RoundedCornerShape(11.dp)).border(1.dp, Danger.copy(alpha = .2f), RoundedCornerShape(11.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Danger, modifier = Modifier.size(17.dp))
        Text(
            message,
            color = Danger,
            fontFamily = Barlow,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.5.sp,
            lineHeight = 15.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun appointmentFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Accent,
    unfocusedBorderColor = Hairline,
    focusedLabelColor = Accent,
    unfocusedLabelColor = TextMuted,
    cursorColor = Accent,
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedContainerColor = Color.White,
    unfocusedContainerColor = Color.White,
)

private fun statusColours(status: String): Pair<Color, Color> = when (status) {
    "confirmed" -> Color(0xFF6B5AD8) to PURPLE_SOFT
    "arrived" -> Warning to AMBER_SOFT
    "done" -> Success to GREEN_SOFT
    "cancelled" -> Danger to RED_SOFT
    "no_show" -> TextSecondary to Inset
    else -> Accent to BLUE_SOFT
}

private fun dayLabel(row: AppointmentDto): String {
    val date = row.scheduledWhen()?.toLocalDate() ?: return "DATE TBD"
    val today = LocalDate.now(APPOINTMENT_ZONE)
    return when (date) {
        today -> "TODAY"
        today.plusDays(1) -> "TOMORROW"
        else -> date.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)).uppercase(Locale.ENGLISH)
    }
}

private fun daysOverdue(row: AppointmentDto): Long {
    val instant = row.instant() ?: return 0
    return java.time.Duration.between(instant, Instant.now()).toDays().coerceAtLeast(0)
}

private fun formatKm(value: Int): String = String.format(Locale.US, "%,d km", value)
private fun formatKmInput(value: String): String = parseKm(value)?.let(::formatKm) ?: "—"
private fun shortIsoDate(value: String): String =
    runCatching { LocalDate.parse(value).format(SHORT_DATE_FMT) }.getOrElse { value }

private fun initials(name: String?): String =
    name.orEmpty().trim().split(Regex("\\s+")).filter(String::isNotBlank).take(2).joinToString("") { it.first().uppercase() }
        .ifBlank { "?" }

private fun callClient(context: Context, phone: String?) {
    if (phone.isNullOrBlank()) return
    runCatching {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")))
    }
}

private fun smsClient(context: Context, phone: String?) {
    if (phone.isNullOrBlank()) return
    runCatching {
        context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(phone)}")))
    }
}

private val TIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val TIME_FMT_LOCAL: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val SHORT_DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
private val DATE_FIELD_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
private val FULL_DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM · HH:mm", Locale.ENGLISH)
