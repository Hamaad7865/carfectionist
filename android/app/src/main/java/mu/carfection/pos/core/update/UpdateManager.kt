package mu.carfection.pos.core.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import mu.carfection.pos.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

/** What the published `latest.json` says is the newest build. */
@Serializable
data class ReleaseManifest(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val notes: String = "",
)

sealed interface UpdateState {
    data object Idle : UpdateState
    /** A newer build is available; the shell offers to install it. */
    data class Available(val manifest: ReleaseManifest) : UpdateState
    data class Downloading(val percent: Int) : UpdateState
    data class Error(val message: String) : UpdateState
}

/**
 * Self-update, no app store. On launch the app reads a small manifest from Supabase
 * Storage; if it names a higher versionCode than this build, the shell offers to
 * update. Tapping downloads the SIGNED APK and hands it to the system installer —
 * which only proceeds because the new APK carries the same release key as the one
 * already installed. The tablet must allow "install unknown apps" for this app once.
 */
@Singleton
class UpdateManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state = _state.asStateFlow()

    private val manifestUrl = "${BuildConfig.SUPABASE_URL}/storage/v1/object/public/app-releases/latest.json"

    /** Read the manifest and surface an update if one is newer than this build. Silent on failure. */
    suspend fun checkForUpdate() {
        val manifest = runCatching { fetchManifest() }.getOrNull() ?: return
        if (manifest.versionCode > BuildConfig.VERSION_CODE) {
            _state.value = UpdateState.Available(manifest)
        }
    }

    fun dismiss() { _state.value = UpdateState.Idle }

    private suspend fun fetchManifest(): ReleaseManifest = withContext(Dispatchers.IO) {
        val conn = (URL(manifestUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000; readTimeout = 8000; requestMethod = "GET"
        }
        try {
            if (conn.responseCode != 200) error("manifest HTTP ${conn.responseCode}")
            json.decodeFromString<ReleaseManifest>(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Download the APK (reporting progress), then launch the installer. If the device
     * hasn't granted "install unknown apps" yet, route the operator to that setting.
     */
    suspend fun downloadAndInstall(manifest: ReleaseManifest) {
        // Nothing installs until the OS is allowed to; send them to the toggle first.
        if (!context.packageManager.canRequestPackageInstalls()) {
            openUnknownSourcesSetting()
            _state.value = UpdateState.Error("Allow \"install unknown apps\" for Carfectionist POS, then tap Update again.")
            return
        }
        val apk = runCatching { download(manifest) }.getOrElse {
            _state.value = UpdateState.Error("Download failed — check the connection and try again.")
            return
        }
        launchInstall(apk)
        _state.value = UpdateState.Idle
    }

    private suspend fun download(manifest: ReleaseManifest): File = withContext(Dispatchers.IO) {
        _state.value = UpdateState.Downloading(0)
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() } // keep only the current download
        val out = File(dir, "carfectionist-${manifest.versionCode}.apk")

        val conn = (URL(manifest.url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000; readTimeout = 30000; requestMethod = "GET"
        }
        try {
            if (conn.responseCode != 200) error("apk HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong.takeIf { it > 0 }
            conn.inputStream.use { input ->
                out.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    var read: Int
                    var done = 0L
                    while (input.read(buf).also { read = it } != -1) {
                        output.write(buf, 0, read)
                        done += read
                        if (total != null) _state.value = UpdateState.Downloading(((done * 100) / total).toInt())
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        out
    }

    private fun launchInstall(apk: File) {
        val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        context.startActivity(intent)
    }

    private fun openUnknownSourcesSetting() {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        runCatching { context.startActivity(intent) }
    }
}
