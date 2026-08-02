package mu.carfection.pos.core.notify

import mu.carfection.pos.core.jobs.JobClock
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
        val past = requireNotNull(JobClock.epoch(j.startedAt)) + 61 * 60_000L
        assertTrue(stillTrue(j, JobAlert.LATE, past))
    }

    @Test
    fun `late stays quiet before the estimate is reached`() {
        val j = job(
            status = "in_progress",
            startedAt = "2026-08-01T10:00:00+04:00",
            estimatedMinutes = 60,
        )
        val early = requireNotNull(JobClock.epoch(j.startedAt)) + 10 * 60_000L
        assertFalse(stillTrue(j, JobAlert.LATE, early))
    }

    @Test
    fun `late stays quiet for a job paused past its original estimate`() {
        // Paused at +30min of a 60min job: the ETA slides with the pause, so at what
        // would have been the finish line it is not late.
        val started = "2026-08-01T10:00:00+04:00"
        val startMs = requireNotNull(JobClock.epoch(started))
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
