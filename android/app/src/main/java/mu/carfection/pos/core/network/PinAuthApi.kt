package mu.carfection.pos.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mu.carfection.pos.BuildConfig
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class RosterEntry(
    val appUserId: String,
    val displayName: String,
    val role: String,
    /**
     * The server-minted offline sign-in verifier ([mu.carfection.pos.core.data.PinHasher]
     * format), when the server has one. Never the server's bcrypt hash. Null from servers
     * predating verifiers and for staff whose PIN hasn't been set or used since.
     */
    val verifier: String? = null,
)

@Serializable
private data class RosterResponse(val roster: List<RosterEntry> = emptyList())

@Serializable
data class OperatorDto(val appUserId: String, val displayName: String, val role: String)

@Serializable
data class PinSessionDto(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long? = null,
    val operator: OperatorDto,
)

@Serializable
private data class PinErrorDto(val error: String? = null, val lockedUntil: String? = null)

/** The server rejected the PIN. [reason] is server-provided ("invalid" / "locked" / …). */
class PinLoginException(val reason: String, val lockedUntil: String? = null) : Exception(reason)

/**
 * Staff-PIN login against the pos-auth Supabase Edge Function — the tablet talks only to
 * <project>.supabase.co, same as every other call it makes. The service-role key that verifies
 * PINs and mints sessions stays on Supabase's edge — the tablet only ever sees the roster and, on
 * success, a normal Supabase session it imports. Both routes are gated by a shared device key.
 */
@Singleton
class PinAuthApi @Inject constructor() {
    private val base = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/pos-auth"
    private val deviceKey = BuildConfig.POS_DEVICE_KEY
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** False when this tablet hasn't been given the Supabase URL + device key yet. */
    val configured: Boolean get() = BuildConfig.SUPABASE_URL.isNotBlank() && deviceKey.isNotBlank()

    /** Active staff who have a PIN set — the name tiles on the login screen. */
    suspend fun roster(): List<RosterEntry> = withContext(Dispatchers.IO) {
        val (code, text) = request("$base/roster", "GET", null)
        if (code != 200) error("roster HTTP $code")
        json.decodeFromString<RosterResponse>(text).roster
    }

    /** Exchange a name + 4-digit PIN for a real Supabase session. [deviceCode] stamps
     *  the sign-in audit event for the Point of Sale module's per-device traceability. */
    suspend fun pinLogin(appUserId: String, pin: String, deviceCode: String? = null): PinSessionDto = withContext(Dispatchers.IO) {
        val body = json.encodeToString(buildMap {
            put("appUserId", appUserId)
            put("pin", pin)
            if (deviceCode != null) put("deviceCode", deviceCode)
        })
        val (code, text) = request("$base/pin-login", "POST", body)
        if (code == 200) return@withContext json.decodeFromString<PinSessionDto>(text)
        val err = runCatching { json.decodeFromString<PinErrorDto>(text) }.getOrNull()
        throw PinLoginException(err?.error ?: "error", err?.lockedUntil)
    }

    private fun request(url: String, method: String, body: String?): Pair<Int, String> {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("x-pos-device-key", deviceKey)
            setRequestProperty("accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("content-type", "application/json")
            }
        }
        return try {
            if (body != null) conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            code to text
        } finally {
            conn.disconnect()
        }
    }
}
