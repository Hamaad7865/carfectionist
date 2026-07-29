import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { sendDocument } from "@/lib/send-document";

// Scheduled-send processor. A pg_cron job POSTs here every few minutes; we claim
// every due row atomically (claim_due_scheduled_sends flips them to 'sending'
// under FOR UPDATE SKIP LOCKED, so overlapping runs never double-dispatch) and
// deliver each through the SAME path as a manual send.
//
// Auth: the caller must present sha256(SERVICE_ROLE_KEY). That derives from a
// secret the Worker already holds — no new secret to provision — and the hash
// itself is one-way (it can't recover the key) and only authorises triggering a
// run of already-scheduled work.
//
// A "reminder" row cancels itself if the invoice was paid or voided in the
// meantime — the whole point of chasing only what's still owed.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const key = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return json({ ok: false, error: "server not configured" }, 503);
  const expected = await sha256hex(key);
  if (req.headers.get("x-cron-key") !== expected) return json({ ok: false, error: "unauthorized" }, 401);

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
      // A row can sit claimed ('sending') for a moment before we get here — long
      // enough for the desk to void the document out from under it. Check every
      // claimed row (not just reminders): a plain "send" claimed just before the
      // void must not go out looking like a live payable invoice.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: doc } = await (admin as any)
        .from("documents")
        .select("status, amount_paid, total_incl")
        .eq("id", row.document_id)
        .maybeSingle();
      if (!doc || doc.status === "void") {
        await finish(row.id, "skipped", doc ? "document voided" : "document gone");
        skipped++;
        continue;
      }

      // Reminder that's no longer owed → skip.
      if (row.only_if_unpaid) {
        const paid = doc.status === "paid" || Number(doc.amount_paid) >= Number(doc.total_incl);
        if (paid) {
          await finish(row.id, "skipped", "already settled");
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
