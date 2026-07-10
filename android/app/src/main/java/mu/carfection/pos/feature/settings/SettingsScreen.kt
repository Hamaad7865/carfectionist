package mu.carfection.pos.feature.settings

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.carfection.pos.core.hardware.CashDrawer
import mu.carfection.pos.core.hardware.HardwareConfig
import mu.carfection.pos.core.hardware.HardwareSettings
import mu.carfection.pos.core.hardware.PrinterLink
import mu.carfection.pos.core.hardware.ReceiptPrinter
import mu.carfection.pos.core.hardware.ScannerMode
import mu.carfection.pos.ui.FilledInput
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
import mu.carfection.pos.ui.theme.TextMuted
import mu.carfection.pos.ui.theme.TextPrimary
import mu.carfection.pos.ui.theme.TextSecondary
import javax.inject.Inject

data class SettingsUiState(
    val cfg: HardwareConfig = HardwareConfig(),
    val loaded: Boolean = false,
    val toast: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val hw: HardwareSettings,
    private val printer: ReceiptPrinter,
    private val drawer: CashDrawer,
) : ViewModel() {
    private val _s = MutableStateFlow(SettingsUiState())
    val state = _s.asStateFlow()

    init {
        viewModelScope.launch { hw.config.collect { c -> _s.update { it.copy(cfg = c, loaded = true) } } }
    }

    /** Edits apply immediately — a till has no "save" ritual. */
    fun change(f: (HardwareConfig) -> HardwareConfig) {
        val next = f(_s.value.cfg)
        _s.update { it.copy(cfg = next) }
        viewModelScope.launch { hw.save(next) }
    }

    fun testPrint() = viewModelScope.launch {
        val c = _s.value.cfg
        printer.printReceipt(testSlip(c))
        _s.update {
            it.copy(
                toast = if (c.printerLink == PrinterLink.NONE) "Printed to the device log — no printer linked yet"
                else "Test receipt sent to the printer",
            )
        }
    }

    fun testKick() = viewModelScope.launch {
        drawer.kick()
        _s.update { it.copy(toast = "Drawer kick sent") }
    }

    fun clearToast() = _s.update { it.copy(toast = null) }

    private fun testSlip(c: HardwareConfig): String {
        val w = if (c.paperWidthMm == 58) 32 else 48
        fun center(s: String) = " ".repeat(((w - s.length) / 2).coerceAtLeast(0)) + s
        return buildString {
            appendLine(center("CARFECTIONIST"))
            appendLine(center("printer test"))
            appendLine("-".repeat(w))
            appendLine("Link: ${c.printerLink.name.lowercase()}  Paper: ${c.paperWidthMm}mm")
            appendLine(center("0123456789 ABCDEFGHIJ"))
            appendLine("-".repeat(w))
        }
    }
}

