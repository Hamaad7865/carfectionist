# Job Alarm Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the job-alert network fetch off the broadcast thread into an expedited WorkManager worker, so a slow shop connection can no longer push `JobAlarmReceiver` into an ANR.

**Architecture:** Introduce WorkManager to the app (dependencies, `HiltWorkerFactory` on `PosApplication`, targeted manifest initialiser removal). `JobAlarmReceiver` becomes a few-microsecond hand-off that enqueues `JobAlertWorker`; `BootReceiver` does the same with `RearmAlarmsWorker`. The alert decision logic (`stillTrue`) moves out of the receiver unchanged.

**Tech Stack:** Kotlin, Hilt 2.52, androidx.hilt 1.2.0 (`@HiltWorker`), androidx.work 2.9.1, KSP, Supabase-kt.

**Spec:** `docs/superpowers/specs/2026-08-03-job-alarm-worker-design.md`

---

## Critical constraint the spec did not cover

`minSdk = 26` (`app/build.gradle.kts:43`). On API 26–30 there is no expedited job, so
WorkManager runs expedited work as a short foreground service and calls
`getForegroundInfo()`. `CoroutineWorker`'s default implementation **throws
`IllegalStateException`**. Left unhandled, every job alert on an Android 8–11 tablet
becomes a crash instead of a notification.

`JobAlertWorker` must therefore override `getForegroundInfo()`. API 31+ never calls it, so
this path is invisible on the Galaxy Tab S11 emulator — it must be reasoned about, not
discovered by testing.

`RearmAlarmsWorker` is not expedited and needs no override.

## File structure

| File | Responsibility |
|---|---|
| `android/app/build.gradle.kts` | **Modify** — add the three WorkManager/hilt-work dependencies |
| `android/app/src/main/java/mu/carfection/pos/PosApplication.kt` | **Modify** — `Configuration.Provider` + `HiltWorkerFactory` |
| `android/app/src/main/AndroidManifest.xml` | **Modify** — disable WorkManager's auto-initialiser |
| `.../core/notify/JobAlertWorker.kt` | **Create** — the fetch + decide + post/re-arm, and `stillTrue` |
| `.../core/notify/RearmAlarmsWorker.kt` | **Create** — boot re-arm |
| `.../core/notify/JobAlarmReceiver.kt` | **Modify** — hand-off only |
| `.../core/notify/BootReceiver.kt` | **Modify** — hand-off only, keeps `startActivity` |
| `.../core/notify/JobNotifications.kt` | **Modify** — companion `canPost(context)`, quiet notice for API 26–30 |
| `app/src/test/java/.../notify/JobAlertStillTrueTest.kt` | **Create** — proves the moved logic is unchanged |

`stillTrue` becomes an **internal top-level function** in `JobAlertWorker.kt` rather than a
private method, with an injectable `nowMs` defaulting to `System.currentTimeMillis()` —
matching `JobAlarms.arm(job, nowMs)`'s existing idiom. It has no worker state, so this
keeps it unit-testable without a `Context` or `WorkerParameters`. The body and comments are
otherwise unchanged.

---

### Task 1: WorkManager foundation

**Files:**
- Modify: `android/app/build.gradle.kts:124-126`
- Modify: `android/app/src/main/java/mu/carfection/pos/PosApplication.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add the dependencies**

In `android/app/build.gradle.kts`, replace the Hilt dependency block:

```kotlin
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
```

with:

```kotlin
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // A broadcast receiver has ~10s before Android calls it an ANR; the alert fetch runs
    // as a worker instead. hilt-work's processor is androidx.hilt:hilt-compiler — a
    // different artefact from hilt-android-compiler above, and they coexist under KSP.
    implementation(libs.work.runtime.ktx)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)
```

- [ ] **Step 2: Make PosApplication supply the worker factory**

Replace the entire contents of `android/app/src/main/java/mu/carfection/pos/PosApplication.kt`:

```kotlin
package mu.carfection.pos

import android.app.Application
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
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
```

- [ ] **Step 3: Disable WorkManager's automatic initialiser**

In `android/app/src/main/AndroidManifest.xml`, add the `tools` namespace to the root
element. Change line 2 from:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
```

to:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
```

Then add this provider immediately before the closing `</application>` tag (after the
`BootReceiver` block):

```xml
        <!-- On-demand WorkManager init: PosApplication supplies the Hilt worker factory,
             so the automatic initialiser must go. Remove only WorkManager's entry, not the
             whole InitializationProvider — that node is shared with any other androidx
             library that uses App Startup. -->
        <provider
            android:name="androidx.startup.InitializationProvider"
            android:authorities="${applicationId}.androidx-startup"
            android:exported="false"
            tools:node="merge">
            <meta-data
                android:name="androidx.work.WorkManagerInitializer"
                android:value="androidx.startup"
                tools:node="remove" />
        </provider>
```

- [ ] **Step 4: Verify it compiles**

Run from `android/`:

```bash
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`. If it fails with `Unresolved reference: workManagerConfiguration`,
the WorkManager version resolved below 2.9.0 — check `libs.versions.toml:14` says `workManager = "2.9.1"`.

- [ ] **Step 5: Commit**

```bash
git add android/app/build.gradle.kts android/app/src/main/java/mu/carfection/pos/PosApplication.kt android/app/src/main/AndroidManifest.xml
git commit -m "build(pos): wire WorkManager and hilt-work into the tablet"
```

---

### Task 2: JobAlertWorker and the moved decision logic

**Files:**
- Create: `android/app/src/test/java/mu/carfection/pos/core/notify/JobAlertStillTrueTest.kt`
- Create: `android/app/src/main/java/mu/carfection/pos/core/notify/JobAlertWorker.kt`

- [ ] **Step 1: Write the failing test**

Create `android/app/src/test/java/mu/carfection/pos/core/notify/JobAlertStillTrueTest.kt`:

```kotlin
package mu.carfection.pos.core.notify

import mu.carfection.pos.core.network.JobBoardDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * stillTrue() moved out of JobAlarmReceiver when the fetch became a worker. These pin the
 * behaviour so the move stays a move: an alarm is only a trigger, and the answer here is
 * what decides whether staff get told.
 */
class JobAlertStillTrueTest {

    private val now = 1_754_000_000_000L // fixed clock; no wall time in assertions

    private fun job(
        status: String = "scheduled",
        scheduledAt: String? = null,
        startedAt: String? = null,
        readyAt: String? = null,
        deliveredAt: String? = null,
        pausedAt: String? = null,
        pausedMs: Long = 0,
        estimatedMinutes: Int? = null,
    ) = JobBoardDto(
        id = "job-1",
        status = status,
        scheduledAt = scheduledAt,
        startedAt = startedAt,
        readyAt = readyAt,
        deliveredAt = deliveredAt,
        pausedAt = pausedAt,
        pausedMs = pausedMs,
        estimatedMinutes = estimatedMinutes,
    )

    // ── A finished car is never chased, whatever the alert ──────────────────────
    @Test
    fun `a ready car is silent for every alert`() {
        val j = job(status = "in_progress", readyAt = "2026-08-01T10:00:00+04:00")
        JobAlert.entries.forEach { assertFalse(it.name, stillTrue(j, it, now)) }
    }

    @Test
    fun `a delivered car is silent for every alert`() {
        val j = job(status = "in_progress", deliveredAt = "2026-08-01T10:00:00+04:00")
        JobAlert.entries.forEach { assertFalse(it.name, stillTrue(j, it, now)) }
    }

    @Test
    fun `a cancelled car is silent for every alert`() {
        JobAlert.entries.forEach { assertFalse(it.name, stillTrue(job(status = "cancelled"), it, now)) }
    }

    // ── DUE: fires even once the server has auto-started the job ────────────────
    @Test
    fun `due fires when the job has not started`() {
        assertTrue(stillTrue(job(scheduledAt = "2026-08-01T10:00:00+04:00"), JobAlert.DUE, now))
    }

    @Test
    fun `due fires when auto-start already flipped it to in progress`() {
        // Auto-start stamps started_at == scheduled_at. Gating on status would swallow
        // the notification exactly when the flip won the race.
        val j = job(
            status = "in_progress",
            scheduledAt = "2026-08-01T10:00:00+04:00",
            startedAt = "2026-08-01T10:00:00+04:00",
        )
        assertTrue(stillTrue(j, JobAlert.DUE, now))
    }

