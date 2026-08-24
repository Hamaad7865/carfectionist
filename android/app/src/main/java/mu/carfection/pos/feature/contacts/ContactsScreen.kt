package mu.carfection.pos.feature.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import mu.carfection.pos.core.network.ContactDto
import mu.carfection.pos.core.network.ContactVehicleDto
import mu.carfection.pos.feature.contacts.CustomerHistoryState
import mu.carfection.pos.feature.contacts.HistoryPhotoUi
import mu.carfection.pos.feature.contacts.JobHistoryUi
import mu.carfection.pos.feature.intake.VEHICLE_CATEGORIES
import mu.carfection.pos.feature.intake.VEHICLE_COLORS
import mu.carfection.pos.feature.intake.VEHICLE_MAKES
import mu.carfection.pos.ui.FilledInput
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
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import mu.carfection.pos.ui.theme.Warning

/**
 * Contacts on the shop floor: who the customer is, what they drive, and — the question this
 * studio actually asks — whether that car has been coated, with anything worth remembering.
 */
@Composable
fun ContactsScreen(onJobStarted: () -> Unit = {}, viewModel: ContactsViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()

    // Chain into Jobs the same way Intake/Quote hand off — "Start job" put the car straight on
    // the board, so the operator should land there too, not stay on the customer card reading a
    // toast. The job itself opens via OpenJobBus, requested the moment the job was created.
    s.startedJobId?.let {
        LaunchedEffect(it) { onJobStarted(); viewModel.consumeStartedJob() }
    }

    Column(
        Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("CONTACTS", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text("Customers, their cars, and what has been coated", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
            Spacer(Modifier.weight(1f))
            Box(
                Modifier.height(38.dp).background(AccentSoft, RoundedCornerShape(12.dp))
                    .border(1.5.dp, AccentLine, RoundedCornerShape(12.dp))
                    .clickable { viewModel.addCustomer() }.padding(horizontal = 15.dp),
                contentAlignment = Alignment.Center,
            ) { Text("+ New customer", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Accent) }
        }
        FilledInput(
            value = s.query, onValueChange = viewModel::setQuery,
            placeholder = "Search a customer by name or phone…",
            modifier = Modifier.fillMaxWidth(), height = 46.dp, bg = CardBg, leadingSearch = true,
        )

        when {
            s.loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("Loading…", color = TextMuted, fontFamily = Barlow)
            }
            s.error != null -> Column(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Spacer(Modifier.weight(1f))
                Text("Couldn’t load contacts.", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Danger)
                Text(s.error!!, fontFamily = Barlow, fontSize = 12.5.sp, color = TextMuted)
                Box(
                    Modifier.height(42.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                        .clickable { viewModel.load(s.query) }.padding(horizontal = 18.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Try again", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextSecondary) }
                Spacer(Modifier.weight(1f))
            }
            s.contacts.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    if (s.query.isBlank()) "No customers yet." else "Nobody matches “${s.query}”.",
                    fontFamily = Barlow, fontSize = 14.sp, color = TextMuted,
                )
            }
            else -> LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                items(s.contacts, key = { it.id }) { c -> ContactRow(c) { viewModel.openContact(c) } }
            }
        }
    }

    s.open?.let { ContactCard(it, s, viewModel) }
    if (s.addingCustomer) NewCustomerDialog(s, viewModel)
    s.history?.let { CustomerHistoryScreen(it, viewModel) }
    s.toast?.let { LaunchedEffect(it) { delay(1600); viewModel.clearToast() } }
    s.toast?.let { Toast(it) }
}

@Composable
private fun ContactRow(c: ContactDto, onClick: () -> Unit) {
    val coated = c.vehicles.count { it.isCoated }
    Row(
        Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(13.dp))
            .border(1.dp, Hairline, RoundedCornerShape(13.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).background(InsetAlt, CircleShape), contentAlignment = Alignment.Center) {
            Text(c.name.take(1).uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextSecondary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(c.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (c.isCompany) Text("COMPANY", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 8.5.sp, letterSpacing = 0.8.sp, color = TextMuted)
            }
            Text(
                listOfNotNull(c.phone, c.vehicles.takeIf { it.isNotEmpty() }?.let { "${it.size} car${if (it.size == 1) "" else "s"}" })
                    .joinToString(" · ").ifBlank { "—" },
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted,
            )
        }
        // The one fact the shop floor asks about a returning car.
        if (coated > 0) {
            Box(Modifier.background(Color(0x2212A150), RoundedCornerShape(9.dp)).padding(horizontal = 10.dp, vertical = 5.dp)) {
                Text("$coated COATED", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 0.6.sp, color = Success)
            }
        }
    }
}

