package mu.carfection.pos.feature.intake

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.automirrored.outlined.Assignment
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.TireRepair
import androidx.compose.material.icons.outlined.TripOrigin
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.LocalPhotoCapture
import mu.carfection.pos.ui.newCaptureFile
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.AccentInk
import mu.carfection.pos.ui.theme.AccentLine
import mu.carfection.pos.ui.theme.AccentSoft
import mu.carfection.pos.ui.theme.Barlow
import mu.carfection.pos.ui.theme.CardBg
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

private val TcPanelShape = RoundedCornerShape(18.dp)
private val TcDark = Color(0xFF17233D)
private val TcDarkInset = Color(0xFF142039)
private val TcDarkSoft = Color(0xFFFFFFFF).copy(alpha = 0.07f)
private val TcDarkLine = Color(0xFFFFFFFF).copy(alpha = 0.12f)
private val TcDarkMuted = Color(0xFFA9B5CC)
private val TcDarkFaint = Color(0xFF8FA0BA)
private val SheetShape = RoundedCornerShape(topStart = 28.dp, bottomStart = 28.dp)

@Composable
internal fun TyreIntakeScreen(
    state: IntakeState,
    viewModel: IntakeViewModel,
    onStartQuote: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().imePadding().padding(horizontal = 18.dp, vertical = 15.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            IntakeHeading(state, viewModel)
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                if (maxWidth >= 1080.dp) {
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Column(
                            Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                                verticalAlignment = Alignment.Top,
                            ) {
                                CustomerStep(state, viewModel, Modifier.weight(1f))
                                VehicleStep(state, viewModel, Modifier.weight(1f))
                            }
                            WorkRequestStep(state, viewModel)
                            state.error?.let { IntakeError(it) }
                        }
                        IntakeSummary(state, viewModel, onStartQuote, Modifier.width(350.dp).fillMaxHeight())
                    }
                } else {
                    Column(
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        CustomerStep(state, viewModel)
                        VehicleStep(state, viewModel)
                        WorkRequestStep(state, viewModel)
                        state.error?.let { IntakeError(it) }
                        IntakeSummary(state, viewModel, onStartQuote, Modifier.fillMaxWidth().height(660.dp))
                    }
                }
            }
        }

        when {
            state.newCustOpen -> NewCustomerSideSheet(state, viewModel)
            state.addVehOpen -> NewVehicleSideSheet(state, viewModel)
        }
    }
}

