import { describe, expect, it } from "vitest";
import { readOverrideResult } from "./response";

/**
 * The shape below is not invented — it is what `admin.rpc("record_owner_override", …)`
 * actually returns against the live database, captured on 2026-08-11. The route
 * originally read `data.id` off it, which is `undefined` for every field, so a
 * successful approval answered `{"override":{}}` and quietly told nobody.
 */
const APPROVED = {
  ok: true,
  override: {
    id: "3a9ab0bd-1870-46fb-b610-2f087c5b4d8d",
    kind: "discount",
    scope: { max_discount_incl: 500 },
    reason: "goodwill",
    ref_id: "745d1f32-8fd0-4a5f-9c1e-1b2c3d4e5f60",
    ref_type: "document",
    tenant_id: "11111111-1111-4111-8111-000000000001",
    created_at: "2026-08-11T09:15:00.000Z",
    approved_by: "7a3756a9-f7c5-4492-bd6d-9e15f015dc77",
    consumed_at: null,
  },
};

describe("readOverrideResult", () => {
  it("populates the row from the wrapper's override object", () => {
    const r = readOverrideResult(APPROVED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The regression: every one of these was undefined when the route read data.id.
    expect(r.override.id).toBe("3a9ab0bd-1870-46fb-b610-2f087c5b4d8d");
    expect(r.override.kind).toBe("discount");
    expect(r.override.refType).toBe("document");
    expect(r.override.refId).toBe("745d1f32-8fd0-4a5f-9c1e-1b2c3d4e5f60");
    expect(r.override.createdAt).toBe("2026-08-11T09:15:00.000Z");
  });

  it("survives the body being JSON round-tripped, which is how it reaches a caller", () => {
    const r = readOverrideResult(APPROVED);
    if (!r.ok) throw new Error("expected ok");
    // JSON.stringify drops undefined keys — an empty object here is the exact
    // symptom the original bug produced over the wire.
    expect(JSON.parse(JSON.stringify(r.override))).not.toEqual({});
  });

  it("unwraps an array-wrapped single row", () => {
    const r = readOverrideResult([APPROVED]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.override.id).toBe(APPROVED.override.id);
  });

  it("treats a rejected PIN as a refusal, not an approval", () => {
    // This arrives in `data`, NOT in `error` — the function answers rather than
    // raising so the attempt counter commits. A caller inspecting only `error`
    // would report this refusal as a granted approval.
    const r = readOverrideResult({ ok: false, reason: "bad_pin", locked_until: null });
    expect(r).toEqual({ ok: false, reason: "bad_pin" });
  });

  it("falls back to a generic reason when none is given", () => {
    expect(readOverrideResult({ ok: false })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses rather than throwing on null, undefined or a bare row", () => {
    expect(readOverrideResult(null).ok).toBe(false);
    expect(readOverrideResult(undefined).ok).toBe(false);
    // A bare public.owner_overrides row has no `ok`, so it must NOT be read as
    // an approval — that misreading is what this module exists to prevent.
    expect(readOverrideResult({ id: "x", kind: "discount" }).ok).toBe(false);
  });

  it("does not invent fields the wrapper omitted", () => {
    const r = readOverrideResult({ ok: true, override: { id: "only-an-id" } });
    if (!r.ok) throw new Error("expected ok");
    expect(r.override.id).toBe("only-an-id");
    expect(r.override.kind).toBeUndefined();
  });
});