@Composable
private fun ContactCard(c: ContactDto, s: ContactsState, vm: ContactsViewModel) {
    Dialog(onDismissRequest = vm::closeContact) {
        Column(
            Modifier.width(600.dp).fillMaxHeight(0.9f)
                .background(CardBg, RoundedCornerShape(18.dp)).border(1.dp, Hairline, RoundedCornerShape(18.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(c.name, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                    Text(listOfNotNull(c.phone, c.email).joinToString(" · ").ifBlank { "No contact details" },
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                }
                Box(
                    Modifier.height(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp))
                        .clickable { vm.openHistory(c) }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("History", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary) }
                Box(
                    Modifier.height(38.dp).background(AccentSoft, RoundedCornerShape(11.dp))
                        .border(1.dp, AccentLine, RoundedCornerShape(11.dp))
                        .clickable { vm.editCustomer(c) }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Edit customer", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = Accent) }
                Box(
                    Modifier.size(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp)).clickable { vm.closeContact() },
                    contentAlignment = Alignment.Center,
                ) { Text("✕", color = TextSecondary, fontSize = 15.sp) }
            }

            val retiredCount = c.vehicles.count { !it.isActive }
            val shown = c.vehicles.filter { it.isActive || s.showRetired }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("CARS", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, letterSpacing = 1.4.sp, color = TextMuted)
                Spacer(Modifier.weight(1f))
                // Retired cars are history, not the working list — out of the way but reachable.
                if (retiredCount > 0) {
                    Box(
                        Modifier.height(32.dp).border(1.dp, Hairline, RoundedCornerShape(9.dp))
                            .clickable { vm.toggleShowRetired() }.padding(horizontal = 11.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (s.showRetired) "Hide not-used" else "Show $retiredCount not-used",
                            fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = TextSecondary,
                        )
                    }
                }
                Box(
                    Modifier.height(32.dp).background(AccentSoft, RoundedCornerShape(9.dp))
                        .border(1.dp, AccentLine, RoundedCornerShape(9.dp))
                        .clickable { vm.addVehicle() }.padding(horizontal = 13.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("+ Add car", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Accent) }
            }
            if (shown.isEmpty()) {
                Text(
                    if (c.vehicles.isEmpty()) "No cars on this customer yet." else "All this customer's cars are marked not used.",
                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = TextMuted,
                )
            }
            LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                items(shown, key = { it.id }) { v ->
                    VehicleRow(v, busy = s.startingJob, onEdit = { vm.editVehicle(v) }, onStartJob = { vm.startJob(v) })
                }
            }
        }
    }

    if (s.editing != null || s.adding) VehicleDialog(s, vm)
    if (s.editingCustomer) EditCustomerDialog(c, s, vm)
}

@Composable
private fun VehicleRow(v: ContactVehicleDto, busy: Boolean, onEdit: () -> Unit, onStartJob: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(12.dp))
            .border(1.dp, if (!v.isActive) Hairline else if (v.isCoated) Color(0x5512A150) else Hairline, RoundedCornerShape(12.dp))
            .clickable(onClick = onEdit).padding(horizontal = 13.dp, vertical = 11.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) {
                Text(v.plate, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Color(0xFF151208))
            }
            Text(
                listOfNotNull(v.make, v.model, v.colour).joinToString(" ").ifBlank { "—" },
                fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                color = if (v.isActive) TextPrimary else TextMuted,
                modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (!v.isActive) {
                Box(Modifier.background(InsetAlt, RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) {
                    Text("NOT USED", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 0.7.sp, color = TextMuted)
                }
            } else if (v.isCoated) {
                Box(Modifier.background(Color(0x2212A150), RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) {
                    Text("COATED", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 0.7.sp, color = Success)
                }
            }
        }
        v.notes?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 15.sp, color = TextSecondary)
        }
        // A returning customer whose car is already on file should not be walked through
        // reception again. Retired cars get no button — that is what "not used" means.
        if (v.isActive) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier.height(38.dp).background(if (busy) InsetAlt else AccentSoft, RoundedCornerShape(10.dp))
                        .border(1.dp, AccentLine, RoundedCornerShape(10.dp))
                        .clickable(enabled = !busy, onClick = onStartJob).padding(horizontal = 15.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(if (busy) "…" else "Start job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = Accent) }
                Box(
                    Modifier.height(38.dp).border(1.dp, Hairline, RoundedCornerShape(10.dp))
                        .clickable(onClick = onEdit).padding(horizontal = 15.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Edit", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextSecondary) }
            }
        }
    }
}

