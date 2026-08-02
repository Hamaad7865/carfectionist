package mu.carfection.pos.core.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import mu.carfection.pos.MainActivity
import mu.carfection.pos.R
import mu.carfection.pos.core.network.JobBoardDto
import javax.inject.Inject
import javax.inject.Singleton

/** The four things the board can shout about. The name is part of the alarm's identity. */
enum class JobAlert(val id: String) {
    DUE("due"),           // the booked moment has arrived and nobody has started
    OVERDUE("overdue"),   // still not started, well past its slot
    LATE("late"),         // running, but past the time it was supposed to be done
    READY("ready"),       // a technician marked the car ready — the front desk should call
}

const val EXTRA_JOB_ID = "job_id"
const val EXTRA_ALERT = "alert"

@Singleton
class JobNotifications @Inject constructor(
    @ApplicationContext private val context: Context,
    private val log: AlertLog,
) {
    private val manager = NotificationManagerCompat.from(context)

    fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Job schedule",
            // A car nobody starts is money standing still — worth a sound, not a silent dot.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "When a job is due to start, running late, or ready for the customer."
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * The placeholder API 26–30 shows while an expedited check runs — those versions have
     * no expedited job, so WorkManager fronts the work with a foreground service and needs
     * a notification for it. Its own low channel, so a one-second lookup never buzzes.
     */
    fun checkingNotice(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHECK_CHANNEL_ID,
                    "Checking the schedule",
                    NotificationManager.IMPORTANCE_MIN,
                ),
            )
        }
        return NotificationCompat.Builder(context, CHECK_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Checking the job schedule")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
    }

    /** False when the user has not granted notifications — post() would be swallowed silently. */
    fun canPost(): Boolean = canPost(context)

    /** Say it once. A repeat of the same job+kind is swallowed — see AlertLog. */
    suspend fun post(job: JobBoardDto, alert: JobAlert) {
        if (!canPost()) return
        if (!log.claim(job.id, alert)) return
        ensureChannel()

        val car = listOfNotNull(job.vehicles?.make, job.vehicles?.model).joinToString(" ").ifBlank { "Vehicle" }
        val plate = job.vehicles?.plate?.let { " · $it" } ?: ""
        val who = job.customers?.name?.let { " — $it" } ?: ""

        val title = when (alert) {
            JobAlert.DUE -> "Started — booked in now"
            JobAlert.OVERDUE -> "Still not started"
            JobAlert.LATE -> "Running late"
            JobAlert.READY -> "Ready for the customer"
        }
        val body = when (alert) {
            // The server moves the job to In progress the moment its time comes; this
            // is the ping that says it happened.
            JobAlert.DUE -> "$car$plate reached its booked time and is now in progress.$who"
            JobAlert.OVERDUE -> "$car$plate was due earlier and hasn't been started.$who"
            JobAlert.LATE -> "$car$plate is past its estimated finish.$who"
            JobAlert.READY -> "$car$plate is done — call the customer.$who"
        }

        // Tapping it opens that job on the board; MainActivity routes on the extra.
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_JOB_ID, job.id)
            putExtra(EXTRA_ALERT, alert.id)
        }
        val pending = PendingIntent.getActivity(
            context,
            notifId(job.id, alert),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        runCatching { manager.notify(notifId(job.id, alert), n) }
    }

    /** Stable per job+kind, so a re-fired alert replaces its twin instead of stacking. */
    private fun notifId(jobId: String, alert: JobAlert): Int =
        (jobId + alert.id).hashCode()

    companion object {
        const val CHANNEL_ID = "job_schedule"
        private const val CHECK_CHANNEL_ID = "job_schedule_check"

        /**
         * The same question, askable without the injected instance: JobAlarmReceiver checks
         * it before enqueuing, and a receiver that only hands work off has no Hilt graph.
         */
        fun canPost(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
    }
}
