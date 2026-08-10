package mu.carfection.pos.core.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mu.carfection.pos.BuildConfig
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
private data class OverrideRequestBody(
    val appUserId: String,
    val pin: String,
    val kind: String,
    val refType: String,
    val refId: String,
    val reason: String,
    val maxDiscountCents: Long? = null,
)

@Serializable
private data class OverrideDto(val id: String? = null)

@Serializable
private data class OverrideResponseDto(
    val override: OverrideDto? = null,
    val error: String? = null,
    val reason: String? = null,
)

/**
 * What the till learned from asking the owner. The approved FIGURE is never carried back
 * from here — it is whatever cents the caller sent, exactly as DocumentBuilder.tsx holds
 * onto its own local value rather than re-deriving it from the RPC's rupee round trip.
 */
sealed interface OverrideOutcome {
    /** The PIN was accepted and the override recorded. */
    data object Approved : OverrideOutcome
    /** [reason] is server text — "locked" / "bad_pin" / "no_pin" / "invalid" — see [pinErrorCopy]. */
    data class PinRejected(val reason: String?) : OverrideOutcome
    /** The picked account checked out, but is not an active owner of this tenant. */
    data object NotOwner : OverrideOutcome
    data class Failed(val message: String) : OverrideOutcome
}

/** The same copy the web's OwnerOverrideDialog.tsx renders for each PIN refusal reason. */
fun pinErrorCopy(reason: String?): String = when (reason) {
    "locked" -> "Too many wrong attempts — that PIN is locked for a few minutes."
    "bad_pin" -> "That PIN wasn't right."
    "no_pin" -> "This owner hasn't set a tablet PIN yet."
    else -> "That PIN wasn't accepted."
}

/**
 * "Ask the owner" from the till — posts to the web app's /api/override with the operator's
 * own Supabase access token, same trust model as DocumentSendApi: the server binds an RLS
 * client to that token, so the tenant/role checks run as the signed-in operator. The PIN
 * itself is verified server-side by verify_staff_pin — this class, and the tablet, never
 * see the answer to "is that the right PIN" before the server does.
 */
@Singleton
class OverrideApi @Inject constructor(private val client: SupabaseClient) {
    private val base = BuildConfig.POS_WEB_URL.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /**
     * [maxDiscountCents] is CENTS on the wire — the route divides by 100 for
     * scope.max_discount_incl. Only a "discount" kind carries a figure; a "reversal"
     * override is a single-use yes/no and sends null.
     *
     * No offline fallback and nothing is queued: an approval that arrives after the sale
     * is not an approval, so a connection failure here is reported as a failure — see
     * [Throwable.uiMessage], which turns the raw socket exception into
     * "You're offline — the tablet can't reach the server. Try again once the line is back."
     */
    suspend fun requestOverride(
        appUserId: String,
        pin: String,
        kind: String,
        refType: String,
        refId: String,
        reason: String,
        maxDiscountCents: Long? = null,
    ): OverrideOutcome = withContext(Dispatchers.IO) {
        val token = client.auth.currentAccessTokenOrNull()
            ?: return@withContext OverrideOutcome.Failed("Not signed in — sign in again and retry.")
        val body = json.encodeToString(OverrideRequestBody(appUserId, pin, kind, refType, refId, reason, maxDiscountCents))
        val conn = (URL("$base/api/override").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("authorization", "Bearer $token")
            setRequestProperty("content-type", "application/json")
            setRequestProperty("accept", "application/json")
        }
        try {
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            val parsed = runCatching { json.decodeFromString<OverrideResponseDto>(text) }.getOrNull()
            when {
                code in 200..299 && parsed?.override != null -> OverrideOutcome.Approved
                parsed?.error == "pin_rejected" -> OverrideOutcome.PinRejected(parsed.reason)
                parsed?.error == "not_owner" -> OverrideOutcome.NotOwner
                parsed?.error == "forbidden" || code == 403 -> OverrideOutcome.Failed("You're not able to ask for an override from here.")
                parsed?.error == "bad_request" -> OverrideOutcome.Failed("Check the PIN, reason and amount, then try again.")
                parsed?.error == "unauthorized" -> OverrideOutcome.Failed("Not signed in — sign in again and retry.")
                else -> OverrideOutcome.Failed("Couldn't reach the server — try again.")
            }
        } catch (e: Exception) {
            OverrideOutcome.Failed(e.uiMessage())
        } finally {
            conn.disconnect()
        }
    }
}
