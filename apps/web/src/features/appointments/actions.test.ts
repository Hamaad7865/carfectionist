import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

const { rpcMocks, scheduleMock } = vi.hoisted(() => ({
  rpcMocks: { createJob: vi.fn() },
  scheduleMock: vi.fn(),
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
vi.mock("@/features/jobs/actions", () => ({ setJobScheduleAction: scheduleMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { convertAppointmentToJobAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  rpcMocks.createJob.mockResolvedValue({ id: "jjjjjjjj-0000-4000-8000-000000000001" });
  scheduleMock.mockResolvedValue({ ok: true });
});

describe("convertAppointmentToJobAction", () => {
  it("preserves a deleted place snapshot from an existing appointment", async () => {
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
    expect(rpcMocks.createJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ department: "Old tyre bay" }),
    );
    expect(appointment).toMatchObject({
      job_id: "jjjjjjjj-0000-4000-8000-000000000001",
      status: "arrived",
    });
  });
});
