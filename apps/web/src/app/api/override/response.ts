/**
 * Reading what record_owner_override answered.
 *
 * The RPC does NOT hand back a bare public.owner_overrides row, and assuming it
 * did is a mistake this file exists to stop repeating. It returns jsonb:
 *
 *     { ok: true,  override: { id, kind, ref_type, ref_id, created_at, … } }
 *     { ok: false, reason: 'bad_pin' | 'locked' | …, locked_until }
 *
 * Two things drove that shape (see 20260810000080, which supersedes the
 * `returns public.owner_overrides` wrapper in 20260810000070):
 *
 *   • A REJECTED PIN IS AN ANSWER, NOT AN EXCEPTION. Raising rolled back the
 *     attempt counter verify_staff_pin had just incremented, so every wrong
 *     guess was free — a 4-digit secret with a silently reverted lockout. The
 *     `ok:false` branch therefore arrives in `data`, never in `error`, and a
 *     caller that only inspects `error` reports a refusal as an approval.
 *   • `app` is not a PostgREST-exposed schema here, so calls go through the
 *     public wrapper; both now return jsonb.
 *
 * Kept out of route.ts so it can be tested without standing up a request. The
 * bug this guards against was invisible in production for a while precisely
 * because both callers only check the HTTP status and never read the body.
 */

export interface OverrideRow {
  id?: string;
  kind?: string;
  refType?: string;
  refId?: string;
  createdAt?: string;
}

export type OverrideResult =
  | { ok: false; reason: string }
  | { ok: true; override: OverrideRow };

/**
 * Normalise the RPC's answer. `data` is typed loosely on purpose — it arrives
 * from an untyped .rpc() call, and being strict here would only push the `any`
 * up into the route.
 */
export function readOverrideResult(data: unknown): OverrideResult {
  // PostgREST hands a single-row result back array-wrapped in some shapes;
  // getSessionContext carries the same unwrap for the same reason.
  const result = (Array.isArray(data) ? data[0] : data) as
    | { ok?: unknown; reason?: unknown; override?: Record<string, unknown> }
    | null
    | undefined;

  if (!result?.ok) {
    return { ok: false, reason: typeof result?.reason === "string" ? result.reason : "invalid" };
  }

  const row = (result.override ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return {
    ok: true,
    override: {
      id: str(row.id),
      kind: str(row.kind),
      refType: str(row.ref_type),
      refId: str(row.ref_id),
      createdAt: str(row.created_at),
    },
  };
}