@Composable
private fun IntakeHeading(state: IntakeState, vm: IntakeViewModel) {
    Row(Modifier.fillMaxWidth().height(68.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
        Modifier.size(52.dp)
            .shadow(5.dp, RoundedCornerShape(16.dp), clip = false, ambientColor = Color(0x18101A24), spotColor = Color(0x28101A24))
            .background(CardBg, RoundedCornerShape(16.dp))
            .border(1.dp, Hairline, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Outlined.Assignment, null, tint = Accent, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text(
                    "NEW VEHICLE INTAKE",
                    fontFamily = Barlow,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 27.sp,
                    color = TextPrimary,
                )
                StatusPill("WALK-IN", AccentSoft, Accent)
            }
            Text(
                "Capture the customer, vehicle and requested work before opening the quotation.",
                fontFamily = Barlow,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                color = TextMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        val hasDraft = state.customer != null || state.query.isNotBlank() || state.picked.isNotEmpty()
        if (hasDraft) {
            Box(
                Modifier.height(44.dp).background(CardBg, RoundedCornerShape(12.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(11.dp))
                    .clickable { vm.reset() }.padding(horizontal = 13.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Filled.Close, null, tint = TextSecondary, modifier = Modifier.size(15.dp))
                    Text("Clear intake", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = TextSecondary)
                }
            }
        }
    }
}

@Composable
private fun CustomerStep(s: IntakeState, vm: IntakeViewModel, modifier: Modifier = Modifier) {
    TcPanel(modifier) {
        PanelHeader(1, "Customer", "Who are we checking in?", Icons.Outlined.Person) {
            s.customer?.let { StatusPill("MATCHED", Color(0xFFEAF8F1), Success) }
        }
        if (s.customer != null) {
            SelectedCustomer(s, vm)
        } else {
            Row(
                Modifier.fillMaxWidth().height(52.dp).background(InsetAlt, RoundedCornerShape(14.dp)).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Segment(
                    "Existing",
                    selected = !s.newCustOpen,
                    icon = Icons.Outlined.History,
                    modifier = Modifier.weight(1f),
                ) { if (s.newCustOpen) vm.toggleNewCust() }
                Segment(
                    "New customer",
                    selected = s.newCustOpen,
                    icon = Icons.Outlined.Person,
                    modifier = Modifier.weight(1f),
                ) { if (!s.newCustOpen) vm.toggleNewCust() }
            }
            FilledInput(
                value = s.query,
                onValueChange = vm::setQuery,
                placeholder = if (s.searching) "Searching…" else "Search name, phone or plate…",
                modifier = Modifier.fillMaxWidth(),
                height = 52.dp,
                radius = 12.dp,
                bg = Inset,
                leadingSearch = true,
                fontSize = 15.sp,
            )
            if (s.results.isEmpty() && s.query.trim().length >= 2 && !s.searching) {
                EmptyInline("No customer found. Add a new customer or refine the search.")
            } else {
                s.results.take(3).forEach { customer ->
                    Row(
                        Modifier.fillMaxWidth().background(Color(0xFFF7F9FC), RoundedCornerShape(12.dp))
                            .border(1.dp, Hairline, RoundedCornerShape(12.dp))
                            .clickable { vm.pickCustomer(customer) }
                            .padding(horizontal = 12.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(11.dp),
                    ) {
                        Avatar(customer.name)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(customer.name, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(customer.phone ?: "No phone on file", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextMuted)
                        }
                        Text("Choose", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = Accent)
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectedCustomer(s: IntakeState, vm: IntakeViewModel) {
    val customer = s.customer ?: return
    Row(
        Modifier.fillMaxWidth().background(AccentSoft, RoundedCornerShape(14.dp))
            .border(1.dp, AccentLine, RoundedCornerShape(14.dp))
            .padding(13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Avatar(customer.name, size = 44.dp, large = true)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(customer.name, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Outlined.Phone, null, tint = TextMuted, modifier = Modifier.size(13.dp))
                Text(customer.phone ?: "No phone", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary)
            }
        }
        Box(
            Modifier.height(44.dp).background(CardBg, RoundedCornerShape(12.dp))
                .border(1.dp, Hairline, RoundedCornerShape(12.dp))
                .clickable { vm.clearCustomer() }.padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("Change", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = Accent)
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        StatusPill("Existing customer", InsetAlt, TextSecondary)
        s.vehicles.size.takeIf { it > 0 }?.let {
            StatusPill("$it vehicle${if (it == 1) "" else "s"} on file", InsetAlt, TextSecondary)
        }
    }
}

@Composable
private fun NewCustomerSideSheet(s: IntakeState, vm: IntakeViewModel) {
    IntakeSideSheet(
        title = "NEW CUSTOMER",
        subtitle = "Add the contact without losing the current intake.",
        icon = Icons.Outlined.Person,
        busy = s.busy,
        onDismiss = vm::toggleNewCust,
        content = {
            NewCustomerFormBody(s, vm)
            s.error?.let { IntakeError(it) }
        },
        actions = {
            SecondaryAction("Cancel", Modifier.weight(1f), h = 56.dp) { if (!s.busy) vm.toggleNewCust() }
            PrimaryAction(
                if (s.busy) "Checking customer…" else "Save customer",
                Modifier.weight(1.55f),
                h = 56.dp,
                enabled = !s.busy,
            ) { vm.saveNewCustomer() }
        },
    )
}

@Composable
private fun NewVehicleSideSheet(s: IntakeState, vm: IntakeViewModel) {
    IntakeSideSheet(
        title = "NEW VEHICLE",
        subtitle = "Add the incoming vehicle without moving the intake cards.",
        icon = Icons.Outlined.DirectionsCar,
        busy = s.busy,
        onDismiss = vm::toggleAddVeh,
        content = {
            NewVehicleFormBody(s, vm)
            s.error?.let { IntakeError(it) }
        },
        actions = {
            SecondaryAction("Cancel", Modifier.weight(1f), h = 56.dp) { if (!s.busy) vm.toggleAddVeh() }
            PrimaryAction(
                if (s.busy) "Saving vehicle…" else "Save vehicle",
                Modifier.weight(1.55f),
                h = 56.dp,
                enabled = !s.busy && s.nvPlate.isNotBlank(),
            ) { vm.saveVehicle(singleSelection = true) }
        },
    )
}

@Composable
private fun IntakeSideSheet(
    title: String,
    subtitle: String,
    icon: ImageVector,
    busy: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
    actions: @Composable RowScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = !busy, dismissOnClickOutside = !busy),
    ) {
        Box(
            Modifier.fillMaxSize().imePadding().background(Color(0x9E0C1424)).clickable(enabled = !busy) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            BoxWithConstraints(
                Modifier.fillMaxSize().navigationBarsPadding().padding(start = 16.dp, top = 18.dp, end = 18.dp, bottom = 18.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                val sheetFraction = if (maxWidth >= 760.dp) 0.44f else 0.92f
                Column(
                    Modifier.fillMaxHeight().fillMaxWidth(sheetFraction).widthIn(max = 620.dp)
                        .shadow(28.dp, SheetShape, clip = false, ambientColor = Color(0x66101A24), spotColor = Color(0x88101A24))
                        .clip(SheetShape)
                        .background(CardBg)
                        .clickable(onClick = {}),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 28.dp, top = 26.dp, end = 24.dp, bottom = 22.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(52.dp).background(AccentSoft, RoundedCornerShape(16.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(icon, null, tint = Accent, modifier = Modifier.size(26.dp))
                        }
                        Spacer(Modifier.width(15.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(title, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, color = TextPrimary)
                            Text(subtitle, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextMuted)
                        }
                        Box(
                            Modifier.size(48.dp).background(Inset, RoundedCornerShape(14.dp))
                                .clickable(enabled = !busy, onClick = onDismiss),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Filled.Close, "Close", tint = TextSecondary, modifier = Modifier.size(21.dp))
                        }
                    }
                    Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
                    Column(
                        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                            .padding(horizontal = 28.dp, vertical = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        content()
                    }
                    Box(Modifier.height(1.dp).fillMaxWidth().background(Hairline))
                    Row(
                        Modifier.fillMaxWidth().background(Color(0xFFF8FAFC))
                            .padding(horizontal = 28.dp, vertical = 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        actions()
                    }
                }
            }
        }
    }
}

@Composable
private fun NewCustomerFormBody(s: IntakeState, vm: IntakeViewModel) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            Modifier.fillMaxWidth().height(54.dp).background(InsetAlt, RoundedCornerShape(14.dp)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Segment("Individual", !s.nIsCompany, modifier = Modifier.weight(1f)) { vm.setNIsCompany(false) }
            Segment("Business", s.nIsCompany, modifier = Modifier.weight(1f)) { vm.setNIsCompany(true) }
        }
        TyreField("FULL NAME", s.nName, vm::setNName, if (s.nIsCompany) "Company name" else "Customer name")
        TyreField("MOBILE", s.nPhone, vm::setNPhone, "5xxx xxxx", keyboard = KeyboardType.Phone)
        if (s.nIsCompany) {
            TyreField("EMAIL", s.nEmail, vm::setNEmail, "accounts@example.mu", keyboard = KeyboardType.Email)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TyreField("BRN", s.nBrn, vm::setNBrn, "BRN", Modifier.weight(1f))
                TyreField("VAT", s.nVat, vm::setNVat, "VAT no.", Modifier.weight(1f))
            }
            TyreField("ADDRESS", s.nAddress, vm::setNAddress, "Business address")
        }
        s.existingCustomer?.let { existing ->
            Column(
                Modifier.fillMaxWidth().background(AccentSoft, RoundedCornerShape(14.dp))
                    .border(1.dp, AccentLine, RoundedCornerShape(14.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Text("ALREADY ON FILE", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, color = Accent)
                Text(existing.name, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, color = TextPrimary)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryAction("Different person", Modifier.weight(1f)) { vm.createAnyway() }
                    PrimaryAction("Use this customer", Modifier.weight(1.35f), enabled = !s.busy) { vm.useExistingCustomer() }
                }
            }
        }
    }
}

@Composable
private fun NewVehicleFormBody(s: IntakeState, vm: IntakeViewModel) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TyreField("REGISTRATION", s.nvPlate, vm::setNvPlate, "2087 JL 25", Modifier.weight(1f))
            TyreField("MAKE", s.nvMake, vm::setNvMake, "Toyota", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TyreField("MODEL / YEAR", s.nvModel, vm::setNvModel, "Yaris · 2020", Modifier.weight(1f))
            TyreField("COLOUR", s.nvColour, vm::setNvColour, "Silver", Modifier.weight(1f))
        }
        TyreField("BODY TYPE", s.nvCategory, vm::setNvCategory, "Sedan, SUV, pickup…")
        s.plateTaken?.let { holder ->
            Column(
                Modifier.fillMaxWidth().background(AccentSoft, RoundedCornerShape(14.dp))
                    .border(1.dp, AccentLine, RoundedCornerShape(14.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Text("THIS PLATE IS ALREADY REGISTERED", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, color = Accent)
                Text("${holder.vehicle.plate} · ${holder.customer.name}", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = TextPrimary)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryAction("Cancel", Modifier.weight(1f)) { vm.dismissPlateTaken() }
                    PrimaryAction("Use registered car", Modifier.weight(1.55f), enabled = !s.busy) { vm.usePlateHolder() }
                }
            }
        }
    }
}

@Composable
private fun VehicleStep(s: IntakeState, vm: IntakeViewModel, modifier: Modifier = Modifier) {
    TcPanel(modifier.alpha(if (s.customer == null) 0.58f else 1f)) {
        PanelHeader(2, "Vehicle", "Verify the vehicle details", Icons.Outlined.DirectionsCar) {
            if (s.customer != null && !s.addVehOpen) {
                CompactAction("+ Add vehicle") { vm.toggleAddVeh() }
            }
        }
        if (s.customer == null) {
            EmptyInline("Select a customer first. Their saved vehicles will appear here.")
        } else {
            if (s.vehicles.isEmpty() && !s.addVehOpen) {
                EmptyInline("No vehicles on file yet. Add the incoming vehicle.")
            }
            s.vehicles.forEach { vehicle ->
                val selected = s.picked.any { it.id == vehicle.id }
                Row(
                    Modifier.fillMaxWidth().background(if (selected) AccentSoft else Inset, RoundedCornerShape(13.dp))
                        .border(if (selected) 1.5.dp else 1.dp, if (selected) AccentLine else Hairline, RoundedCornerShape(13.dp))
                        .clickable { vm.toggleTyreVehicle(vehicle) }
                        .padding(11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CheckBox(selected)
                    Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                        Text(vehicle.plate, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Color(0xFF151208))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(listOfNotNull(vehicle.make, vehicle.model).joinToString(" ").ifBlank { "Vehicle" }, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        vehicle.colour?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextMuted) }
                    }
                }
            }
            if (!s.addVehOpen && s.picked.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TyreField(
                        "ODOMETER",
                        s.odometer,
                        vm::setOdometer,
                        "84,320",
                        Modifier.weight(1f),
                        keyboard = KeyboardType.Number,
                    )
                    VehiclePhotoAction(s, vm, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun VehiclePhotoAction(s: IntakeState, vm: IntakeViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val capture = LocalPhotoCapture.current
    fun launch() {
        val launcher = capture ?: return
        val (file, uri) = newCaptureFile(context)
        vm.beginCapture(file)
        launcher.launch(uri)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launch()
    }
    val enabled = s.vehicle != null && !s.photoUploading
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        FieldLabel("CONDITION PHOTO")
        Box(
            Modifier.fillMaxWidth().height(52.dp).background(CardBg, RoundedCornerShape(13.dp))
                .border(1.dp, Hairline, RoundedCornerShape(13.dp))
                .alpha(if (enabled) 1f else 0.5f)
                .clickable(enabled = enabled) {
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launch()
                    else permission.launch(Manifest.permission.CAMERA)
                }
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Icon(Icons.Outlined.CameraAlt, null, tint = Accent, modifier = Modifier.size(17.dp))
                Text(
                    when {
                        s.photoUploading -> "Uploading…"
                        s.photoPaths.isNotEmpty() -> "${s.photoPaths.size} photo${if (s.photoPaths.size == 1) "" else "s"} added"
                        else -> "Add optional photo"
                    },
                    fontFamily = Barlow,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun WorkRequestStep(s: IntakeState, vm: IntakeViewModel) {
    TcPanel(Modifier.fillMaxWidth()) {
        PanelHeader(3, "Work requested", "Tap one or more services", Icons.Outlined.Build) {
            StatusPill("FAST INTAKE", Color(0xFFFFF6E8), Warning)
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ServiceTile(
                TyreIntakeService.REPLACEMENT,
                Icons.Outlined.TireRepair,
                "Fit / change tyres",
                s.tyreServices.contains(TyreIntakeService.REPLACEMENT),
            ) { vm.toggleTyreService(TyreIntakeService.REPLACEMENT) }
            ServiceTile(
                TyreIntakeService.PUNCTURE,
                Icons.Outlined.TripOrigin,
                "Inspect & repair",
                s.tyreServices.contains(TyreIntakeService.PUNCTURE),
            ) { vm.toggleTyreService(TyreIntakeService.PUNCTURE) }
            ServiceTile(
                TyreIntakeService.BALANCING,
                Icons.Outlined.Speed,
                "Vibration check",
                s.tyreServices.contains(TyreIntakeService.BALANCING),
            ) { vm.toggleTyreService(TyreIntakeService.BALANCING) }
            ServiceTile(
                TyreIntakeService.ALIGNMENT,
                Icons.Outlined.Build,
                "Steering / wear",
                s.tyreServices.contains(TyreIntakeService.ALIGNMENT),
            ) { vm.toggleTyreService(TyreIntakeService.ALIGNMENT) }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
            TyreField("TYRE SIZE", s.tyreSize, vm::setTyreSize, "185/65 R14", Modifier.weight(1.35f))
            Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                FieldLabel("WHEEL POSITION")
                Row(Modifier.fillMaxWidth().height(52.dp).background(Inset, RoundedCornerShape(12.dp)).padding(3.dp)) {
                    WheelPosition.entries.forEach { position ->
                        WheelChoice(position, position == s.wheelPosition, Modifier.weight(1f)) { vm.setWheelPosition(position) }
                    }
                }
            }
            Column(Modifier.width(145.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                FieldLabel("QUANTITY")
                Row(
                    Modifier.fillMaxWidth().height(52.dp).background(Inset, RoundedCornerShape(12.dp))
                        .padding(horizontal = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    IconButton(Icons.Outlined.Remove, "Reduce quantity", enabled = s.tyreQuantity > 1) { vm.changeTyreQuantity(-1) }
                    Text(s.tyreQuantity.toString(), fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = TextPrimary)
                    IconButton(Icons.Outlined.Add, "Increase quantity", filled = true, enabled = s.tyreQuantity < 8) { vm.changeTyreQuantity(1) }
                }
            }
            Column(Modifier.width(150.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                FieldLabel("PRIORITY")
                Row(Modifier.fillMaxWidth().height(52.dp).background(Inset, RoundedCornerShape(12.dp)).padding(3.dp)) {
                    IntakePriority.entries.forEach { priority ->
                        WheelChoice(priority.label, priority == s.priority, Modifier.weight(1f)) { vm.setPriority(priority) }
                    }
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                FieldLabel("CUSTOMER CONCERN")
                Spacer(Modifier.weight(1f))
                Text("${s.concern.length}/320", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextMuted)
            }
            MultilineEntry(s.concern, vm::setConcern, "Vibration, noise, uneven wear, requested brand…")
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.clickable { vm.toggleKeysReceived() },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CheckBox(s.keysReceived)
                Icon(Icons.Outlined.VpnKey, null, tint = if (s.keysReceived) Accent else TextMuted, modifier = Modifier.size(16.dp))
                Text("Keys received", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, color = TextPrimary)
            }
            Spacer(Modifier.weight(1f))
            Text(
                "The request is saved with the quotation draft.",
                fontFamily = Barlow,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = TextMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun IntakeSummary(
    s: IntakeState,
    vm: IntakeViewModel,
    onStartQuote: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .shadow(14.dp, RoundedCornerShape(22.dp), clip = false, ambientColor = Color(0x2A101A24), spotColor = Color(0x42101A24))
            .clip(RoundedCornerShape(22.dp))
            .background(TcDark),
    ) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(15.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Intake summary", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Color.White)
                        Text("Live · ${if (s.canStartTyreIntake) "ready for quote" else "draft"}", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TcDarkMuted)
                    }
                    StatusPill("LIVE", TcDarkSoft, Color(0xFFD7E4FF), border = false)
                }
                VehicleSummaryCard(s)
            }
            Box(Modifier.height(1.dp).fillMaxWidth().background(TcDarkLine))
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                CustomerSummary(s)
                Box(Modifier.height(1.dp).fillMaxWidth().background(TcDarkLine))
                RequestSummary(s)
                Box(Modifier.height(1.dp).fillMaxWidth().background(TcDarkLine))
                Readiness(s)
            }
        }
        Column(
            Modifier.fillMaxWidth().background(TcDarkInset).padding(horizontal = 24.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Schedule, null, tint = TcDarkFaint, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text("Next step", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TcDarkFaint)
                Spacer(Modifier.weight(1f))
                Text("Quotation", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = Color(0xFFDCE6F6))
            }
            Box(
                Modifier.fillMaxWidth().height(58.dp).background(if (s.canStartTyreIntake) Accent else TcDarkSoft, RoundedCornerShape(14.dp))
                    .clickable(enabled = s.canStartTyreIntake) { if (vm.startQuotation()) onStartQuote() },
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Start quotation", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = if (s.canStartTyreIntake) AccentInk else TcDarkMuted)
                    Text("→", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 19.sp, color = if (s.canStartTyreIntake) AccentInk else TcDarkMuted)
                }
            }
            Text(
                if (s.canStartTyreIntake) "All required details are ready." else summaryMissing(s),
                Modifier.align(Alignment.CenterHorizontally),
                fontFamily = Barlow,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                color = TcDarkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun VehicleSummaryCard(s: IntakeState) {
    val vehicle = s.vehicle
    Row(
        Modifier.fillMaxWidth()        .background(TcDarkSoft, RoundedCornerShape(16.dp))
        .border(1.dp, TcDarkLine, RoundedCornerShape(16.dp)).padding(17.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Box(Modifier.size(40.dp).background(Accent, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.DirectionsCar, null, tint = Color.White, modifier = Modifier.size(21.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(vehicle?.plate ?: "No vehicle selected", fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = if (vehicle == null) 14.sp else 18.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                vehicle?.let { listOfNotNull(it.make, it.model).joinToString(" ").ifBlank { "Vehicle" } } ?: "Choose a saved or new vehicle",
                fontFamily = Barlow,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                color = TcDarkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (s.odometer.isNotBlank()) Text("${s.odometer} km", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TcDarkFaint)
        }
    }
}

@Composable
private fun CustomerSummary(s: IntakeState) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(s.customer?.name ?: "?", size = 36.dp, dark = true)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(s.customer?.name ?: "Customer not selected", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(s.customer?.phone ?: "Search an existing customer", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TcDarkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.Outlined.Phone, null, tint = TcDarkFaint, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun RequestSummary(s: IntakeState) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DarkLabel("WORK REQUESTED")
            Spacer(Modifier.weight(1f))
            Text("${s.tyreServices.size} service${if (s.tyreServices.size == 1) "" else "s"}", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TcDarkFaint)
        }
        if (s.tyreServices.isEmpty()) {
            Text("Tap a service in the work request panel.", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TcDarkMuted)
        } else {
            s.tyreServices.forEach { service ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Box(Modifier.size(28.dp).background(Color(0xFF337CFF).copy(alpha = 0.18f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.TireRepair, null, tint = Color(0xFF77A9FF), modifier = Modifier.size(15.dp))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(service.label, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = Color.White)
                        val detail = buildList {
                            if (service == TyreIntakeService.REPLACEMENT && s.tyreSize.isNotBlank()) add(s.tyreSize)
                            add(s.wheelPosition.label)
                            add("Qty ${s.tyreQuantity}")
                        }.joinToString(" · ")
                        Text(detail, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = TcDarkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        s.concern.takeIf { it.isNotBlank() }?.let {
            Row(
                Modifier.fillMaxWidth().background(Color(0xFFF59E0B).copy(alpha = 0.10f), RoundedCornerShape(9.dp))
                    .border(1.dp, Color(0xFFF59E0B).copy(alpha = 0.16f), RoundedCornerShape(9.dp))
                    .padding(horizontal = 9.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Note: $it", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 15.sp, color = Color(0xFFF9C873), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Readiness(s: IntakeState) {
    val vehicleReady = s.picked.isNotEmpty()
    val detailReady = s.tyreServices.isNotEmpty() && (TyreIntakeService.REPLACEMENT !in s.tyreServices || s.tyreSize.trim().isNotBlank())
    val checks = listOf(
        "Customer verified" to (s.customer != null),
        "Vehicle selected" to vehicleReady,
        "Work requested" to detailReady,
        "Ready to quote" to s.canStartTyreIntake,
    )
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DarkLabel("READINESS")
            Spacer(Modifier.weight(1f))
            Text("${checks.count { it.second }} / ${checks.size}", fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 12.5.sp, color = Color(0xFF75D8AB))
        }
        checks.forEach { (label, ready) -> DarkCheck(label, ready) }
    }
}

@Composable
private fun DarkCheck(label: String, ready: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        Box(Modifier.size(17.dp).background(if (ready) Color(0xFF1C6F55) else TcDarkSoft, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
            if (ready) Icon(Icons.Filled.Check, null, tint = Color(0xFF81E1B7), modifier = Modifier.size(10.dp))
        }
        Text(label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, color = if (ready) Color(0xFFC9D4E6) else TcDarkFaint)
    }
}

@Composable
private fun ServiceTile(service: TyreIntakeService, icon: ImageVector, caption: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.width(196.dp).height(104.dp)
            .shadow(if (selected) 5.dp else 2.dp, RoundedCornerShape(16.dp), clip = false, ambientColor = Color(0x16101A24), spotColor = Color(0x24101A24))
            .background(if (selected) AccentSoft else CardBg, RoundedCornerShape(16.dp))
            .border(if (selected) 1.5.dp else 1.dp, if (selected) Accent else Hairline, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(42.dp).background(if (selected) Accent else InsetAlt, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (selected) AccentInk else TextSecondary, modifier = Modifier.size(19.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(service.label, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, color = TextPrimary, maxLines = 2, lineHeight = 17.sp)
            Text(caption, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        CheckBox(selected, size = 17.dp)
    }
}

@Composable
private fun TcPanel(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth()
            .shadow(4.dp, TcPanelShape, clip = false, ambientColor = Color(0x12101A24), spotColor = Color(0x20101A24))
            .background(CardBg, TcPanelShape)
            .border(1.dp, Hairline, TcPanelShape)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

@Composable
private fun PanelHeader(step: Int, title: String, caption: String, icon: ImageVector, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).background(AccentSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Accent, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("$step".padStart(2, '0'), fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = Accent)
                Text(title, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = TextPrimary)
            }
            Text(caption, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextMuted)
        }
        trailing()
    }
}

@Composable
private fun TyreField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        FieldLabel(label)
        FilledInput(
            value = value,
            onValueChange = onValueChange,
            placeholder = placeholder,
            modifier = Modifier.fillMaxWidth(),
            height = 52.dp,
            radius = 12.dp,
            bg = CardBg,
            fontSize = 15.sp,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        )
    }
}

@Composable
private fun MultilineEntry(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).background(CardBg, RoundedCornerShape(12.dp))
            .border(1.dp, Hairline, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        textStyle = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp, color = TextPrimary),
        cursorBrush = SolidColor(Accent),
        maxLines = 3,
    ) { inner ->
        Box {
            if (value.isEmpty()) Text(placeholder, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp, color = TextMuted)
            inner()
        }
    }
}

@Composable
private fun Segment(label: String, selected: Boolean, icon: ImageVector? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.fillMaxHeight()
            .shadow(if (selected) 2.dp else 0.dp, RoundedCornerShape(10.dp), clip = false, ambientColor = Color(0x14101A24), spotColor = Color(0x1F101A24))
            .background(if (selected) CardBg else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            icon?.let {
                Icon(it, null, tint = if (selected) Accent else TextMuted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(
                label,
                fontFamily = Barlow,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 13.sp,
                lineHeight = 16.sp,
                textAlign = TextAlign.Center,
                color = if (selected) Accent else TextMuted,
            )
        }
    }
}

@Composable
private fun WheelChoice(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.fillMaxHeight()
            .shadow(if (selected) 3.dp else 0.dp, RoundedCornerShape(10.dp), clip = false, ambientColor = Color(0x24101A24), spotColor = Color(0x33101A24))
            .background(if (selected) Accent else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = Barlow,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 12.sp,
            lineHeight = 14.sp,
            textAlign = TextAlign.Center,
            color = if (selected) AccentInk else TextSecondary,
            maxLines = 1,
        )
    }
}

@Composable
private fun WheelChoice(position: WheelPosition, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    WheelChoice(if (position == WheelPosition.ALL) "All 4" else position.label, selected, modifier, onClick)
}

@Composable
private fun CheckBox(selected: Boolean, size: Dp = 20.dp) {
    Box(
        Modifier.size(size).background(if (selected) Accent else CardBg, RoundedCornerShape(6.dp))
            .border(if (selected) 0.dp else 1.2.dp, if (selected) Color.Transparent else Color(0xFFB7C0CC), RoundedCornerShape(6.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Icon(Icons.Filled.Check, null, tint = AccentInk, modifier = Modifier.size(size * 0.58f))
    }
}

@Composable
private fun IconButton(icon: ImageVector, description: String, filled: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).background(if (filled) Accent else CardBg, RoundedCornerShape(11.dp))
            .border(if (filled) 0.dp else 1.dp, if (filled) Color.Transparent else Hairline, RoundedCornerShape(11.dp))
            .alpha(if (enabled) 1f else 0.45f).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = if (filled) AccentInk else TextSecondary, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun CompactAction(text: String, onClick: () -> Unit) {
    Box(
        Modifier.height(44.dp).background(AccentSoft, RoundedCornerShape(11.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, lineHeight = 14.sp, textAlign = TextAlign.Center, color = Accent)
    }
}

@Composable
private fun PrimaryAction(text: String, modifier: Modifier = Modifier, h: Dp = 48.dp, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.height(h)
            .shadow(if (enabled) 5.dp else 0.dp, RoundedCornerShape(13.dp), clip = false, ambientColor = Color(0x202B8CFF), spotColor = Color(0x382B8CFF))
            .background(if (enabled) Accent else InsetAlt, RoundedCornerShape(13.dp))
            .padding(horizontal = 18.dp)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, lineHeight = 17.sp, textAlign = TextAlign.Center, color = if (enabled) AccentInk else TextMuted)
    }
}

@Composable
private fun SecondaryAction(text: String, modifier: Modifier = Modifier, h: Dp = 48.dp, onClick: () -> Unit) {
    Box(
        modifier.height(h).background(CardBg, RoundedCornerShape(13.dp))
            .border(1.dp, Hairline, RoundedCornerShape(13.dp))
            .padding(horizontal = 18.dp)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 17.sp, textAlign = TextAlign.Center, color = TextSecondary)
    }
}

@Composable
private fun StatusPill(text: String, bg: Color, ink: Color, border: Boolean = true) {
    Box(
        Modifier.height(30.dp).background(bg, RoundedCornerShape(9.dp))
            .then(if (border) Modifier.border(1.dp, ink.copy(alpha = 0.14f), RoundedCornerShape(9.dp)) else Modifier)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            fontFamily = Barlow,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 11.5.sp,
            lineHeight = 14.sp,
            letterSpacing = 0.25.sp,
            textAlign = TextAlign.Center,
            color = ink,
        )
    }
}

@Composable
private fun Avatar(name: String, size: Dp = 38.dp, large: Boolean = false, dark: Boolean = false) {
    Box(
        Modifier.size(size).background(if (dark) Color(0xFFE4EEFF) else AccentSoft, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(name.trim().take(1).uppercase().ifBlank { "?" }, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = if (large) 16.sp else 14.sp, textAlign = TextAlign.Center, color = if (dark) Color(0xFF1769E8) else Accent)
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 11.5.sp, lineHeight = 14.sp, letterSpacing = 0.5.sp, color = TextMuted)
}

@Composable
private fun DarkLabel(text: String) {
    Text(text, fontFamily = Barlow, fontWeight = FontWeight.ExtraBold, fontSize = 11.5.sp, lineHeight = 14.sp, letterSpacing = 0.7.sp, color = TcDarkFaint)
}

@Composable
private fun EmptyInline(text: String) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).background(Inset, RoundedCornerShape(11.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp, color = TextMuted)
    }
}

@Composable
private fun IntakeError(message: String) {
    Row(
        Modifier.fillMaxWidth().background(Color(0xFFFFF0F1), RoundedCornerShape(12.dp))
            .border(1.dp, Color(0x4DD63A3A), RoundedCornerShape(12.dp)).padding(horizontal = 13.dp, vertical = 11.dp),
    ) {
        Text(message, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp, color = Color(0xFFB42339))
    }
}

private fun summaryMissing(s: IntakeState): String = when {
    s.customer == null -> "Select a customer to continue."
    s.picked.isEmpty() -> "Select a vehicle to continue."
    s.tyreServices.isEmpty() -> "Select at least one requested service."
    TyreIntakeService.REPLACEMENT in s.tyreServices && s.tyreSize.isBlank() -> "Enter the tyre size."
    else -> "Complete the intake details."
}
