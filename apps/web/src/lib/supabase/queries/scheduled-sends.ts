import { createClient } from "@/lib/supabase/server";

export interface ScheduledSendRow {
  id: string;
  channel: "email" | "whatsapp";
  toAddr: string;
  note: string | null;
  /** "send" = the one-off "Schedule for later"; "reminder" = an auto-reminder chaser. */
  kind: "send" | "reminder";
  scheduledAt: string;
  /** Reminders skip themselves once the invoice is paid — surfaced so a "skipped" row reads as expected, not broken. */
  onlyIfUnpaid: boolean;
  status: "pending" | "sending" | "sent" | "failed" | "skipped" | "cancelled";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** Every scheduled/reminder send queued against one document — the only place
 *  an operator can see a "Schedule for later" or auto-reminder after the fact,
 *  find out one failed, or cancel one still pending. */
export async function getScheduledSends(documentId: string): Promise<ScheduledSendRow[]> {
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("scheduled_sends")
    .select("id, channel, to_addr, note, kind, scheduled_at, only_if_unpaid, status, attempts, last_error, created_at, processed_at")
    .eq("document_id", documentId)
    .order("scheduled_at");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    channel: r.channel,
    toAddr: r.to_addr,
    note: r.note,
    kind: r.kind,
    scheduledAt: r.scheduled_at,
    onlyIfUnpaid: r.only_if_unpaid,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    processedAt: r.processed_at,
  }));
}