    @Test
    fun `due stays quiet when a human started the car early`() {
        val j = job(
            status = "in_progress",
            scheduledAt = "2026-08-01T10:00:00+04:00",
            startedAt = "2026-08-01T09:45:00+04:00",
        )
        assertFalse(stillTrue(j, JobAlert.DUE, now))
    }

    // ── OVERDUE: the server-down safety net, only while genuinely unstarted ─────
    @Test
    fun `overdue fires only while the job is still scheduled`() {
        assertTrue(stillTrue(job(status = "scheduled"), JobAlert.OVERDUE, now))
        assertFalse(stillTrue(job(status = "in_progress"), JobAlert.OVERDUE, now))
    }

    // ── LATE: a pause slides the ETA, so a paused job is not late yet ───────────
    @Test
    fun `late fires when a running job is past its estimate`() {
        val j = job(
            status = "in_progress",
            startedAt = "2026-08-01T10:00:00+04:00",
            estimatedMinutes = 60,
        )
        val past = requireNotNull(mu.carfection.pos.core.jobs.JobClock.epoch(j.startedAt)) + 61 * 60_000L
        assertTrue(stillTrue(j, JobAlert.LATE, past))
    }

    @Test
    fun `late stays quiet before the estimate is reached`() {
        val j = job(
            status = "in_progress",
            startedAt = "2026-08-01T10:00:00+04:00",
            estimatedMinutes = 60,
        )
        val early = requireNotNull(mu.carfection.pos.core.jobs.JobClock.epoch(j.startedAt)) + 10 * 60_000L
        assertFalse(stillTrue(j, JobAlert.LATE, early))
    }

    @Test
    fun `late stays quiet for a job paused past its original estimate`() {
        // Paused at +30min of a 60min job: the ETA slides with the pause, so at what
        // would have been the finish line it is not late.
        val started = "2026-08-01T10:00:00+04:00"
        val startMs = requireNotNull(mu.carfection.pos.core.jobs.JobClock.epoch(started))
        val j = job(
            status = "in_progress",
            startedAt = started,
            pausedAt = "2026-08-01T10:30:00+04:00",
            estimatedMinutes = 60,
        )
        assertFalse(stillTrue(j, JobAlert.LATE, startMs + 61 * 60_000L))
    }

    @Test
    fun `late stays quiet when nobody estimated the work`() {
        val j = job(status = "in_progress", startedAt = "2026-08-01T10:00:00+04:00")
        assertFalse(stillTrue(j, JobAlert.LATE, now))
    }