/**
 * One car: what it is, whether it has been coated, anything worth remembering, and whether
 * it is still in use. Serves both adding and editing — the same fields either way.
 */
@Composable
private fun VehicleDialog(s: ContactsState, vm: ContactsViewModel) {
    val editing = s.editing
    Dialog(onDismissRequest = vm::cancelEdit) {
        Column(
            // A tablet in landscape is only ~800dp tall and the system bars take their cut, so
            // this is a FRACTION of the screen, not a fixed 660dp that overflowed on the shorter
            // one. Header and footer are fixed; the fields between them scroll.
            Modifier.width(560.dp).fillMaxHeight(0.92f)
                .background(CardBg, RoundedCornerShape(18.dp))
                .border(1.dp, Hairline, RoundedCornerShape(18.dp))
                .padding(horizontal = 22.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (s.adding) "ADD A CAR" else "EDIT CAR",
                fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp, color = TextPrimary,
            )

            // Everything from here to the footer scrolls.
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {

            MiniLabel("PLATE")
            FilledInput(
                value = s.draftPlate, onValueChange = vm::setDraftPlate,
                placeholder = "e.g. 2211 MR 23",
                modifier = Modifier.fillMaxWidth(), height = 48.dp, bg = Inset,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("MAKE")
                    PresetField(s.draftMake, vm::setDraftMake, "Hyundai", VEHICLE_MAKES, Modifier.fillMaxWidth())
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("MODEL")
                    FilledInput(s.draftModel, vm::setDraftModel, "Creta", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("COLOUR")
                    PresetField(s.draftColour, vm::setDraftColour, "Silver", VEHICLE_COLORS, Modifier.fillMaxWidth())
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("TYPE")
                    PresetField(s.draftCategory, vm::setDraftCategory, "SUV, sedan…", VEHICLE_CATEGORIES, Modifier.fillMaxWidth())
                }
            }

            // A big target: tapped with a wet or gloved hand at the bay door.
            Row(
                Modifier.fillMaxWidth().height(56.dp)
                    .background(if (s.draftCoated) AccentSoft else Inset, RoundedCornerShape(14.dp))
                    .border(if (s.draftCoated) 1.5.dp else 1.dp, if (s.draftCoated) AccentLine else Hairline, RoundedCornerShape(14.dp))
                    .clickable { vm.setDraftCoated(!s.draftCoated) }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp),
            ) {
                Box(
                    Modifier.size(26.dp)
                        .background(if (s.draftCoated) Accent else Color.Transparent, RoundedCornerShape(7.dp))
                        .border(2.dp, if (s.draftCoated) Accent else Hairline, RoundedCornerShape(7.dp)),
                    contentAlignment = Alignment.Center,
                ) { if (s.draftCoated) Text("✓", color = AccentInk, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Text("This car has been coated", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary)
            }

            MiniLabel("COMMENT")
            FilledInput(
                value = s.draftNote, onValueChange = vm::setDraftNote,
                placeholder = "Anything worth remembering about this car…",
                modifier = Modifier.fillMaxWidth().heightIn(min = 76.dp), bg = Inset,
            )

            s.error?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Danger) }

            // Retire / restore. Never a delete: jobs and invoices reference this car.
            if (editing != null) {
                Box(
                    Modifier.fillMaxWidth().height(44.dp).border(1.dp, Hairline, RoundedCornerShape(12.dp))
                        .clickable(enabled = !s.busy) { vm.setVehicleActive(editing, !editing.isActive) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (editing.isActive) "Mark as not used" else "Put back in use",
                        fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        color = if (editing.isActive) Danger else Success,
                    )
                }
                if (editing.isActive) {
                    Text(
                        "Keeps its history, hides it from pickers, and frees the plate for the car's next owner.",
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted,
                    )
                }
            }

            } // end of the scrolling region

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp)).clickable { vm.cancelEdit() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                val can = s.draftPlate.isNotBlank() && !s.busy
                Box(
                    Modifier.weight(1.6f).height(50.dp)
                        .background(if (can) Accent else InsetAlt, RoundedCornerShape(13.dp))
                        .clickable(enabled = can) { vm.saveVehicle() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (s.busy) "Saving…" else if (s.adding) "Add car" else "Save",
                        fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (can) AccentInk else TextMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun MiniLabel(t: String) =
    Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.3.sp, color = TextMuted)

/** A FilledInput with a presets dropdown (make / colour / body type) — the same quick-picks
 *  Intake's vehicle form offers. Still typeable as free text; the chevron opens the list. */
@Composable
private fun PresetField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    options: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = 46.dp,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        FilledInput(value, onChange, placeholder, Modifier.fillMaxWidth(), height = height, bg = Inset)
        Box(
            Modifier.align(Alignment.CenterEnd).height(height).width(42.dp).clickable { expanded = true },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.ArrowDropDown, "Presets", tint = TextMuted, modifier = Modifier.size(24.dp)) }
        DropdownMenu(
            expanded = expanded, onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = 340.dp).background(CardBg),
        ) {
            options.forEach { o ->
                DropdownMenuItem(
                    text = { Text(o, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 15.sp, color = TextPrimary) },
                    onClick = { onChange(o); expanded = false },
                )
            }
        }
    }
}

