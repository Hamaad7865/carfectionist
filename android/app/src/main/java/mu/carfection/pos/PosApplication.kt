package mu.carfection.pos

import android.app.Application
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class PosApplication : Application(), Configuration.Provider {

    /**
     * Workers take their dependencies from Hilt, so WorkManager has to be handed a factory
     * that knows how to build them. Supplying the configuration here — with the default
     * initializer removed from the manifest — also means WorkManager starts on first use
     * rather than on every launch of the till.
     */
    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            // A job alert that silently fails to run is indistinguishable from one that ran
            // and decided to stay quiet. On a debug build, say which.
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.DEBUG else Log.INFO)
            .build()
}
