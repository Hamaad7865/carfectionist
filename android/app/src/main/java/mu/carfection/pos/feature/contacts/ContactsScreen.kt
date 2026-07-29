package mu.carfection.pos.feature.contacts

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
import mu.carfection.pos.core.network.ContactDto
import mu.carfection.pos.core.network.ContactVehicleDto
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
import mu.carfection.pos.ui.theme.Success
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary

/**
 * Contacts on the shop floor: who the customer is, what they drive, and — the question this
 * studio actually asks — whether that car has been coated, with anything worth remembering.
 */
@Composable
fun ContactsScreen(viewModel: ContactsViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()

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
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(c.name, fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = TextPrimary)
                    Text(listOfNotNull(c.phone, c.email).joinToString(" · ").ifBlank { "No contact details" },
                        fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
                }
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
                    FilledInput(s.draftMake, vm::setDraftMake, "Hyundai", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("MODEL")
                    FilledInput(s.draftModel, vm::setDraftModel, "Creta", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("COLOUR")
                    FilledInput(s.draftColour, vm::setDraftColour, "Silver", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MiniLabel("TYPE")
                    FilledInput(s.draftCategory, vm::setDraftCategory, "SUV, sedan…", Modifier.fillMaxWidth(), height = 46.dp, bg = Inset)
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

@Composable
private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, color = Color.White, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp)
    }
}

/**
 * Add a customer from the shop floor. Name and phone only — the phone because it is what
 * prefills a WhatsApp quote, and everything else can be filled in on their card afterwards.
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
            FilledInput(s.newName, vm::setNewName, "Full name", Modifier.fillMaxWidth(), height = 48.dp, bg = Inset)
            FilledInput(s.newPhone, vm::setNewPhone, "Phone", Modifier.fillMaxWidth(), height = 48.dp, bg = Inset)
            Text(
                "Their card opens next, so you can add the car straight away.",
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
