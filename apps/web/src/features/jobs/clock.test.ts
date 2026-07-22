import { describe, it, expect } from "vitest";
import { jobClock, estimatedFinish } from "./clock";

const T0 = Date.parse("2026-07-11T08:00:00Z");
const min = (n: number) => n * 60_000;

const base = {
  status: "in_progress",
  startedAt: "2026-07-11T08:00:00Z",
  readyAt: null,
  deliveredAt: null,
  pausedAt: null,
  pausedMs: 0,
};

describe("jobClock — the canonical POS clock on the web", () => {
  it("ticks as wall time from started_at while in progress", () => {
    const c = jobClock(base, T0 + min(30));
    expect(c).toEqual({ elapsedSeconds: 30 * 60, running: true, paused: false });
  });

  it("freezes while paused: open pause is subtracted and the tick stops", () => {
    // Paused at +20min, observed at +30min → clock shows 20min, not 30.
    const c = jobClock({ ...base, pausedAt: "2026-07-11T08:20:00Z" }, T0 + min(30));
    expect(c).toEqual({ elapsedSeconds: 20 * 60, running: false, paused: true });
  });

  it("subtracts folded paused_ms after a resume", () => {
    // 10 minutes of accumulated pause, observed at +30min → 20min on the job.
    const c = jobClock({ ...base, pausedMs: min(10) }, T0 + min(30));
    expect(c).toEqual({ elapsedSeconds: 20 * 60, running: true, paused: false });
  });

  it("stops at ready_at — later observation doesn't grow the clock", () => {
    const c = jobClock(
      { ...base, status: "ready", readyAt: "2026-07-11T08:45:00Z", pausedMs: min(5) },
      T0 + min(600),
    );
    expect(c).toEqual({ elapsedSeconds: 40 * 60, running: false, paused: false });
  });

  it("ignores a stale open pause once the job is ready", () => {
    // markReady folds pauses, but a missed fold must not push the clock negative
    // or show a ready job as paused.
    const c = jobClock(
      { ...base, status: "ready", readyAt: "2026-07-11T08:45:00Z", pausedAt: "2026-07-11T08:40:00Z" },
      T0 + min(600),
    );
    expect(c).toEqual({ elapsedSeconds: 45 * 60, running: false, paused: false });
  });

  it("clamps at zero if pause bookkeeping overshoots", () => {
    const c = jobClock({ ...base, pausedMs: min(60) }, T0 + min(30));
    expect(c?.elapsedSeconds).toBe(0);
  });

  it("returns null without started_at (legacy web stopwatch jobs)", () => {
    expect(jobClock({ ...base, startedAt: null }, T0)).toBeNull();
  });

  it("a scheduled job with a start stamp does not tick", () => {
    const c = jobClock({ ...base, status: "scheduled" }, T0 + min(5));
    expect(c?.running).toBe(false);
  });
});

const est = {
  ...base,
  status: "scheduled",
  startedAt: null,
  scheduledAt: "2026-07-11T08:00:00Z",
  estimatedMinutes: 90,
};

describe("estimatedFinish — when the car should be done", () => {
  it("counts from the booking while the job has not started", () => {
    // Booked 08:00, 90min of work → 09:30, no matter when we ask.
    expect(estimatedFinish(est, T0 - min(120))).toBe(T0 + min(90));
  });

  it("counts from the actual start once running — a late start pushes the ETA out", () => {
    // Booked 08:00 but only started 08:20 → done 09:50, not 09:30.
    const j = { ...est, status: "in_progress", startedAt: "2026-07-11T08:20:00Z" };
    expect(estimatedFinish(j, T0 + min(30))).toBe(T0 + min(20 + 90));
  });

  it("slides while paused — an open pause pushes the ETA out in real time", () => {
    // Paused at +30, observed at +50 → 20min of pause so far → ETA 09:50.
    const j = { ...est, status: "in_progress", startedAt: "2026-07-11T08:00:00Z", pausedAt: "2026-07-11T08:30:00Z" };
    expect(estimatedFinish(j, T0 + min(50))).toBe(T0 + min(90 + 20));
  });

  it("carries folded pauses after a resume", () => {
    const j = { ...est, status: "in_progress", startedAt: "2026-07-11T08:00:00Z", pausedMs: min(15) };
    expect(estimatedFinish(j, T0 + min(40))).toBe(T0 + min(90 + 15));
  });

  it("gives no estimate once the job is ready — the real time wins", () => {
    const j = { ...est, status: "ready", startedAt: "2026-07-11T08:00:00Z", readyAt: "2026-07-11T09:00:00Z" };
    expect(estimatedFinish(j, T0 + min(120))).toBeNull();
  });

  it("gives no estimate when nobody estimated", () => {
    expect(estimatedFinish({ ...est, estimatedMinutes: null }, T0)).toBeNull();
    expect(estimatedFinish({ ...est, estimatedMinutes: 0 }, T0)).toBeNull();
  });

  it("gives no estimate with nothing to count from", () => {
    // Never booked, never started — an estimate alone anchors to nothing.
    expect(estimatedFinish({ ...est, scheduledAt: null }, T0)).toBeNull();
  });

  it("gives no estimate for a cancelled job", () => {
    expect(estimatedFinish({ ...est, status: "cancelled" }, T0)).toBeNull();
  });
});

describe("a cancelled job's clock", () => {
  const base = {
    status: "cancelled",
    startedAt: "2026-07-21T12:01:00.000Z",
    readyAt: null,
    deliveredAt: null,
    pausedAt: null,
    pausedMs: 0,
  };
  // 16 hours after it was cancelled — the bug: with no end marker the clock
  // ran to "now", so a car dropped after 3 minutes read 16:55:00 next morning.
  const nextMorning = Date.parse("2026-07-22T04:56:00.000Z");

  it("stops at cancelled_at instead of running to now", () => {
    const c = jobClock({ ...base, cancelledAt: "2026-07-21T12:03:39.000Z" }, nextMorning);
    expect(c?.elapsedSeconds).toBe(159); // 2m39s — what the car actually took
    expect(c?.running).toBe(false);
  });

  it("still prefers ready/delivered when both exist", () => {
    const c = jobClock(
      { ...base, status: "delivered", readyAt: "2026-07-21T12:10:00.000Z", cancelledAt: "2026-07-21T13:00:00.000Z" },
      nextMorning,
    );
    expect(c?.elapsedSeconds).toBe(540); // 9 minutes, from ready — not the cancel stamp
  });
});
