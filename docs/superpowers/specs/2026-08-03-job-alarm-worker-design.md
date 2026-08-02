# Job alarm alerts off the broadcast thread — design

**Date:** 2026-08-03 · **Approved by:** owner (chat) · **Scope:** Android app only

## Problem

`JobAlarmReceiver.onReceive` calls `goAsync()` and then waits up to `TIMEOUT_MS = 10_000L`
on `api.fetchJobForAlert(jobId)`. A foreground broadcast's ANR budget is 10 s, so the
timeout alone spends the entire allowance — a slow shop line puts the receiver exactly at
the limit rather than safely inside it.

It is worse than the timeout suggests. The class is `@AndroidEntryPoint` with
`@Inject lateinit var api: PosApi`, and `PosApi` takes a `SupabaseClient` built by
`AppModule.supabase()` with Auth, Postgrest, Storage **and Realtime** (a websocket engine)
installed. That whole graph is constructed on the broadcast thread before the fetch even
starts, and it is not counted in the 10 s.

`BootReceiver` has the same shape with a 15 s timeout. It survives only because
`BOOT_COMPLETED` is a background broadcast with a 60 s budget — the same defect, less
acute, and worth fixing in the same pass rather than leaving as a trap.

## Correcting the brief

The task described this as a copy of a fix "just made" in `BootReceiver`, following a
`RearmAlarmsWorker` introduced alongside it. No such fix exists:

- `git log --all -- '*RearmAlarmsWorker*'` returns nothing; there is no `*Worker*.kt`
  anywhere in the tree.
- `BootReceiver` still has `@AndroidEntryPoint` + `goAsync()`.
- `PosApplication` is seven lines — no `Configuration.Provider`, no `HiltWorkerFactory`.
- `app/build.gradle.kts` declares neither `work-runtime-ktx` nor `hilt-work`. Both exist
  in `libs.versions.toml` (lines 38–39, 43) but nothing references them.

So this change introduces WorkManager to the app for the first time. The diagnosis in the
brief was right; only the "follow the existing pattern" shortcut was not available.

## Why WorkManager here, when the catalogue sync said no

`2026-07-30-tablet-catalog-periodic-sync-design.md` rejected WorkManager deliberately: a
kiosk open all day does not need background machinery, and the 15-minute periodic floor
did not fit a 5-minute freshness target. Neither objection applies here. This is one-shot
work started by an alarm that can arrive with no process alive, and the receiver's process
may be killed the moment `onReceive` returns — which is precisely what WorkManager exists
for. The earlier decision stands on its own case.

## Decision (approved)

Move the fetch into a `@HiltWorker` `CoroutineWorker`, enqueued as **expedited** work.
Fix both receivers.

### 1. Build wiring

```kotlin
implementation(libs.work.runtime.ktx)
implementation(libs.hilt.work)
ksp(libs.hilt.work.compiler)
```

`hilt-work-compiler` is `androidx.hilt:hilt-compiler` — a different processor from the
existing `hilt-android-compiler`, and they coexist. Both run under KSP, which is already
how this project resolves Hilt (`enableAggregatingTask = false`, with the reasoning at
`build.gradle.kts:98`), so `@HiltWorker` lands in the pass that is known to work here.

### 2. `PosApplication`

Implements `Configuration.Provider`, injecting `HiltWorkerFactory`. WorkManager 2.9.1 uses
the `workManagerConfiguration` property form, not the older `getWorkManagerConfiguration()`.

### 3. Manifest

On-demand initialisation requires disabling WorkManager's auto-initialiser. Remove **only**
WorkManager's node — removing the whole `InitializationProvider` would break androidx.startup
for every other library that uses it:

```xml
<provider android:name="androidx.startup.InitializationProvider"
    android:authorities="${applicationId}.androidx-startup"
    android:exported="false" tools:node="merge">
    <meta-data android:name="androidx.work.WorkManagerInitializer" tools:node="remove" />
</provider>
```

Adds `xmlns:tools` to the manifest root, currently absent.

### 4. `JobAlertWorker`

