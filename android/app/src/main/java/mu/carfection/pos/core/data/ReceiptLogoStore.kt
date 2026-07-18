package mu.carfection.pos.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.storage.storage
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The receipt logo, cached on disk. The owner uploads it once in the web back
 * office (business_settings.receipt_logo_path → the private brand-assets
 * bucket); the tablet pulls it during the settings refresh and prints from the
 * local copy — a receipt must never wait on (or be denied by) the network for
 * a picture that changes once a year.
 */
@Singleton
class ReceiptLogoStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val client: SupabaseClient,
) {
    private val img get() = File(context.filesDir, "receipt_logo.img")
    private val marker get() = File(context.filesDir, "receipt_logo.path")

    /** The cached logo image, or null when the business has none. */
    fun file(): File? = img.takeIf { it.exists() && it.length() > 0 }

    /**
     * Bring the cache in line with the configured path. Cheap when nothing
     * changed (a string compare); a failed download keeps the previous logo —
     * stale artwork beats a blank header.
     */
    suspend fun sync(path: String?) {
        if (path.isNullOrBlank()) {
            img.delete()
            marker.delete()
            return
        }
        val current = runCatching { marker.takeIf { it.exists() }?.readText() }.getOrNull()
        if (path == current && file() != null) return
        runCatching {
            val bytes = client.storage.from("brand-assets").downloadAuthenticated(path)
            if (bytes.isNotEmpty()) {
                img.writeBytes(bytes)
                marker.writeText(path)
            }
        }
    }
}
