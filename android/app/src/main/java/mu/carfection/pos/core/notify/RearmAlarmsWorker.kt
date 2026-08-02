package mu.carfection.pos.core.notify

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import mu.carfection.pos.core.network.PosApi

/**
 * Alarms do not survive a reboot — Android drops every one of them — so they are re-armed
 * from the server once the tablet is back.
 *
 * A worker rather than the boot broadcast itself: BootReceiver used to hold the broadcast
 * open for the round trip, which is the same ANR risk JobAlarmReceiver had, and a boot
 * broadcast is a bad place to be waiting on a shop's internet.
 *
 * Not expedited — a re-arm is not minute-critical, and expedited slots are contended at
 * boot. It IS network-constrained, which is a small improvement on the old behaviour: a
 * tablet that boots offline used to lose the re-arm until somebody opened the app.
 */
@HiltWorker
class RearmAlarmsWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val api: PosApi,
    private val alarms: JobAlarms,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        // Retry here, unlike JobAlertWorker: the constraint says the network is up, so a
        // failure is the server being briefly unreachable, and a re-arm is just as useful
        // a minute later as it is now.
        val jobs = runCatching { api.fetchAlertableJobs() }.getOrNull() ?: return Result.retry()
        alarms.armAll(jobs)
        return Result.success()
    }

    companion object {
        /** BOOT_COMPLETED and QUICKBOOT_POWERON can both arrive; one re-arm is enough. */
        private const val WORK_NAME = "rearm-job-alarms"

        fun enqueue(context: Context) {
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request())
        }

        private fun request(): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<RearmAlarmsWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
    }
}