`@HiltWorker` `CoroutineWorker`; `jobId` and `alert.id` arrive as input `Data`. `stillTrue()`
and the `alarms.arm(job)` re-arm branch move across **verbatim, comments intact** — that
logic is load-bearing and is not being rewritten.

### 5. `JobAlarmReceiver`

Drops `@AndroidEntryPoint`, `goAsync()`, and all three `@Inject`s. It reads the two extras,
checks `canPost()`, and enqueues. Nothing else.

`canPost()` stays in the receiver: it is a cheap permission read, and it avoids scheduling
work that could post nothing. It currently needs an injected `JobNotifications`, so the
permission test is extracted to a companion `JobNotifications.canPost(context)` with the
instance method delegating to it — no duplicated logic, and it preserves today's behaviour
where a denied permission also skips the re-arm.

## Why expedited, not a foreground service

These are "due to start" / "overdue" / "late" alerts that must land on the minute, and a
plain `OneTimeWorkRequest` can be deferred by the scheduler.

`JobAlarms.set()` arms via `setExactAndAllowWhileIdle` (`JobAlarms.kt:97`), which grants a
temporary Doze allowlist window when the alarm fires. Expedited work enqueued inside that
window starts immediately rather than waiting for a maintenance window — so the minute is
kept without a foreground service's permanently visible notification, which on a shop
tablet would be notification noise several times a day for a one-second fetch.

`setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)` is the pressure valve: if
expedited quota is ever exhausted, a slightly late alert beats a crash. At a handful of
alerts per tablet per day, quota is not a practical concern.

## Deliberate non-changes

- **No `withTimeoutOrNull` in the worker.** It existed as an ANR guard; off the broadcast
  thread there is nothing to guard. The call stays bounded by the HTTP engine's own
  timeouts rather than being left open-ended, so it cannot hang for the worker's full
  10-minute execution window.
- **Fetch failure returns `Result.success()`, not `Result.retry()`.** This preserves
  today's semantics exactly (`if (job == null) return@launch` — give up). Retrying with
  backoff would post "booked in now" minutes after the fact, and `JobWatcher` already
  re-arms when the app is next opened.
- **No network constraint on `JobAlertWorker`.** A constraint would defer a "due now"
  alert indefinitely while offline, turning today's honest give-up into silence.

## The boot half

`RearmAlarmsWorker` mirrors the same shape around `api.fetchAlertableJobs()` +
`alarms.armAll(...)`, with two differences:

- **Not expedited.** Boot re-arming is not minute-critical, and expedited slots are
  contended at boot.
- **`NetworkType.CONNECTED` constraint** — a small approved behaviour improvement.
  `BootReceiver.kt:50-54` currently notes that an offline boot loses the re-arm until
  someone opens the app; with the constraint, WorkManager waits for the network and
  re-arms on its own.

The `startActivity` call stays in the receiver. It is a background activity start riding
the boot broadcast, and would be blocked from a worker.

## Not mirrored on web

`android-web-parity` governs behaviour and RPCs. This is an Android-runtime concern —
broadcast ANR budgets, Doze, WorkManager — with no web equivalent. No RPC, no notification
copy, and no alert semantics change: `stillTrue()` moves unaltered, so what fires and when
is identical.

## Testing

- **Unit:** `stillTrue()` across all four `JobAlert` values × finished/cancelled/paused
  job states, proving the moved logic is unchanged. It becomes `internal` rather than
  `private` so the test source set in the same module can reach it — the one visibility
  change to otherwise-verbatim logic. `isReturnDefaultValues = true` is already set, so
  `android.util.Log` calls will not decide a result.
- **End-to-end:** `./gradlew assembleDebug` from `android/`, install on the
  `Galaxy_Tab_S11` emulator, trigger an alarm, and confirm via logcat that the worker
  reports `SUCCESS` and no `ANR in mu.carfection.pos` appears.
- A worktree needs `android/local.properties` and `android/keystore.properties` copied in
  from the main checkout before the build will run.

## Rollout

Ships in the APK (`assembleDebug` → Desktop `Carfectionist-POS.apk`); tablets receive it
through the existing in-app update offer.
