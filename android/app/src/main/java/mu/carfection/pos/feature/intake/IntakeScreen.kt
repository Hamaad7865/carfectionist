package mu.carfection.pos.feature.intake

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import mu.carfection.pos.ui.theme.Danger
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import mu.carfection.pos.ui.FilledInput
import mu.carfection.pos.ui.LocalPhotoCapture
import mu.carfection.pos.ui.newCaptureFile
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
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary

private val CardShape = RoundedCornerShape(16.dp)
private fun Modifier.card() = this.background(CardBg, CardShape).border(1.dp, Hairline, CardShape)

private val secLabel = 11.sp

@Composable
fun IntakeScreen(onStartQuote: () -> Unit, viewModel: IntakeViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize().padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // title row
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("RECEPTION · INTAKE", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
            Text("Customer → vehicle → condition → quotation", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
        }

        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // LEFT 46fr — customer + vehicle. Scrolls: the expanded new-customer (business) and
            // new-vehicle (with preset chip rows) forms can exceed the column height.
            Column(Modifier.weight(46f).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CustomerCard(s, viewModel)
                VehicleCard(s, viewModel)
            }
            // RIGHT 54fr — condition & damage
            ConditionCard(s, viewModel, Modifier.weight(54f).fillMaxHeight())
        }

        // footer
        Row(Modifier.fillMaxWidth().card().padding(start = 18.dp, top = 11.dp, end = 12.dp, bottom = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(viewModel.summary(s), Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val ready = s.customer != null && s.vehicle != null && !s.photoUploading
            Box(
                Modifier.height(54.dp).background(if (ready) Accent else InsetAlt, RoundedCornerShape(13.dp))
                    .clickable(enabled = ready) { if (viewModel.startQuotation()) onStartQuote() }
                    .padding(horizontal = 30.dp),
                contentAlignment = Alignment.Center,
            ) { Text("Start quotation →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 16.5.sp, letterSpacing = 0.3.sp, color = if (ready) AccentInk else TextMuted) }
        }
    }
}

@Composable
private fun CustomerCard(s: IntakeState, vm: IntakeViewModel) {
    Column(Modifier.fillMaxWidth().card().padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(Modifier.fillMaxWidth().height(34.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("CUSTOMER", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = secLabel, letterSpacing = 1.6.sp, color = TextMuted)
            Spacer(Modifier.weight(1f))
            if (s.customer != null) OutlineBtn("Change") { vm.clearCustomer() }
        }
        if (s.customer == null) {
            FilledInput(s.query, vm::setQuery, "Search name, phone or plate…", Modifier.fillMaxWidth(), height = 52.dp, radius = 12.dp, bg = Inset, fontSize = 16.sp, leadingSearch = true)
            s.results.forEach { r ->
                Row(Modifier.fillMaxWidth().background(Color(0xFFF1F4F7), RoundedCornerShape(12.dp)).border(1.dp, Color(0x12101A24), RoundedCornerShape(12.dp)).clickable { vm.pickCustomer(r) }.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(38.dp).background(Color(0xFFDDE4EB), CircleShape), contentAlignment = Alignment.Center) { Text(r.name.take(1).uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = TextSecondary) }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(r.name, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(r.phone ?: "—", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, color = TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (!s.newCustOpen) {
                Box(Modifier.fillMaxWidth().height(46.dp).border(1.5.dp, Color(0x40101A24), RoundedCornerShape(12.dp)).clickable { vm.toggleNewCust() }, contentAlignment = Alignment.Center) {
                    Text("+ New customer", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextSecondary)
                }
            } else {
                Column(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(13.dp)).border(1.dp, Color(0x17101A24), RoundedCornerShape(13.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    // Individual vs business entity — a business also carries email, address, BRN + VAT.
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SegBtn("Individual", !s.nIsCompany, Modifier.weight(1f)) { vm.setNIsCompany(false) }
                        SegBtn("Business", s.nIsCompany, Modifier.weight(1f)) { vm.setNIsCompany(true) }
                    }
                    FormInput(s.nName, vm::setNName, if (s.nIsCompany) "Company name" else "Full name")
                    FormInput(s.nPhone, vm::setNPhone, "Mobile — 5xxx xxxx")
                    if (s.nIsCompany) {
                        FormInput(s.nEmail, vm::setNEmail, "Email")
                        FormInput(s.nAddress, vm::setNAddress, "Address")
                        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            FormInput(s.nBrn, vm::setNBrn, "BRN", Modifier.weight(1f))
                            FormInput(s.nVat, vm::setNVat, "VAT no.", Modifier.weight(1f))
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlineBtn("Cancel", Modifier.weight(1f), 46.dp) { vm.toggleNewCust() }
                        FillBtn("Save customer", Modifier.weight(2f)) { vm.saveNewCustomer() }
                    }
                }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                Box(Modifier.size(46.dp).background(AccentSoft, CircleShape).border(1.dp, AccentLine, CircleShape), contentAlignment = Alignment.Center) { Text(s.customer.name.take(1).uppercase(), fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Accent) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(s.customer.name, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary)
                    Text(s.customer.phone ?: "—", fontFamily = Mono, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextSecondary)
                }
            }
        }
    }
}

@Composable
private fun VehicleCard(s: IntakeState, vm: IntakeViewModel) {
    val enabled = s.customer != null
    Column(Modifier.fillMaxWidth().card().padding(horizontal = 16.dp, vertical = 14.dp).alpha(if (enabled) 1f else 0.5f), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(Modifier.fillMaxWidth().height(34.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("VEHICLE", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = secLabel, letterSpacing = 1.6.sp, color = TextMuted)
            Spacer(Modifier.weight(1f))
            if (enabled && !s.addVehOpen) OutlineBtn("+ Add vehicle") { vm.toggleAddVeh() }
        }
        s.vehicles.forEach { v ->
            val sel = v.id == s.vehicle?.id
            Row(Modifier.fillMaxWidth().background(if (sel) AccentSoft else Color(0xFFF1F4F7), RoundedCornerShape(12.dp)).border(if (sel) 1.5.dp else 1.dp, if (sel) AccentLine else Color(0x12101A24), RoundedCornerShape(12.dp)).clickable(enabled = enabled) { vm.pickVehicle(v) }.padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.background(Plate, RoundedCornerShape(5.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) { Text(v.plate, fontFamily = Mono, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, letterSpacing = 0.5.sp, color = Color(0xFF151208)) }
                Text(listOfNotNull(v.make, v.model).joinToString(" ").ifBlank { "Vehicle" }, Modifier.weight(1f), fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                v.colour?.let { Text(it, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted) }
            }
        }
        if (s.addVehOpen) {
            Column(Modifier.fillMaxWidth().background(Inset, RoundedCornerShape(13.dp)).border(1.dp, Color(0x17101A24), RoundedCornerShape(13.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    FormInput(s.nvPlate, vm::setNvPlate, "Plate — 2087 JL 25", Modifier.weight(1f), mono = true)
                    PresetField(s.nvMake, vm::setNvMake, "Make", VEHICLE_MAKES, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    FormInput(s.nvModel, vm::setNvModel, "Model", Modifier.weight(1f))
                    PresetField(s.nvColour, vm::setNvColour, "Colour", VEHICLE_COLORS, Modifier.weight(1f))
                }
                PresetField(s.nvCategory, vm::setNvCategory, "Body type — SUV, Sedan…", VEHICLE_CATEGORIES)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlineBtn("Cancel", Modifier.weight(1f), 46.dp) { vm.toggleAddVeh() }
                    FillBtn("Save vehicle", Modifier.weight(2f)) { vm.saveVehicle() }
                }
            }
        }
        s.error?.let { Text(it, color = mu.carfection.pos.ui.theme.Danger, fontSize = 12.sp) }
    }
}

@Composable
private fun ConditionCard(s: IntakeState, vm: IntakeViewModel, modifier: Modifier) {
    Column(modifier.card().padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("CONDITION & DAMAGE", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = secLabel, letterSpacing = 1.6.sp, color = TextMuted)
            Spacer(Modifier.weight(1f))
            if (s.markers.isNotEmpty()) {
                Box(
                    Modifier.height(30.dp).background(Color(0x14D63A3A), RoundedCornerShape(15.dp)).clickable { vm.clearMarkers() }.padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Clear all", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = Danger) }
                Spacer(Modifier.width(8.dp))
            }
            CountBadge("${s.markers.size} marked")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            DamageType.entries.forEach { t ->
                val sel = t == s.markerType
                Row(Modifier.height(38.dp).background(if (sel) AccentSoft else InsetAlt, RoundedCornerShape(19.dp)).border(if (sel) 1.5.dp else 1.dp, if (sel) AccentLine else Hairline, RoundedCornerShape(19.dp)).clickable { vm.setMarkerType(t) }.padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Box(Modifier.size(9.dp).background(t.color, CircleShape))
                    Text(t.label, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = TextPrimary)
                }
            }
        }
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            DamageDiagram(
                markers = s.markers, onTap = vm::addMarker, onRemove = vm::removeMarker,
                modifier = Modifier.fillMaxHeight().aspectRatio(260f / 520f),
            )
            Column(Modifier.width(172.dp).fillMaxHeight(), verticalArrangement = Arrangement.Bottom) {
                Text("Tap the diagram to mark pre-existing damage. Tap a marker to remove it.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 18.sp, color = TextMuted)
                Spacer(Modifier.height(12.dp))
                Text("PHOTOS", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = secLabel, letterSpacing = 1.6.sp, color = TextMuted)
                Spacer(Modifier.height(8.dp))
                // camera launcher lives on the Activity (survives the camera round-trip);
                // this column only starts the capture and renders the thumbnails
                val ctx = LocalContext.current
                val launcher = LocalPhotoCapture.current
                fun fire() {
                    val l = launcher ?: return
                    val (file, uri) = newCaptureFile(ctx)
                    vm.beginCapture(file)
                    l.launch(uri)
                }
                val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) fire() }
                if (s.photoPaths.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        s.photoPaths.forEach { p ->
                            Box(Modifier.size(50.dp).clip(RoundedCornerShape(9.dp)).background(Inset).border(1.dp, Hairline, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
                                val url = s.photoUrls[p]
                                if (url != null) AsyncImage(model = url, contentDescription = "Intake photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                                else Text("…", color = TextMuted, fontSize = 12.sp)
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                val canAdd = s.vehicle != null && !s.photoUploading
                Box(
                    Modifier.fillMaxWidth().height(58.dp).border(1.5.dp, Color(0x40101A24), RoundedCornerShape(10.dp))
                        .alpha(if (canAdd) 1f else 0.45f)
                        .clickable(enabled = canAdd) {
                            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) fire()
                            else permission.launch(Manifest.permission.CAMERA)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (s.photoUploading) "UPLOADING…" else if (s.vehicle == null) "＋ ADD (pick a vehicle)" else "＋ ADD",
                        fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, letterSpacing = 0.5.sp, color = TextSecondary,
                    )
                }
            }
        }
    }
}

// ── small shared bits ─────────────────────────────────────────────────────────
@Composable private fun CountBadge(text: String) {
    Box(Modifier.height(26.dp).background(InsetAlt, RoundedCornerShape(13.dp)).padding(horizontal = 11.dp), contentAlignment = Alignment.Center) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = TextSecondary) }
}
@Composable private fun OutlineBtn(text: String, modifier: Modifier = Modifier, h: androidx.compose.ui.unit.Dp = 34.dp, onClick: () -> Unit) {
    Box(modifier.height(h).border(1.dp, Color(0x2E101A24), RoundedCornerShape(if (h > 40.dp) 11.dp else 9.dp)).clickable(onClick = onClick).padding(horizontal = 13.dp), contentAlignment = Alignment.Center) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = if (h > 40.dp) 14.sp else 12.5.sp, color = TextSecondary) }
}
@Composable private fun FillBtn(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.height(46.dp).background(Accent, RoundedCornerShape(11.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, color = AccentInk) }
}
@Composable private fun FormInput(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, mono: Boolean = false) {
    FilledInput(value, onChange, placeholder, modifier.fillMaxWidth(), height = 48.dp, radius = 11.dp, bg = CardBg, fontFamily = if (mono) Mono else Barlow, fontSize = if (mono) 14.5.sp else 15.sp)
}

/** A two-option segmented button (Individual / Business). */
@Composable private fun SegBtn(text: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(42.dp).background(if (selected) AccentSoft else InsetAlt, RoundedCornerShape(10.dp)).border(if (selected) 1.5.dp else 1.dp, if (selected) AccentLine else Hairline, RoundedCornerShape(10.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = if (selected) Accent else TextSecondary) }
}

/** A text field with a dropdown of preset values (make / colour / body type). Typeable as free
 *  text; the chevron opens the presets to pick — a dropdown, not a scrolling chip row. */
@Composable private fun PresetField(value: String, onChange: (String) -> Unit, placeholder: String, options: List<String>, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        FormInput(value, onChange, placeholder)
        Box(
            Modifier.align(Alignment.CenterEnd).height(48.dp).width(42.dp).clickable { expanded = true },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.ArrowDropDown, "Presets", tint = TextMuted, modifier = Modifier.size(24.dp)) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, modifier = Modifier.heightIn(max = 340.dp).background(CardBg)) {
            options.forEach { o ->
                DropdownMenuItem(
                    text = { Text(o, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 15.sp, color = TextPrimary) },
                    onClick = { onChange(o); expanded = false },
                )
            }
        }
    }
}
