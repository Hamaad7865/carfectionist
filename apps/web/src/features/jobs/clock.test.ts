import { describe, it, expect } from "vitest";
import { jobClock } from "./clock";

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
