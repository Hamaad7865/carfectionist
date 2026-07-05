"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
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
});

export async function issueDocumentAction(input: z.infer<typeof issueSchema>): Promise<ActionResult<rpc.DocumentRow>> {
  await requireRole(...WRITE_ROLES);
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  try {
    const doc = await rpc.issueDocument(sb, parsed.data.documentId, parsed.data.stockLocationId ?? null);
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
});

export async function recordPaymentAction(
  input: z.infer<typeof recordPaymentSchema>,
): Promise<ActionResult<rpc.PaymentRow>> {
  await requireRole(...WRITE_ROLES);
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid payment" };
  const sb = await createClient();

  // Link cash to the open till so the end-of-day cash-up reconciles.
  let cashSessionId: string | null = null;
  if (parsed.data.method === "cash") {
    const { data: sess } = await sb.from("cash_sessions").select("id").eq("status", "open").limit(1).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cashSessionId = (sess as any)?.id ?? null;
  }

  try {
    const pay = await rpc.recordPayment(sb, {
      invoiceId: parsed.data.invoiceId,
      method: parsed.data.method,
      amount: parsed.data.amountCents / 100,
      tendered: parsed.data.tenderedCents != null ? parsed.data.tenderedCents / 100 : null,
      externalRef: parsed.data.externalRef ?? null,
      cashSessionId,
    });
    revalidatePath(`/sales/${parsed.data.invoiceId}`);
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
