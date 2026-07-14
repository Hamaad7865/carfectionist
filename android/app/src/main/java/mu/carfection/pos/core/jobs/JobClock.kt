package mu.carfection.pos.core.jobs

import mu.carfection.pos.core.network.JobBoardDto
import java.time.OffsetDateTime

/**
 * The job clock, and the one mirror of apps/web/src/features/jobs/clock.ts. Both apps
 * must agree to the second on how long a car has been worked on and when it is due —
 * so the rules live in exactly one place per platform and nowhere else.
 *
 *   elapsed = (ready | delivered | now) − started − paused_ms − (now − paused_at, if paused)
 *   eta     = not started → scheduled + estimate
 *             running     → started + estimate + every pause (a paused ETA slides)
 *             finished    → none; the real ready time is the truth
 */
object JobClock {

    fun epoch(iso: String?): Long? =
        iso?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }

    /** Milliseconds of work on the car so far. */
    fun elapsedMs(j: JobBoardDto, nowMs: Long): Long? {
        val started = epoch(j.startedAt) ?: return null
        val endIso = j.readyAt ?: j.deliveredAt
        val end = epoch(endIso) ?: nowMs
        // A finished job's clock stopped at ready — an unfolded pause no longer counts.
        val openPause = if (endIso == null) openPauseMs(j, nowMs) else 0L
        return (end - started - j.pausedMs - openPause).coerceAtLeast(0L)
    }

    /** Time swallowed by a pause that is still open right now. */
    fun openPauseMs(j: JobBoardDto, nowMs: Long): Long =
        epoch(j.pausedAt)?.let { (nowMs - it).coerceAtLeast(0L) } ?: 0L

    /**
     * When the car should be done, as epoch millis — or null when nobody estimated,
     * when there is nothing to count from, or when the job is already finished and the
     * real time has replaced the guess. Callers must show nothing rather than invent one.
     */
    fun estimatedFinishMs(j: JobBoardDto, nowMs: Long): Long? {
        val mins = j.estimatedMinutes?.takeIf { it > 0 } ?: return null
        if (j.readyAt != null || j.deliveredAt != null || j.status == "cancelled") return null
        val estMs = mins * 60_000L

        val started = epoch(j.startedAt)
            ?: return epoch(j.scheduledAt)?.plus(estMs) // not started: count from the booking

        return started + estMs + j.pausedMs + openPauseMs(j, nowMs)
    }
}
