import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { mergeSharedTillSessions } from "./pos-devices";

const s = (id: string, device_id: string, opened_at: string) => ({ id, device_id, opened_at });

describe("a tablet's page shows the shared till", () => {
  it("includes the back-office till the shop shared on 14 Oct", () => {
    const own = [s("13oct", "TAB-84A1", "2026-10-13T09:34:43Z")];
    const shared = [s("14oct", "back-office", "2026-10-14T10:53:49Z")];
    expect(mergeSharedTillSessions(own, shared).map((x) => x.id)).toEqual(["14oct", "13oct"]);
  });
  it("leaves out back-office tills from before the drawer was shared", () => {
    expect(mergeSharedTillSessions([], [s("sep", "back-office", "2026-09-30T10:00:00Z")])).toEqual([]);
  });
  it("lists a session once", () => {
    const x = s("a", "back-office", "2026-10-14T10:00:00Z");
    expect(mergeSharedTillSessions([x], [x])).toHaveLength(1);
  });
});
