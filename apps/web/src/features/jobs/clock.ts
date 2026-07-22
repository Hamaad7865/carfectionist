/**
 * The canonical job clock, shared with the Android POS:
 *   elapsed = (ready_at | delivered_at | now) − started_at − paused_ms
 *             − (now − paused_at, while a pause is open)
 * A job runs from Start to Ready as wall time, minus its pauses — there is no
 * separate stop. Jobs that were only ever driven by the web's old start/stop
 * timer rows have no started_at; jobClock returns null and the caller falls
 * back to summing job_timers segments.
 */
export interface JobClockRow {
  status: string;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  /** Cancelling ends the clock too — without it a dropped car accrues time for
   *  ever (one cancelled after 3 minutes read 16:55:00 the next morning). */
  cancelledAt?: string | null;
  pausedAt: string | null;
  pausedMs: number | null;
}

export interface JobEstimateRow extends JobClockRow {
  scheduledAt: string | null;
  estimatedMinutes: number | null;
}

export interface JobClockState {
  elapsedSeconds: number;
  /** The clock is ticking — drives the live counter and the board's dot. */
  running: boolean;
  paused: boolean;
}

export function jobClock(j: JobClockRow, nowMs: number): JobClockState | null {
  if (!j.startedAt) return null;
  const started = Date.parse(j.startedAt);
  if (Number.isNaN(started)) return null;

  const endIso = j.readyAt ?? j.deliveredAt ?? j.cancelledAt ?? null;
  const end = endIso ? Date.parse(endIso) : nowMs;
  // A finished job's clock stopped at ready — an unfolded pause no longer counts.
  const paused = j.pausedAt != null && !endIso;
  const pausedSince = paused ? Date.parse(j.pausedAt as string) : NaN;
  const openPauseMs = Number.isNaN(pausedSince) ? 0 : Math.max(0, nowMs - pausedSince);

  const elapsedMs = Math.max(0, end - started - (j.pausedMs ?? 0) - openPauseMs);
  return {
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    running: j.status === "in_progress" && !paused,
    paused,
  };
}

/**
 * When the car is expected to be done, as epoch ms — the companion to jobClock.
 *   not started → scheduled_at + estimate
 *   running     → started_at + estimate + every pause (a paused job's ETA slides,
 *                 which is the whole point of pausing)
 *   finished    → null; ready_at is the truth and no estimate competes with it
 * Null whenever nobody estimated, or there is no anchor to count from — callers must
 * render nothing rather than invent a time.
 */
export function estimatedFinish(j: JobEstimateRow, nowMs: number): number | null {
  if (!j.estimatedMinutes || j.estimatedMinutes <= 0) return null;
  if (j.readyAt || j.deliveredAt || j.status === "cancelled") return null;
  const estMs = j.estimatedMinutes * 60_000;

  if (!j.startedAt) {
    if (!j.scheduledAt) return null;
    const scheduled = Date.parse(j.scheduledAt);
    return Number.isNaN(scheduled) ? null : scheduled + estMs;
  }

  const started = Date.parse(j.startedAt);
  if (Number.isNaN(started)) return null;

  const pausedSince = j.pausedAt ? Date.parse(j.pausedAt) : NaN;
  const openPauseMs = Number.isNaN(pausedSince) ? 0 : Math.max(0, nowMs - pausedSince);
  return started + estMs + (j.pausedMs ?? 0) + openPauseMs;
}