/**
 * Who the customer is — the same fields the web's customer dialog saves: name, phone, email,
 * address and notes, plus BRN + VAT for a company. The company flag itself is decided when the
 * customer is created (web/import) and is not flipped here.
 */
@Composable
private fun EditCustomerDialog(c: ContactDto, s: ContactsState, vm: ContactsViewModel) {
    Dialog(onDismissRequest = vm::cancelEditCustomer) {
        Column(
            Modifier.width(520.dp).background(CardBg, RoundedCornerShape(18.dp))
                .border(1.dp, Hairline, RoundedCornerShape(18.dp))
                .padding(horizontal = 22.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("EDIT CUSTOMER", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp, color = TextPrimary)
                if (c.isCompany) Text("COMPANY", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.sp, letterSpacing = 0.8.sp, color = TextMuted)
            }

            MiniLabel(if (c.isCompany) "COMPANY NAME" else "NAME")
            FilledInput(s.draftCustName, vm::setDraftCustName, if (c.isCompany) "Registered company name" else "Full name", Modifier.fillMaxWidth(), height = 48.dp, bg = Inset)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("PHONE")
                    FilledInput(s.draftCustPhone, vm::setDraftCustPhone, "+230 …", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("EMAIL")
                    FilledInput(s.draftCustEmail, vm::setDraftCustEmail, "name@email.com", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
            }
            MiniLabel("ADDRESS")
            FilledInput(s.draftCustAddress, vm::setDraftCustAddress, "Street, town", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)

            // A business also carries a BRN + VAT number — they land on its invoices.
            if (c.isCompany) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        MiniLabel("BRN")
                        FilledInput(s.draftCustBrn, vm::setDraftCustBrn, "Business reg. no.", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        MiniLabel("VAT NUMBER")
                        FilledInput(s.draftCustVat, vm::setDraftCustVat, "VAT…", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                    }
                }
            }

            MiniLabel("NOTES")
            FilledInput(s.draftCustNotes, vm::setDraftCustNotes, "Optional", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)

            s.error?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Danger) }

            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp))
                        .clickable { vm.cancelEditCustomer() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                val can = s.draftCustName.isNotBlank() && !s.busy
                Box(
                    Modifier.weight(1.5f).height(50.dp)
                        .background(if (can) Accent else InsetAlt, RoundedCornerShape(13.dp))
                        .clickable(enabled = can) { vm.saveCustomer() },
                    contentAlignment = Alignment.Center,
                ) { Text(if (s.busy) "Saving…" else "Save", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (can) AccentInk else TextMuted) }
            }
        }
    }
}

@Composable
private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
    }
}

/**
 * Add a customer from the shop floor. Individual or business — a business carries a BRN
 * and VAT number onto its invoices, so those fields exist to be filled now or later. Name
 * and phone are the only requirements; the phone is what prefills a WhatsApp quote.
 */
