import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { sendDocument } from "@/lib/send-document";

// Scheduled-send processor. A pg_cron job POSTs here every few minutes with the
// shared CRON_SECRET; we claim every due row atomically (claim_due_scheduled_sends
// flips them to 'sending' under FOR UPDATE SKIP LOCKED, so overlapping runs never
// double-dispatch) and deliver each through the SAME path as a manual send.
//
// A "reminder" row cancels itself if the invoice was paid or voided in the
// meantime — the whole point of chasing only what's still owed.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Claimed {
  id: string;
  document_id: string;
  channel: "email" | "whatsapp";
  to_addr: string;
  note: string | null;
  kind: "send" | "reminder";
  only_if_unpaid: boolean;
}

const ORIGIN = "https://app-carfectionist.com";

export async function POST(req: Request) {
  const expected = serverEnv("CRON_SECRET");
  if (!expected) return json({ ok: false, error: "CRON_SECRET not configured" }, 503);
  if (req.headers.get("x-cron-secret") !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any).rpc("claim_due_scheduled_sends", { p_limit: 50 });
  if (error) return json({ ok: false, error: error.message }, 500);

  const claimed = (rows ?? []) as Claimed[];
  let sent = 0, skipped = 0, failed = 0;

  const finish = (id: string, status: "sent" | "failed" | "skipped", err?: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).rpc("finish_scheduled_send", { p_id: id, p_status: status, p_error: err ?? null });

  for (const row of claimed) {
    try {
      // Reminder that's no longer owed → skip.
      if (row.only_if_unpaid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: doc } = await (admin as any)
          .from("documents")
          .select("status, amount_paid, total_incl")
          .eq("id", row.document_id)
          .maybeSingle();
        const paid = doc && (["paid", "void"].includes(doc.status) || Number(doc.amount_paid) >= Number(doc.total_incl));
        if (!doc || paid) {
          await finish(row.id, "skipped", doc ? "already settled" : "document gone");
          skipped++;
          continue;
        }
      }

      const r = await sendDocument({
        sb: admin, // service role: RLS bypassed, actor recorded as system
        docId: row.document_id,
        channel: row.channel,
        to: row.to_addr,
        note: row.note,
        origin: ORIGIN,
      });
      if (r.ok) {
        await finish(row.id, "sent");
        sent++;
      } else {
        await finish(row.id, "failed", r.error);
        failed++;
      }
    } catch (e) {
      await finish(row.id, "failed", (e as Error).message);
      failed++;
    }
  }

  return json({ ok: true, claimed: claimed.length, sent, skipped, failed });
}
