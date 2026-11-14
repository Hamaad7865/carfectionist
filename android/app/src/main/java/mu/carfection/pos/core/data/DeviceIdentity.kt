package mu.carfection.pos.core.data

import java.security.MessageDigest
import java.util.UUID

/**
 * How a tablet names itself to the back office ("TAB-84A1").
 *
 * 2026-11-14: the code used to be a RANDOM value kept only in app storage. The till's
 * storage was wiped overnight, so it minted a new code — two, since two callers raced the
 * empty store — and the owner saw two "new tablets" nobody had bought, with the till's
 * cash flow split across three codes.
 *
 * Now the code is DERIVED from the Android ID, which survives an uninstall or "clear
 * storage" (it only changes on a factory reset, or if the app's signing key changes): the
 * same tablet always comes back as the same code. A code already stored is kept as-is, so
 * existing tablets don't change code on update. The hashed Android ID also goes to the
 * server as the tablet's hardware fingerprint, which links any code change to the same
 * device so its history never splits again.
 */
object DeviceIdentity {
    /**
     * A broken Android 2.2 build returned this same ID on many devices. It is not unique,
     * so it must never be used to recognise a tablet.
     */
    private const val BROKEN_ANDROID_ID = "9774d56d682e549c"

    /** SHA-256 hex of the Android ID, or null when the platform gave nothing trustworthy. */
    fun hardwareId(androidId: String?): String? {
        val id = androidId?.trim()?.lowercase()
        if (id.isNullOrEmpty() || id == BROKEN_ANDROID_ID || id.all { it == '0' }) return null
        return MessageDigest.getInstance("SHA-256")
            .digest("carfection-device:$id".toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    /**
     * The code for a tablet with no stored one: stable when a fingerprint exists, random
     * otherwise. Six hex digits (the old random codes had four): a derived code that
     * happened to equal another tablet's existing code would silently merge two tablets.
     */
    fun codeFor(hardwareId: String?): String =
        "TAB-" + (hardwareId ?: UUID.randomUUID().toString().replace("-", "")).take(6).uppercase()
}
