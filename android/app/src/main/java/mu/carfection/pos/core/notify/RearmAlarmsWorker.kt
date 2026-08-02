package mu.carfection.pos.core.notify

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import mu.carfection.pos.core.network.PosApi

/**
 * Reads the board back from the server after a reboot or a reinstall and re-arms the
 * alarms Android threw away.
 *
 * This used to run inside BootReceiver, which is what hung the tablet on power-on: a
 * receiver gets ten seconds for the whole of onReceive, and the fetch alone was allowed
 * fifteen — before counting the Supabase client that field injection had to build first.
 * A boot broadcast is the worst possible moment to ask for either; the entire device is
 * still coming up. Out here the wait costs nobody anything.
 *
 * Moving it also answers the case the old code could only shrug at. A tablet that boots
 * before the shop's Wi-Fi does had nothing to re-arm from and gave up until someone
 * opened the app; WorkManager just waits for the line and runs then.
 */
@HiltWorker
class RearmAlarmsWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val api: PosApi,
    private val alarms: JobAlarms,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val jobs = runCatching { api.fetchAlertableJobs() }.getOrNull()
            // Nobody signed in yet, or the server is having a moment. Back off and try a
            // few more times, then let it go: JobWatcher re-arms everything the instant
            // the app is opened, so the alerts are delayed rather than lost.
            ?: return if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.success()

        alarms.armAll(jobs)
        return Result.success()
    }

    companion object {
        private const val MAX_ATTEMPTS = 5
        private const val WORK_NAME = "rearm-job-alarms"

        /**
         * Hands the work off and returns — which is the receiver's entire job now.
         *
         * Unique, because one power-on can arrive as more than one trigger (some OEMs send
         * QUICKBOOT_POWERON alongside BOOT_COMPLETED) and re-arming the same board twice is
         * work for nothing. REPLACE rather than KEEP so a reinstall on top of a boot still
         * reads the current board.
         */
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<RearmAlarmsWorker>()
                // No network, no board to read. Waiting is free out here; inside the
                // receiver it was the whole problem.
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