    // ── READY is an event, never an alarm ───────────────────────────────────────
    @Test
    fun `ready is never true as an alarm`() {
        assertFalse(stillTrue(job(status = "in_progress"), JobAlert.READY, now))
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `android/`:

```bash
./gradlew testDebugUnitTest --tests "*JobAlertStillTrueTest*"
```

Expected: FAIL — compilation error, `Unresolved reference: stillTrue`.

- [ ] **Step 3: Create the worker**

Create `android/app/src/main/java/mu/carfection/pos/core/notify/JobAlertWorker.kt`:

```kotlin
package mu.carfection.pos.core.notify

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import mu.carfection.pos.core.jobs.JobClock
import mu.carfection.pos.core.network.JobBoardDto
import mu.carfection.pos.core.network.PosApi

/**
 * The alarm is a TRIGGER; the server is the TRUTH. A "due to start" armed at 14:30 says
 * nothing about whether someone already started the car at 14:25, and a board that cries
 * wolf is a board staff learn to ignore. So we re-read the job here and stay quiet unless
 * the condition still holds.
 *
 * This runs as a worker rather than in JobAlarmReceiver because a foreground broadcast has
 * ~10s before Android calls it an ANR — and building the Supabase client (Auth, Postgrest,
 * Storage, Realtime) plus a round trip is no way to spend it.
 *
 * Expedited, because these alerts are supposed to land on the minute. The alarm is armed
 * with setExactAndAllowWhileIdle, which lifts Doze briefly when it fires, so work enqueued
 * in that window starts immediately rather than waiting for a maintenance window.
 */
@HiltWorker
class JobAlertWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val api: PosApi,
    private val notifications: JobNotifications,
    private val alarms: JobAlarms,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val jobId = inputData.getString(EXTRA_JOB_ID) ?: return Result.failure()
        val alert = JobAlert.entries.firstOrNull { it.id == inputData.getString(EXTRA_ALERT) }
            ?: return Result.failure()

        // Offline, or the job is gone. Give up rather than retry: a "booked in now" posted
        // several minutes late is noise, and JobWatcher re-arms everything the next time
        // the app is opened. This is what the receiver did before the fetch moved here.
        val job = runCatching { api.fetchJobForAlert(jobId) }.getOrNull() ?: return Result.success()

        if (stillTrue(job, alert)) {
            notifications.post(job, alert)
        } else {
            // The job moved while we waited — most often a pause, which slides the
            // ETA past this alarm. Re-arm from what is true now, so a paused job is
            // still chased when it really does run late. Without this the alert is
            // lost the first time anyone takes a tea break.
            alarms.arm(job)
        }
        return Result.success()
    }

    /**
     * API 26–30 has no expedited job, so WorkManager runs expedited work as a short
     * foreground service and asks for this. CoroutineWorker's default implementation
     * THROWS, which would turn every alert on an older tablet into a crash rather than a
     * notification. API 31+ never calls it.
     */
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(CHECK_NOTIFICATION_ID, notifications.checkingNotice())

    companion object {
        /** Fixed id: only one of these is ever on screen, and only for a second. */
        private const val CHECK_NOTIFICATION_ID = 918_273

        fun request(jobId: String, alert: JobAlert): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<JobAlertWorker>()
                .setInputData(workDataOf(EXTRA_JOB_ID to jobId, EXTRA_ALERT to alert.id))
                // Out of quota, run it as ordinary work: a late alert beats no alert.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
        // Deliberately NOT network-constrained. A constraint would hold a "due now" alert
        // until the tablet is back online, turning an honest give-up into silence.
    }
}

/**
 * Does the world still look the way it did when this alarm was armed?
 *
 * Top-level and internal so it can be tested without a Context or WorkerParameters; nowMs
 * is injectable for the same reason, following JobAlarms.arm(job, nowMs).
 */
internal fun stillTrue(
    job: JobBoardDto,
    alert: JobAlert,
    nowMs: Long = System.currentTimeMillis(),
): Boolean {
    // Finished is finished — nothing about a delivered car needs chasing.
    if (job.readyAt != null || job.deliveredAt != null || job.status == "cancelled") return false

    return when (alert) {
        // The booked moment has arrived. The server auto-starts the job at this
        // instant, so by now it may already be in_progress — fire either way, as
        // long as the car isn't finished (handled above). Gating this on
        // status == "scheduled" would swallow the notification exactly when the
        // flip won the race, which is most of the time.
        //
        // The one exception: a job a human STARTED EARLY (started_at before its
        // booked time) is already visibly underway, so "booked in now" would be a
        // stale ping. Auto-start stamps started_at == scheduled_at, and a normal
        // or late manual start is at/after it — all of those still fire.
        JobAlert.DUE -> {
            val started = JobClock.epoch(job.startedAt)
            val sched = JobClock.epoch(job.scheduledAt)
            started == null || sched == null || started >= sched
        }
        // Genuinely still not started — the server-down safety net.
        JobAlert.OVERDUE -> job.status == "scheduled"
        // Still running, and genuinely past its estimate. A pause slides the ETA, so a
        // job paused since the alarm was armed is not late yet — re-check, don't assume.
        JobAlert.LATE -> job.status == "in_progress" &&
            (JobClock.estimatedFinishMs(job, nowMs)?.let { nowMs >= it } ?: false)
        // Never armed as an alarm — it is an event, not a time.
        JobAlert.READY -> false
    }
}
```

- [ ] **Step 4: Add the quiet notice JobAlertWorker needs**

In `android/app/src/main/java/mu/carfection/pos/core/notify/JobNotifications.kt`, add these
imports alongside the existing ones:

```kotlin
import android.app.Notification
```

Then add this method to the `JobNotifications` class, immediately after `ensureChannel()`:

```kotlin
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
```

And add the channel id to the existing companion object, so it reads:

```kotlin
    companion object {
        const val CHANNEL_ID = "job_schedule"
        private const val CHECK_CHANNEL_ID = "job_schedule_check"
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `android/`:

```bash
./gradlew testDebugUnitTest --tests "*JobAlertStillTrueTest*"
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/notify/JobAlertWorker.kt android/app/src/main/java/mu/carfection/pos/core/notify/JobNotifications.kt android/app/src/test/java/mu/carfection/pos/core/notify/JobAlertStillTrueTest.kt
git commit -m "feat(pos): the alert re-read runs as a worker, not on the broadcast thread"
```

---

### Task 3: Reduce JobAlarmReceiver to a hand-off

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/core/notify/JobNotifications.kt:52-56`
- Modify: `android/app/src/main/java/mu/carfection/pos/core/notify/JobAlarmReceiver.kt`

- [ ] **Step 1: Make the permission test reachable without injection**

In `JobNotifications.kt`, replace the instance method:

```kotlin
    /** False when the user has not granted notifications — post() would be swallowed silently. */
    fun canPost(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
```

with a delegating one:

```kotlin
    /** False when the user has not granted notifications — post() would be swallowed silently. */
    fun canPost(): Boolean = canPost(context)
```

and add the real test to the companion object, which now reads:

```kotlin
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
```

- [ ] **Step 2: Replace the receiver**

Replace the entire contents of `android/app/src/main/java/mu/carfection/pos/core/notify/JobAlarmReceiver.kt`:

```kotlin
package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager

/**
 * An alarm has come home. It carries only a job id and a kind — deliberately.
 *
 * Nothing is decided here. A foreground broadcast has ~10s before Android calls it an ANR,
 * and the decision needs a round trip to the server (see JobAlertWorker for why it cannot
 * be skipped). So this hands the id and the kind to a worker and returns immediately —
 * which also means the process may be killed the moment it does, without losing the alert.
 */
class JobAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: return
        val alert = JobAlert.entries.firstOrNull { it.id == intent.getStringExtra(EXTRA_ALERT) } ?: return
        // A cheap permission read, kept here rather than in the worker: no point scheduling
        // work that could only end in a notification nobody is allowed to see. It also
        // skips the re-arm in that case, exactly as this receiver did before.
        if (!JobNotifications.canPost(context)) return

        WorkManager.getInstance(context).enqueue(JobAlertWorker.request(jobId, alert))
    }
}
```

- [ ] **Step 3: Verify the unit tests still pass and it builds**

Run from `android/`:

```bash
./gradlew testDebugUnitTest --tests "*JobAlertStillTrueTest*" assembleDebug
```

Expected: `BUILD SUCCESSFUL`, 12 tests passing.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/notify/JobAlarmReceiver.kt android/app/src/main/java/mu/carfection/pos/core/notify/JobNotifications.kt
git commit -m "fix(pos): a job alert no longer risks an ANR on a slow connection"
```

---

### Task 4: The same fix for BootReceiver

**Files:**
- Create: `android/app/src/main/java/mu/carfection/pos/core/notify/RearmAlarmsWorker.kt`
- Modify: `android/app/src/main/java/mu/carfection/pos/core/notify/BootReceiver.kt`

- [ ] **Step 1: Create the worker**

Create `android/app/src/main/java/mu/carfection/pos/core/notify/RearmAlarmsWorker.kt`:

```kotlin
package mu.carfection.pos.core.notify

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
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
            androidx.work.WorkManager.getInstance(context)
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
```

- [ ] **Step 2: Replace BootReceiver**

Replace the entire contents of `android/app/src/main/java/mu/carfection/pos/core/notify/BootReceiver.kt`:

```kotlin
package mu.carfection.pos.core.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import mu.carfection.pos.MainActivity

/**
 * Alarms do not survive a reboot — Android drops every one of them. A tablet that loses
 * power at lunch would otherwise wake up with a board full of jobs it will never mention
 * again, so re-arm from the server the moment we are back.
 *
 * Also fires on MY_PACKAGE_REPLACED: installing a new APK clears alarms just as thoroughly.
 *
 * The re-arm itself is RearmAlarmsWorker's job; holding the boot broadcast open for a
 * network round trip is the ANR risk this receiver used to carry.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            intent.action != QUICKBOOT_POWERON
        ) return

        // The tablet IS the till: when the counter powers on, bring the POS up with it so
        // nobody has to hunt for the icon. Android 10+ may refuse a background activity
        // start, so this is best-effort — setting the app as the tablet's Home app is the
        // guaranteed route. Re-arming the alarms below happens either way.
        //
        // This stays in the receiver: it is a background activity start riding the boot
        // broadcast, and would simply be blocked from a worker.
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            runCatching {
                context.startActivity(
                    Intent(context, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                )
            }
        }

        RearmAlarmsWorker.enqueue(context)
    }

    private companion object {
        /** Some OEMs (and fast-boot tablets) send this instead of BOOT_COMPLETED. */
        const val QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
    }
}
```

- [ ] **Step 3: Verify it builds**

Run from `android/`:

```bash
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/notify/RearmAlarmsWorker.kt android/app/src/main/java/mu/carfection/pos/core/notify/BootReceiver.kt
git commit -m "fix(pos): the boot re-arm waits for the network instead of the broadcast"
```

---

### Task 5: Verify on the emulator

**Files:** none — verification only.

- [ ] **Step 1: Confirm the merged manifest dropped WorkManager's initialiser**

Run from `android/`:

```bash
grep -A3 'WorkManagerInitializer' app/build/intermediates/merged_manifests/debug/processDebugMainManifest/AndroidManifest.xml || echo "ABSENT — correct"
```

Expected: `ABSENT — correct`. If the initialiser is present, on-demand init is not in
effect and the Hilt worker factory will be ignored at runtime.

- [ ] **Step 2: Install on the emulator**

```bash
adb devices
```

Expected: `emulator-5554  device`. The emulator is shared with a KidsCorner watcher — confirm
the AVD is `Galaxy_Tab_S11` before proceeding:

```bash
adb -s emulator-5554 emu avd name
```

Then install:

```bash
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
```

Expected: `Success`.

- [ ] **Step 3: Start a clean logcat capture**

```bash
adb -s emulator-5554 logcat -c && adb -s emulator-5554 logcat -v time > /tmp/alarm-verify.log &
```

- [ ] **Step 4: Trigger the alarm path directly**

The receiver is not exported, so drive it through the app's own component:

```bash
adb -s emulator-5554 shell am broadcast -n mu.carfection.pos/.core.notify.JobAlarmReceiver -a mu.carfection.pos.JOB_ALERT.due --es job_id "<REAL_JOB_UUID>" --es alert due
```

Replace `<REAL_JOB_UUID>` with an id from the live `jobs` table (seed UUIDs are dead —
probe the DB for a current one). Expected: `Broadcast completed: result=0`.

- [ ] **Step 5: Confirm the worker ran and nothing ANR'd**

```bash
grep -E 'JobAlertWorker|WM-WorkerWrapper.*JobAlertWorker|ANR in mu.carfection.pos' /tmp/alarm-verify.log
```

Expected: a `WM-WorkerWrapper` line reporting `Worker result SUCCESS for Work [ ... JobAlertWorker ... ]`,
and **no** `ANR in mu.carfection.pos`.

- [ ] **Step 6: Confirm the boot path**

```bash
adb -s emulator-5554 shell am broadcast -a android.intent.action.BOOT_COMPLETED -n mu.carfection.pos/.core.notify.BootReceiver
grep -E 'RearmAlarmsWorker|ANR in mu.carfection.pos' /tmp/alarm-verify.log
```

Expected: a `SUCCESS` result for `RearmAlarmsWorker`, no ANR.

- [ ] **Step 7: Ship the APK**

```bash
cp app/build/outputs/apk/debug/app-debug.apk "/c/Users/sheik/OneDrive/Desktop/Carfectionist-POS.apk"
```

---

## Notes for the implementer

- **Do not add a network constraint to `JobAlertWorker`.** It is the one place a constraint
  actively harms: a "due now" alert held until the tablet is back online is worse than one
  that gave up honestly. The asymmetry with `RearmAlarmsWorker` is deliberate.
- **Do not change `Result.success()` to `Result.retry()` in `JobAlertWorker`.** It preserves
  the receiver's original give-up behaviour; retrying would post stale alerts.
- **`stillTrue`'s body is a move, not a rewrite.** The only edits are its visibility, its
  new `nowMs` parameter, and `System.currentTimeMillis()` becoming `nowMs` in the LATE
  branch. Every comment stays.
- **`getForegroundInfo()` is not optional** at `minSdk = 26`, even though the emulator will
  never exercise it.
