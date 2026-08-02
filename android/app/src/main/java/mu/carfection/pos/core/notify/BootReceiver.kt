package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import mu.carfection.pos.MainActivity

/**
 * Alarms do not survive a reboot — Android drops every one of them. A tablet that loses
 * power at lunch would otherwise wake up with a board full of jobs it will never mention
 * again, so re-arm from the server the moment we are back.
 *
 * Also fires on MY_PACKAGE_REPLACED: installing a new APK clears alarms just as thoroughly.
 *
 * The re-arm itself is RearmAlarmsWorker's job; holding the boot broadcast open for a
 * network round trip is the ANR risk this receiver used to carry.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            intent.action != QUICKBOOT_POWERON
        ) return

        // The tablet IS the till: when the counter powers on, bring the POS up with it so
        // nobody has to hunt for the icon. Android 10+ may refuse a background activity
        // start, so this is best-effort — setting the app as the tablet's Home app is the
        // guaranteed route. Re-arming the alarms below happens either way.
        //
        // This stays in the receiver: it is a background activity start riding the boot
        // broadcast, and would simply be blocked from a worker.
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            runCatching {
                context.startActivity(
                    Intent(context, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                )
            }
        }

        RearmAlarmsWorker.enqueue(context)
    }

    private companion object {
        /** Some OEMs (and fast-boot tablets) send this instead of BOOT_COMPLETED. */
        const val QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
    }
}
