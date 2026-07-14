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
    const doc = await rpc.issueDocument(sb, parsed.data.documentId, parsed.data.stockLocationId ?? null, parsed.data.idempotencyKey ?? null);
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
    const cn = await rpc.createCreditNote(sb, invoiceId, restock, location);
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