@Composable
fun SettingsScreen(viewModel: SettingsViewModel = hiltViewModel()) {
    val s by viewModel.state.collectAsState()
    val c = s.cfg

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("DEVICE SETTINGS", fontFamily = Condensed, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 1.5.sp, color = TextPrimary)
                Text("Printer · cash drawer · barcode scanner — this tablet only", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = TextMuted)
            }

            Column(Modifier.widthIn(max = 860.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // ── receipt printer ────────────────────────────────────────────
                SettingsCard("RECEIPT PRINTER") {
                    FieldLabel("CONNECTION")
                    ChipRow(
                        options = listOf(
                            PrinterLink.NONE to "Not linked",
                            PrinterLink.BLUETOOTH to "Bluetooth",
                            PrinterLink.USB to "USB",
                            PrinterLink.NETWORK to "Network",
                        ),
                        selected = c.printerLink,
                        onSelect = { link -> viewModel.change { it.copy(printerLink = link) } },
                    )
                    // Field text lives in local state and is committed outward — feeding it back
                    // from the persisted flow drops keystrokes typed between recompositions.
                    when (c.printerLink) {
                        PrinterLink.BLUETOOTH -> {
                            FieldLabel("PRINTER BLUETOOTH ADDRESS")
                            var bt by remember(s.loaded) { mutableStateOf(c.printerBtAddress) }
                            FilledInput(
                                value = bt,
                                onValueChange = { v ->
                                    val t = v.uppercase()
                                    bt = t
                                    viewModel.change { it.copy(printerBtAddress = t) }
                                },
                                placeholder = "e.g. 00:11:62:AB:CD:EF",
                                modifier = Modifier.fillMaxWidth(), bg = Inset,
                            )
                        }
                        PrinterLink.NETWORK -> {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                    FieldLabel("PRINTER IP ADDRESS")
                                    var ip by remember(s.loaded) { mutableStateOf(c.printerIp) }
                                    FilledInput(
                                        value = ip,
                                        onValueChange = { v ->
                                            val t = v.filter { ch -> ch.isDigit() || ch == '.' }
                                            ip = t
                                            viewModel.change { it.copy(printerIp = t) }
                                        },
                                        placeholder = "e.g. 192.168.100.50",
                                        modifier = Modifier.fillMaxWidth(), bg = Inset,
                                    )
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                    FieldLabel("PORT")
                                    var port by remember(s.loaded) { mutableStateOf(c.printerPort.toString()) }
                                    FilledInput(
                                        value = port,
                                        onValueChange = { v ->
                                            val t = v.filter { ch -> ch.isDigit() }.take(5)
                                            port = t
                                            viewModel.change { it.copy(printerPort = t.toIntOrNull() ?: 9100) }
                                        },
                                        placeholder = "9100",
                                        modifier = Modifier.fillMaxWidth(), bg = Inset,
                                    )
                                }
                            }
                        }
                        else -> Unit
                    }
                    FieldLabel("PAPER WIDTH")
                    ChipRow(
                        options = listOf(58 to "58 mm", 80 to "80 mm"),
                        selected = c.paperWidthMm,
                        onSelect = { mm -> viewModel.change { it.copy(paperWidthMm = mm) } },
                    )
                    if (c.printerLink == PrinterLink.NONE) {
                        Hint("Receipts print to the device log until a printer is linked.")
                    }
                    ActionBtn("Print test receipt") { viewModel.testPrint() }
                }

                // ── cash drawer ────────────────────────────────────────────────
                SettingsCard("CASH DRAWER") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Kick the drawer open on cash payments", fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary)
                            Text("Fires an ESC p pulse through the receipt printer's drawer port.", fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = TextMuted)
                        }
                        Toggle(on = c.drawerKickEnabled) { on -> viewModel.change { it.copy(drawerKickEnabled = on) } }
                    }
                    ActionBtn("Test drawer kick") { viewModel.testKick() }
                }

                // ── barcode scanner ────────────────────────────────────────────
                SettingsCard("BARCODE SCANNER") {
                    FieldLabel("MODE")
                    ChipRow(
                        options = listOf(
                            ScannerMode.OFF to "Off",
                            ScannerMode.WEDGE to "USB / Bluetooth scanner",
                        ),
                        selected = c.scannerMode,
                        onSelect = { m -> viewModel.change { it.copy(scannerMode = m) } },
                    )
                    Hint(
                        if (c.scannerMode == ScannerMode.WEDGE)
                            "A keyboard-wedge scanner types into the checkout search box — scan a product's barcode with the search focused and it filters instantly."
                        else "Scanning is off — products are found by name in the checkout search.",
                    )
                }
            }
        }
        s.toast?.let { LaunchedEffect(it) { delay(2200); viewModel.clearToast() } }
        s.toast?.let { Toast(it) }
    }
}

// ── building blocks, in the app's card language ────────────────────────────────
@Composable
private fun SettingsCard(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(CardBg, RoundedCornerShape(16.dp)).border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.4.sp, color = TextMuted)
        content()
    }
}

@Composable
private fun FieldLabel(t: String) =
    Text(t, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp, color = TextMuted, modifier = Modifier.padding(top = 2.dp))

@Composable
private fun Hint(t: String) =
    Text(t, fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, color = TextMuted)

@Composable
private fun <T> ChipRow(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                Modifier.height(40.dp)
                    .background(if (on) AccentSoft else InsetAlt, RoundedCornerShape(11.dp))
                    .border(if (on) 1.5.dp else 1.dp, if (on) AccentLine else Hairline, RoundedCornerShape(11.dp))
                    .clickable { onSelect(value) }
                    .padding(horizontal = 15.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (on) Accent else TextSecondary) }
        }
    }
}

@Composable
private fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) {
    Box(
        Modifier.width(52.dp).height(30.dp)
            .background(if (on) Accent else InsetAlt, RoundedCornerShape(15.dp))
            .border(1.dp, if (on) Accent else Hairline, RoundedCornerShape(15.dp))
            .clickable { onChange(!on) }
            .padding(3.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) { Box(Modifier.size(24.dp).background(Color.White, CircleShape)) }
}

@Composable
private fun ActionBtn(text: String, onClick: () -> Unit) {
    Box(
        Modifier.height(46.dp).border(1.dp, AccentLine, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = Accent) }
}

@Composable
private fun Toast(msg: String) = Box(Modifier.fillMaxSize().padding(bottom = 28.dp), contentAlignment = Alignment.BottomCenter) {
    Box(Modifier.background(Color(0xF01B2733), RoundedCornerShape(11.dp)).padding(horizontal = 20.dp, vertical = 13.dp)) {
        Text(msg, fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = Color.White)
    }
}
