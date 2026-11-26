import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

const { rpcMocks } = vi.hoisted(() => ({
  rpcMocks: { convertAppointmentToJob: vi.fn() },
}));

let db: unknown;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => ({
    userId: "aaaaaaaa-0000-4000-8000-000000000001",
    tenantId: "1f060b86-ad63-4dc7-93fb-a1fdfae18b27",
    role: "owner",
    displayName: "Owner",
    modules: null,
  })),
}));
vi.mock("@/lib/supabase/rpc", () => rpcMocks);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  convertAppointmentToJobAction,
  createAppointmentAction,
  createAppointmentFromJobAction,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  rpcMocks.convertAppointmentToJob.mockResolvedValue({ id: "jjjjjjjj-0000-4000-8000-000000000001" });
});

describe("convertAppointmentToJobAction", () => {
  it("passes the original booking to the scheduled conversion path", async () => {
    const appointment = {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      customer_id: "cccccccc-0000-4000-8000-000000000001",
      vehicle_id: "vvvvvvvv-0000-4000-8000-000000000001",
      service: "Alignment",
      department: "Old tyre bay",
      technician_id: null,
      job_id: null,
      status: "scheduled",
      scheduled_at: "2026-11-24T06:00:00.000Z",
    };
    db = fakeAdmin({ appointments: [appointment], jobs: [] });

    const result = await convertAppointmentToJobAction(appointment.id);

    expect(result).toEqual({
      ok: true,
      data: { jobId: "jjjjjjjj-0000-4000-8000-000000000001" },
    });
    expect(rpcMocks.convertAppointmentToJob).toHaveBeenCalledWith(
      db,
      appointment.id,
      false,
      expect.any(Array),
    );
  });

  it("can start an appointment's job immediately", async () => {
    db = fakeAdmin({});
    const id = "aaaaaaaa-0000-4000-8000-000000000002";

    const result = await convertAppointmentToJobAction(id, "start_now");

    expect(result).toEqual({
      ok: true,
      data: { jobId: "jjjjjjjj-0000-4000-8000-000000000001" },
    });
    expect(rpcMocks.convertAppointmentToJob).toHaveBeenCalledWith(
      db,
      id,
      true,
      expect.any(Array),
    );
  });
});

describe("createAppointmentAction", () => {
  it("stores the tablet alignment fields for a tyre appointment", async () => {
    const customerId = "cccccccc-0000-4000-8000-000000000001";
    const vehicleId = "vvvvvvvv-0000-4000-8000-000000000001";
    const appointments: Record<string, unknown>[] = [];
    db = fakeAdmin({
      customers: [{ id: customerId }],
      vehicles: [{ id: vehicleId, customer_id: customerId }],
      appointments,
    });

    const result = await createAppointmentAction({
      customerId,
      vehicleId,
      service: "Wheel alignment",
      scheduledAt: "2026-11-30T04:30:00.000Z",
      durationMinutes: 45,
      alignedOn: "2026-06-24",
      alignedAtKm: 84_500,
      nextAtKm: 89_500,
      notes: "Pulls left",
    });

    expect(result).toEqual({ ok: true });
    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      aligned_on: "2026-06-24",
      aligned_at_km: 84_500,
      next_at_km: 89_500,
      duration_minutes: 45,
      notes: "Pulls left",
    });
  });
});

describe("createAppointmentFromJobAction", () => {
  it("creates an optional follow-up from a finished job", async () => {
    const jobId = "bbbbbbbb-0000-4000-8000-000000000001";
    const appointments: Record<string, unknown>[] = [];
    db = fakeAdmin({
      jobs: [{
        id: jobId,
        status: "ready",
        customer_id: "cccccccc-0000-4000-8000-000000000001",
        vehicle_id: "vvvvvvvv-0000-4000-8000-000000000001",
        service: "Wheel alignment",
        department: "Tyre bay",
        technician_id: null,
      }],
      appointments,
    });

    const result = await createAppointmentFromJobAction({
      jobId,
      scheduledAt: "2026-12-24T04:30:00.000Z",
      durationMinutes: 45,
      alignedOn: "2026-11-26",
      alignedAtKm: 89_500,
      nextAtKm: 94_500,
    });

    expect(result).toEqual({ ok: true });
    expect(appointments[0]).toMatchObject({
      customer_id: "cccccccc-0000-4000-8000-000000000001",
      vehicle_id: "vvvvvvvv-0000-4000-8000-000000000001",
      scheduled_at: "2026-12-24T04:30:00.000Z",
      status: "scheduled",
      aligned_at_km: 89_500,
      next_at_km: 94_500,
    });
  });

  it("refuses a follow-up from an unfinished job", async () => {
    const jobId = "bbbbbbbb-0000-4000-8000-000000000002";
    db = fakeAdmin({
      jobs: [{ id: jobId, status: "in_progress", customer_id: "customer", vehicle_id: "vehicle" }],
    });

    const result = await createAppointmentFromJobAction({
      jobId,
      scheduledAt: "2026-12-24T04:30:00.000Z",
      durationMinutes: 45,
      alignedOn: "2026-11-26",
      alignedAtKm: 89_500,
      nextAtKm: 94_500,
    });

    expect(result).toEqual({
      ok: false,
      error: "Finish the job before booking its next appointment.",
    });
  });
});
