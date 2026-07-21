"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { resolveShopLocationId } from "@/lib/supabase/locations";
import { backOfficeTillId } from "@/lib/supabase/till";
import * as rpc from "@/lib/supabase/rpc";
import { saveDraftInputSchema, toRpcDoc, toRpcLines, type SaveDraftInput } from "./payload";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const WRITE_ROLES = ["owner", "manager", "cashier"] as const;

export async function saveDraftAction(input: SaveDraftInput): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const parsed = saveDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid draft: " + parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const sb = await createClient();
  try {
    const doc = await rpc.saveDraft(
      sb,
      toRpcDoc(parsed.data.doc),
      toRpcLines(parsed.data.lines),
      parsed.data.expectedRev ?? null,
    );
    revalidatePath("/sales");
    return { ok: true, data: doc };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const issueSchema = z.object({
  documentId: z.string(),
  stockLocationId: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

export async function issueDocumentAction(input: z.infer<typeof issueSchema>): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  try {
    // The desk's till: a ticket issued here belongs to the desk's service on the cash-up.
    const sessionId = await backOfficeTillId(sb);
    const doc = await rpc.issueDocument(sb, parsed.data.documentId, parsed.data.stockLocationId ?? null, parsed.data.idempotencyKey ?? null, sessionId);
    revalidatePath("/sales");
    revalidatePath(`/sales/${parsed.data.documentId}`);
    return { ok: true, data: doc };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const recordPaymentSchema = z.object({
  invoiceId: z.string(),
  method: z.enum(["cash", "card", "juice", "bank_transfer"]),
  amountCents: z.number().int().positive(),
  tenderedCents: z.number().int().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

export async function recordPaymentAction(
  input: z.infer<typeof recordPaymentSchema>,
): Promise<ActionResult<rpc.PaymentRow>> {
  await requireRole(...WRITE_ROLES);
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid payment" };
  const sb = await createClient();

  // Link EVERY payment to the open till session — cash so the end-of-day
  // cash-up reconciles, card/Juice/bank so the sale is traceable to a device
  // (Point of Sale module). Drawer math is untouched: close_cash_session only
  // sums method='cash'.
  // The DESK's till — never "any open till". Picking the first open session put a
  // back-office payment into a tablet's drawer and corrupted both cash-ups.
  const cashSessionId: string = await backOfficeTillId(sb);

  try {
    const pay = await rpc.recordPayment(sb, {
      invoiceId: parsed.data.invoiceId,
      method: parsed.data.method,
      amount: parsed.data.amountCents / 100,
      tendered: parsed.data.tenderedCents != null ? parsed.data.tenderedCents / 100 : null,
      externalRef: parsed.data.externalRef ?? null,
      cashSessionId,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    revalidatePath(`/sales/${parsed.data.invoiceId}`);
    revalidatePath("/sales"); // list status pill / method / amount-paid go stale otherwise
    return { ok: true, data: pay };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The customer takes the car ON ACCOUNT: delivers the bill's READY job, collects
 *  nothing — the invoice stays outstanding on their statement (same RPC as the tablet). */
export async function deliverOnAccountAction(invoiceId: string): Promise<ActionResult<boolean>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    const moved = await rpc.deliverOnAccount(sb, invoiceId);
    revalidatePath(`/sales/${invoiceId}`);
    revalidatePath("/jobs"); // the job just moved to DELIVERED
    return { ok: true, data: moved };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Walk back a mistaken on-account handover: the job returns to READY, the bill stays open. */
export async function undoOnAccountAction(invoiceId: string): Promise<ActionResult<boolean>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    const moved = await rpc.undoOnAccount(sb, invoiceId);
    revalidatePath(`/sales/${invoiceId}`);
    revalidatePath("/jobs");
    return { ok: true, data: moved };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function convertQuoteToInvoiceAction(quoteId: string): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    const inv = await rpc.convertQuoteToInvoice(sb, quoteId);
    revalidatePath("/sales");
    return { ok: true, data: inv };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function reviseQuoteAction(quoteId: string): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    const rev = await rpc.reviseQuote(sb, quoteId);
    revalidatePath("/sales");
    return { ok: true, data: rev };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function createCreditNoteAction(invoiceId: string, restock: boolean): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole("owner", "manager");
  const sb = await createClient();
  try {
    // Restocked units return to the Shop — the same on-hand the counter sale drew
    // from — matching the Android POS refund path (PosApi.issueCreditNote).
    const location = restock ? await resolveShopLocationId(sb) : null;
    // A paid invoice's refund is booked to the desk till (negative mirrors on the
    // CN) so the drawer and the Z see the money leave — same rule as the tablet.
    const sessionId = await backOfficeTillId(sb);
    const cn = await rpc.createCreditNote(sb, invoiceId, restock, location, sessionId);
    revalidatePath("/sales");
    revalidatePath(`/sales/${invoiceId}`);
    return { ok: true, data: cn };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function voidDocumentAction(id: string, reason: string): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole("owner", "manager");
  const clean = reason.trim();
  if (!clean) return { ok: false, error: "A void reason is required." };
  const sb = await createClient();
  try {
    const doc = await rpc.voidDocument(sb, id, clean);
    revalidatePath("/sales");
    revalidatePath(`/sales/${id}`);
    return { ok: true, data: doc };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteDraftAction(id: string): Promise<ActionResult<{ id: string }>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    // Draft-only, by design: the doc_delete RLS policy already restricts this to
    // draft documents (owner/manager/cashier, own tenant), and a draft has no
    // number, payments or stock movements — its lines cascade on delete. The
    // explicit status filter turns an issued/already-gone row into a clean 0-row
    // result rather than a silent no-op.
    const { data, error } = await sb.from("documents").delete().eq("id", id).eq("status", "draft").select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "This document can no longer be deleted — it may have been issued or already removed." };
    }
    revalidatePath("/sales");
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function duplicateDocumentAction(id: string): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const sb = await createClient();
  try {
    const dup = await rpc.duplicateDocument(sb, id);
    revalidatePath("/sales");
    return { ok: true, data: dup };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const sendDocSchema = z.object({
  documentId: z.string().min(1),
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().min(1).max(200),
  note: z.string().max(300).optional(),
});

/** Email / WhatsApp the document PDF to the customer (same engine as the tablet). */
export async function sendDocumentAction(input: z.infer<typeof sendDocSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(...WRITE_ROLES);
  const p = sendDocSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  const { sendDocument } = await import("@/lib/send-document");
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return sendDocument({ sb, docId: p.data.documentId, channel: p.data.channel, to: p.data.to, note: p.data.note, origin: `${proto}://${host}` });
}

const deliverSchema = z.object({
  documentId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().min(1).max(200),
  note: z.string().max(300).optional(),
  scheduleAt: z.string().min(1).optional(), // datetime-local (Mauritius time), e.g. "2026-07-16T14:30"
  autoReminders: z.boolean().optional(),
});

const REMINDER_DAYS = [3, 7]; // after the due date
const REMINDER_NOTE = "A friendly reminder that this invoice is still outstanding. Please let us know if you have any questions.";

/** The web send sheet's one entry point: send now, or schedule for later, plus
 *  optional auto-reminders on an unpaid invoice. */
export async function deliverDocumentAction(
  input: z.infer<typeof deliverSchema>,
): Promise<{ ok: true; scheduled: boolean; reminders: number } | { ok: false; error: string }> {
  await requireRole(...WRITE_ROLES);
  const p = deliverSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const { documentId, channel, to, note, scheduleAt, autoReminders } = p.data;

  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc } = await (sb as any)
    .from("documents")
    .select("id, tenant_id, doc_type, number, due_date, issue_date")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };
  if (!doc.number) return { ok: false, error: "This document is still a draft — issue it first." };

  // Normalise / validate the recipient the same way an immediate send would, so
  // a scheduled row can never hold an unsendable address.
  let toAddr = to.trim();
  if (channel === "whatsapp") {
    const { normalizePhoneMU } = await import("@/lib/phone");
    const n = normalizePhoneMU(toAddr);
    if (!n) return { ok: false, error: "That phone number doesn't look right." };
    toAddr = n;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) {
    return { ok: false, error: "That email address doesn't look right." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: me } = await sb.auth.getUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appUser } = me?.user
    ? await (sb as any).from("app_users").select("id").eq("auth_user_id", me.user.id).maybeSingle()
    : { data: null };
  const createdBy = appUser?.id ?? null;

  // ── the primary action: schedule for later, or send now ──
  let scheduled = false;
  if (scheduleAt) {
    // Interpret the naive datetime-local as Mauritius time (UTC+4, no DST).
    const when = new Date(`${scheduleAt}:00+04:00`);
    if (isNaN(when.getTime())) return { ok: false, error: "That date and time isn't valid." };
    if (when.getTime() <= Date.now() + 30_000) return { ok: false, error: "Pick a time at least a minute in the future." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from("scheduled_sends").insert({
      tenant_id: doc.tenant_id, document_id: documentId, channel, to_addr: toAddr,
      note: note ?? null, kind: "send", scheduled_at: when.toISOString(), created_by: createdBy,
    });
    if (error) return { ok: false, error: `Couldn't schedule: ${error.message}` };
    scheduled = true;
  } else {
    const { sendDocument } = await import("@/lib/send-document");
    const { headers } = await import("next/headers");
    const host = (await headers()).get("host") ?? "app-carfectionist.com";
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    const r = await sendDocument({ sb, docId: documentId, channel, to, note, origin: `${proto}://${host}` });
    if (!r.ok) return r;
  }

  // ── optional: auto-reminders on an unpaid invoice ──
  let reminders = 0;
  if (autoReminders && doc.doc_type === "invoice") {
    const baseIso = doc.due_date ?? doc.issue_date;
    const base = baseIso ? new Date(`${baseIso}T09:00:00+04:00`) : null; // 9am Mauritius
    if (base && !isNaN(base.getTime())) {
      const rows = REMINDER_DAYS
        .map((d) => new Date(base.getTime() + d * 86_400_000))
        .filter((when) => when.getTime() > Date.now() + 60_000)
        .map((when) => ({
          tenant_id: doc.tenant_id, document_id: documentId, channel, to_addr: toAddr,
          note: REMINDER_NOTE, kind: "reminder", scheduled_at: when.toISOString(),
          only_if_unpaid: true, created_by: createdBy,
        }));
      if (rows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (sb as any).from("scheduled_sends").insert(rows);
        if (!error) reminders = rows.length;
      }
    }
  }

  return { ok: true, scheduled, reminders };
}

/** Cancel a still-pending scheduled send. */
export async function cancelScheduledSendAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(...WRITE_ROLES);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Invalid id." };
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("cancel_scheduled_send", { p_id: id });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface SendContext {
  number: string | null;
  kind: "quotation" | "invoice" | "credit note" | "document";
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  replyToNumber: string | null; // the studio's own WhatsApp number (where replies land)
  connected: boolean;
}

const KIND_MAP: Record<string, SendContext["kind"]> = { quote: "quotation", invoice: "invoice", credit_note: "credit note" };

/** Everything the "Send to customer" sheet needs, for a document reached from
 *  anywhere — a list row, the builder, the detail page. */
export async function getSendContextAction(documentId: string): Promise<{ ok: true; ctx: SendContext } | { ok: false; error: string }> {
  await requireRole(...WRITE_ROLES);
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, error: "Invalid document." };
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("documents")
    .select("doc_type, number, customers(name, phone, email)")
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Document not found." };

  const { isConfigured, probeConnection } = await import("@/lib/whatsapp");
  const connected = isConfigured();
  let replyToNumber: string | null = null;
  if (connected) {
    try {
      const probe = await probeConnection();
      replyToNumber = probe?.phone.ok ? probe.phone.number ?? null : null;
    } catch {
      /* best-effort — the sheet still works without it */
    }
  }

  return {
    ok: true,
    ctx: {
      number: data.number ?? null,
      kind: KIND_MAP[data.doc_type] ?? "document",
      customerName: data.customers?.name ?? "",
      customerPhone: data.customers?.phone ?? null,
      customerEmail: data.customers?.email ?? null,
      replyToNumber,
      connected,
    },
  };
}

/** A public, unguessable link to this document's PDF — for the "Share" action
 *  (copy and paste anywhere). Possession of the token is the authorisation. */
export async function publicDocLinkAction(documentId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireRole(...WRITE_ROLES);
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, error: "Invalid document." };
  const { docToken } = await import("@/lib/receipt-token");
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return { ok: true, url: `${proto}://${host}/api/public/doc/${encodeURIComponent(await docToken(documentId))}/pdf` };
}

// ── Archive ───────────────────────────────────────────────────────────────────
// Filing a document away hides it from the working list ONLY. An issued invoice
// is a fiscal record — it keeps its number and still answers to the VAT report,
// the P&L and the statements. Void / credited / declined / expired documents
// archive themselves by derivation; this is for everything else the owner wants
// out of the way.

const ARCHIVE_ROLES = ["owner", "manager"] as const;

async function setArchived(documentId: string, archived: boolean): Promise<ActionResult<null>> {
  await requireRole(...ARCHIVE_ROLES);
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, error: "Invalid document." };
  const sb = await createClient();

  // Through the RPC, not a table write: `authenticated` holds no update grant on
  // documents (the fiscal lock), and the "don't hide a bill that's still owed"
  // rule lives next to the data where it can't be bypassed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("set_document_archived", {
    p_document_id: documentId,
    p_archived: archived,
  });
  if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, "") };

  revalidatePath("/sales");
  revalidatePath(`/sales/${documentId}`);
  return { ok: true, data: null };
}

// Every export in a "use server" module must be an async function — an arrow
// alias compiles, but Next rejects the module at runtime.
export async function archiveDocumentAction(documentId: string): Promise<ActionResult<null>> {
  return setArchived(documentId, true);
}

export async function restoreDocumentAction(documentId: string): Promise<ActionResult<null>> {
  return setArchived(documentId, false);
}
