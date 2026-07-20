package mu.carfection.pos.core.hardware

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * ESC/POS over a USB cable. The studio's printer keeps its LAN cable plugged into
 * the Cashmag terminal (a private wired island our tablet cannot route into), so
 * this tablet reaches the SAME printer through its second interface — thermal
 * printers accept USB and Ethernet jobs side by side.
 *
 * Bytes are built exactly as for the network path; only the pipe differs.
 */
@Singleton
class UsbEscPos @Inject constructor(@ApplicationContext private val context: Context) {

    private val usb get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

    /** The printer on the cable, or null. Printer class first; vendor-class bulk-out as fallback
     *  (many ESC/POS boards enumerate as vendor-specific) — HID devices (the barcode scanner,
     *  keyboards) are never candidates. */
    fun findPrinter(): UsbDevice? {
        val devices = usb.deviceList.values
        devices.firstOrNull { d -> (0 until d.interfaceCount).any { d.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_PRINTER } }
            ?.let { return it }
        return devices.firstOrNull { d ->
            (0 until d.interfaceCount).any { i ->
                val itf = d.getInterface(i)
                itf.interfaceClass != UsbConstants.USB_CLASS_HID && bulkOut(itf) != null
            }
        }
    }

    private fun bulkOut(itf: UsbInterface): UsbEndpoint? {
        for (e in 0 until itf.endpointCount) {
            val ep = itf.getEndpoint(e)
            if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) return ep
        }
        return null
    }

    /** Push [bytes] to the cabled printer. Throws with a human sentence when it can't. */
    suspend fun send(bytes: ByteArray) = withContext(Dispatchers.IO) {
        val device = findPrinter()
            ?: throw IOException("No USB printer found — check the USB cable between the tablet and the printer")
        if (!usb.hasPermission(device)) {
            if (!requestPermission(device)) {
                throw IOException("USB access not allowed — tap Allow on the tablet's dialog, then print again")
            }
        }

        val pair = (0 until device.interfaceCount)
            .map { device.getInterface(it) }
            .sortedBy { if (it.interfaceClass == UsbConstants.USB_CLASS_PRINTER) 0 else 1 }
            .firstNotNullOfOrNull { itf -> bulkOut(itf)?.let { itf to it } }
            ?: throw IOException("That USB device doesn't accept print jobs")
        val (itf, endpoint) = pair

        val conn = usb.openDevice(device) ?: throw IOException("Couldn't open the USB printer")
        try {
            if (!conn.claimInterface(itf, true)) throw IOException("The USB printer is busy")
            var off = 0
            while (off < bytes.size) {
                val len = minOf(CHUNK, bytes.size - off)
                // A thermal head pauses the buffer while it prints — generous per-chunk timeout.
                val sent = conn.bulkTransfer(endpoint, bytes, off, len, 8_000)
                if (sent < 0) throw IOException("USB write failed mid-receipt — check the printer")
                off += sent
            }
        } finally {
            runCatching { conn.releaseInterface(itf) }
            conn.close()
        }
    }

    /** Ask the human. Resolves when they answer the system dialog (or false on timeout/deny). */
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private suspend fun requestPermission(device: UsbDevice): Boolean =
        withTimeoutOrNull(60_000) {
            suspendCancellableCoroutine { cont ->
                val action = "${context.packageName}.USB_PERMISSION"
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(c: Context, intent: Intent) {
                        runCatching { context.unregisterReceiver(this) }
                        cont.resume(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
                } else {
                    context.registerReceiver(receiver, IntentFilter(action))
                }
                val pi = PendingIntent.getBroadcast(
                    context, 0,
                    Intent(action).setPackage(context.packageName),
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                usb.requestPermission(device, pi)
                cont.invokeOnCancellation { runCatching { context.unregisterReceiver(receiver) } }
            }
        } ?: false

    private companion object {
        const val CHUNK = 16_384
    }
}
