// Best-effort writer for the audit_events log. Callers pass the acting user's
// app_user id (the actor) and tenant explicitly; the insert goes through the
// caller's client (RLS: any tenant member may insert). Audit is a side-record —
// it must NEVER throw and break the underlying action.
export interface AuditInput {
  tenantId: string;
  actorId: string | null;
  eventType: string;
  refType?: string | null;
  refId?: string | null;
  payload?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logAudit(sb: any, ev: AuditInput): Promise<void> {
  try {
    await sb.from("audit_events").insert({
      tenant_id: ev.tenantId,
      actor_id: ev.actorId,
      event_type: ev.eventType,
      ref_type: ev.refType ?? null,
      ref_id: ev.refId ?? null,
      payload: ev.payload ?? {},
    });
  } catch {
    /* never let audit failure surface to the user */
  }
}
