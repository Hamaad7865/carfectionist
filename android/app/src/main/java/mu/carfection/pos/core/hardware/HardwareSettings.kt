package mu.carfection.pos.core.hardware

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** How the receipt printer is attached to this tablet. */
enum class PrinterLink { NONE, BLUETOOTH, USB, NETWORK }

/** How barcodes get into the app. WEDGE = a USB/Bluetooth scanner that types like a keyboard. */
enum class ScannerMode { OFF, WEDGE, CAMERA }

/**
 * Per-device peripheral config, chosen on the Settings screen. Lives in DataStore, not the
 * shared DB — the printer on this tablet is nobody else's business. The real ESC/POS
 * transport reads this when it lands; until then LogPrinter/LogDrawer honour the seams.
 */
data class HardwareConfig(
    val printerLink: PrinterLink = PrinterLink.NONE,
    val printerBtAddress: String = "",
    val printerIp: String = "",
    val printerPort: Int = 9100,
    val paperWidthMm: Int = 80, // 58 or 80
    val drawerKickEnabled: Boolean = true,
    val scannerMode: ScannerMode = ScannerMode.WEDGE,
)

@Singleton
class HardwareSettings @Inject constructor(private val prefs: DataStore<Preferences>) {
    private val kLink = stringPreferencesKey("hw_printer_link")
    private val kBt = stringPreferencesKey("hw_printer_bt")
    private val kIp = stringPreferencesKey("hw_printer_ip")
    private val kPort = intPreferencesKey("hw_printer_port")
    private val kPaper = intPreferencesKey("hw_paper_mm")
    private val kKick = booleanPreferencesKey("hw_drawer_kick")
    private val kScan = stringPreferencesKey("hw_scanner_mode")

    val config: Flow<HardwareConfig> = prefs.data.map { p ->
        HardwareConfig(
            printerLink = p[kLink]?.let { v -> PrinterLink.entries.firstOrNull { it.name == v } } ?: PrinterLink.NONE,
            printerBtAddress = p[kBt] ?: "",
            printerIp = p[kIp] ?: "",
            printerPort = p[kPort] ?: 9100,
            paperWidthMm = p[kPaper] ?: 80,
            drawerKickEnabled = p[kKick] ?: true,
            scannerMode = p[kScan]?.let { v -> ScannerMode.entries.firstOrNull { it.name == v } } ?: ScannerMode.WEDGE,
        )
    }

    suspend fun save(c: HardwareConfig) = prefs.edit { p ->
        p[kLink] = c.printerLink.name
        p[kBt] = c.printerBtAddress
        p[kIp] = c.printerIp
        p[kPort] = c.printerPort
        p[kPaper] = c.paperWidthMm
        p[kKick] = c.drawerKickEnabled
        p[kScan] = c.scannerMode.name
    }
}
