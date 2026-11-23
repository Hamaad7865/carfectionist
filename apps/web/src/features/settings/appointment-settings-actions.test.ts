import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

const { rpcMocks } = vi.hoisted(() => ({
  rpcMocks: {
    saveWorkPlace: vi.fn(),
    deleteWorkPlace: vi.fn(),
  },
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
  deleteWorkPlaceAction,
  saveAppointmentReminderAction,
  saveWorkPlaceAction,
} from "./appointment-settings-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("appointment settings actions", () => {
  it("stores the reminder window on the current tenant only", async () => {
    const tables = {
      business_settings: [
        { id: "1f060b86-ad63-4dc7-93fb-a1fdfae18b27", appointment_reminder_days: 3 },
        { id: "11111111-1111-4111-8111-000000000001", appointment_reminder_days: 3 },
      ],
    };
    db = fakeAdmin(tables);

    const result = await saveAppointmentReminderAction({ reminderDays: 7 });

    expect(result).toEqual({ ok: true });
    expect(tables.business_settings[0].appointment_reminder_days).toBe(7);
    expect(tables.business_settings[1].appointment_reminder_days).toBe(3);
  });

  it("rejects an out-of-range reminder window before writing", async () => {
    db = fakeAdmin({ business_settings: [] });

    const result = await saveAppointmentReminderAction({ reminderDays: 31 });

    expect(result).toEqual({
      ok: false,
      error: "Keep the reminder window to 30 days or less",
    });
  });

  it("routes work-place create and rename through the guarded RPC", async () => {
    db = fakeAdmin({});
    rpcMocks.saveWorkPlace.mockResolvedValue({ id: "place-1", name: "Main workshop" });

    const result = await saveWorkPlaceAction({ id: null, name: "  Main workshop  " });

    expect(result).toEqual({ ok: true });
    expect(rpcMocks.saveWorkPlace).toHaveBeenCalledWith(db, { id: null, name: "Main workshop" });
  });

  it("routes deletion through the guarded RPC", async () => {
    db = fakeAdmin({});
    rpcMocks.deleteWorkPlace.mockResolvedValue(true);

    const result = await deleteWorkPlaceAction({ id: "aaaaaaaa-0000-4000-8000-000000000001" });

    expect(result).toEqual({ ok: true });
    expect(rpcMocks.deleteWorkPlace).toHaveBeenCalledWith(
      db,
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
  });
});
