"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { receiptToken } from "@/lib/receipt-token";
import { sendReceiptEmail } from "@/lib/email";
import { logAudit } from "@/lib/supabase/audit";

type Result = { ok: true } | { ok: false; error: string };

const schema = z.object({ docId: z.string(), email: z.string().trim().email().max(160) });

/** Email the customer their ticket (branded mail + public tokenized link). */
export async function sendReceiptEmailAction(input: z.infer<typeof schema>): Promise<Result> {
  const ctx = await requireRole("owner", "manager", "cashier");
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter a valid email address." };

  // RLS-scoped load doubles as the tenant check — a foreign id yields null.
  const r = await getReceipt(p.data.docId);
  if (!r || !r.number) return { ok: false, error: "Ticket not found (is it issued?)." };

  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const link = `${proto}://${host}/t/${encodeURIComponent(await receiptToken(p.data.docId))}`;

  const sent = await sendReceiptEmail({
    to: p.data.email,
    number: r.number,
    dateLabel: r.dateLabel,
    totalCents: r.totalCents,
    link,
    studioName: r.studioName,
  });
  if (!sent.ok) return sent;

  // Traceability: the customer got their ticket by mail.
  const sb = await createClient();
  const { data: au } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  await logAudit(sb, {
    tenantId: ctx.tenantId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actorId: ((au as any)?.id as string) ?? null,
    eventType: "receipt_emailed",
    refType: "document",
    refId: p.data.docId,
    payload: { number: r.number, to: p.data.email },
    deviceId: "back-office",
  });
  return { ok: true };
}