@Composable
private fun NewCustomerDialog(s: ContactsState, vm: ContactsViewModel) {
    Dialog(onDismissRequest = vm::cancelAddCustomer) {
        Column(
            Modifier.width(480.dp).background(CardBg, RoundedCornerShape(18.dp))
                .border(1.dp, Hairline, RoundedCornerShape(18.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("NEW CUSTOMER", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp, color = TextPrimary)

            // Individual vs business entity — the same toggle the web's customer dialog leads with.
            Row(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(11.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("Individual" to false, "Business" to true).forEach { (label, v) ->
                    val sel = s.newIsCompany == v
                    Box(
                        Modifier.weight(1f).height(40.dp)
                            .background(if (sel) CardBg else Color.Transparent, RoundedCornerShape(8.dp))
                            .border(1.dp, if (sel) Hairline else Color.Transparent, RoundedCornerShape(8.dp))
                            .clickable { vm.setNewIsCompany(v) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (sel) TextPrimary else TextMuted)
                    }
                }
            }

            FilledInput(
                s.newName, vm::setNewName,
                if (s.newIsCompany) "Registered company name" else "Full name",
                Modifier.fillMaxWidth(), height = 48.dp, bg = Inset,
            )
            FilledInput(s.newPhone, vm::setNewPhone, "Phone", Modifier.fillMaxWidth(), height = 48.dp, bg = Inset)
            FilledInput(s.newAddress, vm::setNewAddress, "Address — street, town", Modifier.fillMaxWidth(), height = 48.dp, bg = Inset)
            if (s.newIsCompany) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        MiniLabel("BRN")
                        FilledInput(s.newBrn, vm::setNewBrn, "Business reg. no.", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        MiniLabel("VAT NUMBER")
                        FilledInput(s.newVat, vm::setNewVat, "VAT…", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                    }
                }
            }
            Text(
                if (s.newIsCompany) "Their card opens next, so you can add the company car straight away."
                else "Their card opens next, so you can add the car straight away.",
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted,
            )
            s.error?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Danger) }
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(
                    Modifier.weight(1f).height(50.dp).border(1.dp, Hairline, RoundedCornerShape(13.dp))
                        .clickable { vm.cancelAddCustomer() },
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary) }
                val can = s.newName.isNotBlank() && !s.busy
                Box(
                    Modifier.weight(1.5f).height(50.dp)
                        .background(if (can) Accent else InsetAlt, RoundedCornerShape(13.dp))
                        .clickable(enabled = can) { vm.saveNewCustomer() },
                    contentAlignment = Alignment.Center,
                ) { Text(if (s.busy) "Saving…" else "Add customer", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = if (can) AccentInk else TextMuted) }
            }
        }
    }
}

/**
 * The customer's whole book of work, one screen: every job they ever had, newest first,
 * with the intake/finish photos that came with it. Opened from the contact card's
 * "History" chip — "what did we do for this person, and what did their car look like"
 * should not need a walk through Jobs and Quotes to answer.
 */
@Composable
private fun CustomerHistoryScreen(h: CustomerHistoryState, vm: ContactsViewModel) {
    val s by vm.state.collectAsState()
    var viewing by remember { mutableStateOf<HistoryPhotoUi?>(null) }
    Dialog(onDismissRequest = vm::closeHistory, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxSize().background(ScreenBg).padding(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier.size(38.dp).border(1.dp, Hairline, RoundedCornerShape(11.dp)).clickable { vm.closeHistory() },
                    contentAlignment = Alignment.Center,
                ) { Text("<", color = TextSecondary, fontSize = 16.sp, fontFamily = Barlow, fontWeight = FontWeight.Bold) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("HISTORY", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
                    Text(h.customerName, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (!h.loading) Text(
                    "${h.jobs.size} job${if (h.jobs.size == 1) "" else "s"}",
                    fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextMuted,
                )
            }

            when {
                h.loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("Loading history…", color = TextMuted, fontFamily = Barlow)
                }
                h.error != null -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(h.error, color = Danger, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                }
                h.jobs.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        "No jobs yet for ${h.customerName}.",
                        fontFamily = Barlow, fontSize = 14.sp, color = TextMuted,
                    )
                }
                else -> LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    items(h.jobs, key = { it.job.id }) { ui -> HistoryJobCard(ui, onPhoto = { viewing = it }, onOpenDoc = { vm.openDoc(it) }) }
                }
            }
        }
    }

    if (s.docLoading) {
        Dialog(onDismissRequest = {}) {
            Box(Modifier.size(140.dp).background(CardBg, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                androidx.compose.material3.CircularProgressIndicator(color = Accent)
            }
        }
    }
    s.docDetail?.let { DocumentDetailDialog(it) { vm.closeDoc() } }

    viewing?.let { p ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(
                Modifier.fillMaxSize().background(Color(0xEE10161C)).clickable { viewing = null },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(model = p.url, contentDescription = p.phase, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                Text(
                    (if (p.phase == "after") "AFTER" else "BEFORE") + (p.caption?.takeIf { it.isNotBlank() }?.let { "  ·  $it" } ?: ""),
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 30.dp),
                    fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.2.sp, color = Color.White,
                )
            }
        }
    }
}

