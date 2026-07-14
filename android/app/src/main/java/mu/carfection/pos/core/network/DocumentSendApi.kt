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
private data class SendDocumentBody(
    val channel: String,
    val to: String,
    val note: String? = null,
    val saveContact: Boolean,
    val deviceCode: String? = null,
)

@Serializable
private data class SendDocumentResponse(val ok: Boolean = false, val error: String? = null)

/**
 * "Send to customer" — posts to the web app's /api/documents/{id}/send with the
 * operator's own Supabase access token, so the server renders + delivers the
 * document PDF (email attachment or WhatsApp document message) AS the operator.
 * The heavy machinery (PDF engine, email binding, WhatsApp keys) lives on the
 * Worker; the tablet only asks for the send.
 */
@Singleton
class DocumentSendApi @Inject constructor(private val client: SupabaseClient) {
    private val base = BuildConfig.POS_WEB_URL.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Returns null on success, or a human-readable error message. */
    suspend fun send(documentId: String, channel: String, to: String, note: String?, deviceCode: String?): String? =
        withContext(Dispatchers.IO) {
            val token = client.auth.currentAccessTokenOrNull()
                ?: return@withContext "Not signed in — sign in again and retry."
            val body = json.encodeToString(SendDocumentBody(channel, to, note = note?.takeIf { it.isNotBlank() }, saveContact = true, deviceCode = deviceCode))
            val conn = (URL("$base/api/documents/$documentId/send").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 60_000 // PDF render + delivery can take a few seconds
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
                val parsed = runCatching { json.decodeFromString<SendDocumentResponse>(text) }.getOrNull()
                when {
                    parsed?.ok == true -> null
                    parsed?.error != null -> parsed.error
                    else -> "Send failed (HTTP $code)"
                }
            } catch (e: Exception) {
                e.message ?: "Network error"
            } finally {
                conn.disconnect()
            }
        }
}
