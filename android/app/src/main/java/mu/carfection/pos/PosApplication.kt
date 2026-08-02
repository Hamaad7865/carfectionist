package mu.carfection.pos

import android.app.Application
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Also WorkManager's configuration host: the alert workers are @HiltWorker, so WorkManager
 * has to be handed a factory that can reach the Hilt graph. Supplying a Configuration means
 * WorkManager initialises on demand, which is why its automatic initialiser is removed in
 * the manifest — leaving both in place would build it twice and ignore this factory.
 */
@HiltAndroidApp
class PosApplication : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            // A job alert that silently fails to run is indistinguishable from one that
            // ran and decided to stay quiet. On a debug build, say which.
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.DEBUG else Log.INFO)
            .build()
}