@Composable
private fun HistoryJobCard(ui: JobHistoryUi, onPhoto: (HistoryPhotoUi) -> Unit, onOpenDoc: (String) -> Unit) {
    val j = ui.job
    Column(
        Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(13.dp))
            .border(1.dp, Hairline, RoundedCornerShape(13.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(historyDate(j.createdAt), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = TextPrimary)
            HistoryStatusChip(j.status)
            Spacer(Modifier.weight(1f))
            j.technician?.displayName?.takeIf { it.isNotBlank() }?.let {
                Text("by $it", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            j.vehicles?.plate?.let { p ->
                Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) {
                    Text(p, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = Color(0xFF151208))
                }
            }
            Text(
                listOfNotNull(j.vehicles?.make, j.vehicles?.model, j.vehicles?.colour).joinToString(" ").ifBlank { "—" },
                fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        j.notes?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        val meta = buildList {
            if (j.checklist.isNotEmpty()) add("Checklist ${j.checklist.count { it.done }}/${j.checklist.size}")
            if (j.damageMarkers.isNotEmpty()) add("⚠ ${j.damageMarkers.size} damage mark${if (j.damageMarkers.size == 1) "" else "s"}")
            j.certificates.mapNotNull { c -> c.number }.forEach { add("Cert $it") }
        }
        if (meta.isNotEmpty()) {
            Text(meta.joinToString("   ·   "), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted)
        }
        // The paper trail as two clear doors: the job's invoice(s) and the quote it
        // came from. Tap one to read the actual document — lines, totals, payments.
        // The quote ALSO rides the invoices embed (it carries job_id once accepted),
        // so it is filtered out there — it has its own button.
        val quote = j.sourceQuote?.takeIf { it.id != null }
        val papers = j.invoices.filter { it.docType != "quote" }
        if (papers.isNotEmpty() || quote != null) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                papers.forEach { inv ->
                    HistoryDocButton(
                        "${if (inv.docType == "credit_note") "Credit note" else "Invoice"} ${inv.number ?: ""} · Rs ${money(inv.totalIncl)}".trim(),
                        filled = true,
                        onClick = { onOpenDoc(inv.id) },
                    )
                }
                quote?.let { q ->
                    HistoryDocButton("Quote ${q.number ?: ""}".trim(), filled = false, onClick = { onOpenDoc(q.id!!) })
                }
            }
        }
        if (ui.photos.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                ui.photos.forEach { p ->
                    Box(
                        Modifier.size(92.dp).background(Inset, RoundedCornerShape(10.dp))
                            .border(1.dp, Hairline, RoundedCornerShape(10.dp))
                            .clickable { onPhoto(p) },
                    ) {
                        AsyncImage(model = p.url, contentDescription = p.phase, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Text(
                            if (p.phase == "after") "AFTER" else "BEFORE",
                            Modifier.align(Alignment.BottomStart).padding(4.dp)
                                .background(Color(0xB310161C), RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 2.dp),
                            fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 8.sp, letterSpacing = 0.6.sp, color = Color.White,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryStatusChip(status: String) {
    val (bg, fg, label) = when (status) {
        "delivered" -> Triple(Color(0x221FA361), Success, "DELIVERED")
        "ready" -> Triple(Color(0x22C17A00), Warning, "READY")
        "in_progress" -> Triple(AccentSoft, Accent, "IN PROGRESS")
        "cancelled" -> Triple(Color(0x22D63A3A), Danger, "CANCELLED")
        "scheduled" -> Triple(InsetAlt, TextSecondary, "SCHEDULED")
        else -> Triple(InsetAlt, TextSecondary, status.uppercase())
    }
    Box(Modifier.background(bg, RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) {
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 9.5.sp, letterSpacing = 0.7.sp, color = fg)
    }
}

private fun historyDate(iso: String?): String = runCatching {
    java.time.OffsetDateTime.parse(iso).format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy"))
}.getOrDefault("")

/** A document button on a history card — the same shape as the car row's Start job / Edit:
 *  filled accent for the money document (invoice), outline for its quote. */
@Composable
private fun HistoryDocButton(label: String, filled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.height(38.dp).background(if (filled) AccentSoft else CardBg, RoundedCornerShape(10.dp))
            .border(1.dp, if (filled) AccentLine else Hairline, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).padding(horizontal = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label, fontFamily = Barlow,
            fontWeight = if (filled) FontWeight.Bold else FontWeight.SemiBold,
            fontSize = 12.5.sp,
            color = if (filled) Accent else TextSecondary,
        )
    }
}

private fun money(v: Double): String = "%,.2f".format(java.util.Locale.ENGLISH, v)

/**
 * The document behind a history ref: who it was for, every line with its price, and where
 * the money stands. Read-only — this is the record, not an editor.
 */
@Composable
private fun DocumentDetailDialog(doc: mu.carfection.pos.core.network.SaleHistoryDto, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Column(
            Modifier.width(560.dp).fillMaxHeight(0.88f)
                .background(CardBg, RoundedCornerShape(18.dp)).border(1.dp, Hairline, RoundedCornerShape(18.dp))
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text(
                    (when (doc.docType) { "quote" -> "QUOTE"; "credit_note" -> "CREDIT NOTE"; else -> "INVOICE" }) + "  ${doc.number ?: ""}",
                    fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = 1.sp, color = TextPrimary,
                    modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                HistoryStatusChip(if (doc.status == "paid" || doc.status == "partly_paid") doc.status else if (doc.docType == "quote") doc.status else "issued")
                Box(Modifier.size(34.dp).border(1.dp, Hairline, RoundedCornerShape(10.dp)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Text("✕", color = TextSecondary, fontSize = 13.sp)
                }
            }
            Text(
                listOfNotNull(
                    doc.customers?.name,
                    doc.issuedAt?.let { historyDate(it) },
                    doc.creator?.displayName?.let { "by $it" },
                ).joinToString("  ·  ").ifBlank { "—" },
                fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted,
            )

            // Lines scroll; header and money stay put.
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                doc.lines.sortedBy { it.sortOrder }.forEach { l ->
                    Column(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                l.title, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = TextPrimary,
                                modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis,
                            )
                            Text("Rs ${money(l.lineTotalExcl + l.lineVat)}", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = TextPrimary)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${l.qty} × Rs ${money(l.unitPrice)}", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted)
                            if (l.discountPct > 0) Text("−${l.discountPct}%", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = Danger)
                        }
                    }
                }
                if (doc.lines.isEmpty()) Text("No lines on this document.", fontFamily = Barlow, fontSize = 12.5.sp, color = TextMuted)
            }

            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MoneyRow("VAT", doc.vatTotal)
                MoneyRow("TOTAL", doc.totalIncl, bold = true)
                MoneyRow("Paid", doc.amountPaid)
                val balance = doc.totalIncl - doc.amountPaid
                if (balance > 0.005 && doc.docType != "quote") MoneyRow("Balance", balance, color = Warning)
                doc.payments.filter { it.reversesPaymentId == null }.forEach { p ->
                    Text(
                        "${p.method.replaceFirstChar { it.uppercase() }}  Rs ${money(p.amount)}",
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = TextMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun MoneyRow(label: String, value: Double, bold: Boolean = false, color: Color = TextSecondary) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, fontFamily = Barlow, fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium, fontSize = if (bold) 14.sp else 12.5.sp, color = if (bold) TextPrimary else color)
        Spacer(Modifier.weight(1f))
        Text("Rs ${money(value)}", fontFamily = Mono, fontWeight = if (bold) FontWeight.Bold else FontWeight.SemiBold, fontSize = if (bold) 14.sp else 12.5.sp, color = if (bold) TextPrimary else color)
    }
}
