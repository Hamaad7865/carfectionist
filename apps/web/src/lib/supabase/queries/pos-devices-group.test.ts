import { describe, expect, it } from "vitest";
import { groupDeviceRows } from "./pos-devices";

// 2026-11-14: the NEOSTRA till's app data was wiped and it came back as TAB-BDAD and then
// TAB-36FA. Linked, the three codes are ONE tablet: its page lists all three codes so the
// Cash Flow / Traceability queries span the whole history.
const row = (id: string, code: string, merged_into: string | null = null, last_seen = "2026-11-14T00:00:00Z") =>
  ({ id, device_code: code, merged_into, last_seen });

describe("groupDeviceRows", () => {
  it("folds earlier codes under the tablet in use and maps them to its code", () => {
    const { canonical, earlierOf, canonicalCode } = groupDeviceRows([
      row("a", "TAB-84A1", "c", "2026-11-13T13:38:00Z"),
      row("b", "TAB-BDAD", "c", "2026-11-14T06:44:00Z"),
      row("c", "TAB-36FA"),
      row("d", "TAB-66D2"),
    ]);
    expect(canonical.map((r) => r.device_code)).toEqual(["TAB-36FA", "TAB-66D2"]);
    // newest earlier code first
    expect(earlierOf.get("c")!.map((r) => r.device_code)).toEqual(["TAB-BDAD", "TAB-84A1"]);
    expect(canonicalCode.get("TAB-84A1")).toBe("TAB-36FA");
    expect(canonicalCode.get("TAB-66D2")).toBeUndefined();
  });

  it("keeps a row whose link target is missing or itself linked as its own device", () => {
    const { canonical } = groupDeviceRows([
      row("a", "TAB-OLD", "gone"),
      row("b", "TAB-MID", "c"),
      row("c", "TAB-NEW", "b"), // a cycle the DB never writes — nothing may vanish
    ]);
    expect(canonical.map((r) => r.device_code).sort()).toEqual(["TAB-MID", "TAB-NEW", "TAB-OLD"]);
  });
});
