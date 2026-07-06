"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";
import * as rpc from "@/lib/supabase/rpc";
import { computeTotals } from "@/lib/money";

const ROLES = ["owner", "manager", "cashier"] as const;

export type CounterResult =
  | { ok: true; invoiceId: string; number: string | null; totalCents: number; changeCents: number; onAccount: boolean }
  | { ok: false; error: string };

const schema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive() })).min(1),
  // "credit" = on account: issue the invoice but collect nothing now; the total
  // stays as money owed (receivable). Not a real payment_method, so it never
  // reaches record_payment.
  method: z.enum(["cash", "card", "juice", "bank_transfer", "credit"]),
  tenderedCents: z.number().int().nonnegative().nullable().optional(),
  externalRef: z.string().optional(),
  // One key per sale attempt (stable across retries) → a replayed submit returns
  // the same invoice + payment instead of creating duplicates.
  idempotencyKey: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function walkInCustomerId(sb: any, tenantId: string, name?: string): Promise<string> {
  const clean = (name ?? "").trim() || "Walk-in customer";
  const { data: existing } = await sb.from("customers").select("id").eq("name", clean).limit(1).maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await sb.from("customers").insert({ tenant_id: tenantId, name: clean }).select("id").single();
  return created.id;
}

export async function counterSaleAction(input: z.infer<typeof schema>): Promise<CounterResult> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Add at least one product to the sale." };
  if (p.data.method === "credit" && !p.data.customerId) {
    return { ok: false, error: "A credit (on-account) sale needs a selected customer — so you know who owes you." };
  }
  const sb = await createClient();

  // Authoritative product snapshot (never trust client prices).
  const ids = [...new Set(p.data.lines.map((l) => l.productId))];
  const { data: prods, error: pe } = await sb
    .from("products")
    .select("id, name, selling_price, vat_rate")
    .in("id", ids);
  if (pe) return { ok: false, error: pe.message };
  const { data: bs } = await sb.from("business_settings").select("vat_rate").limit(1).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vatDefault = Number((bs as any)?.vat_rate ?? 15);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map((prods as any[]).map((x) => [x.id, x]));

  const rpcLines = p.data.lines.map((l, i) => {
    const prod = byId.get(l.productId);
    if (!prod) throw new Error("product not found");
    return {
      product_id: l.productId,
      title: prod.name as string,
      description: null,
      qty: l.qty,
      unit_price: Number(prod.selling_price),
      discount_pct: 0,
      vat_rate: prod.vat_rate == null ? vatDefault : Number(prod.vat_rate),
      sort_order: i,
    };
  });

  const totals = computeTotals(
    rpcLines.map((l) => ({ qty: l.qty, unitCents: Math.round(l.unit_price * 100), vatRatePct: l.vat_rate })),
  );

  try {
    // A selected customer id is used directly (validated); otherwise fall back to
    // the walk-in name lookup/create (never used for credit — see guard above).
    let customerId: string;
    if (p.data.customerId) {
      if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
      customerId = p.data.customerId;
    } else {
      customerId = await walkInCustomerId(sb, ctx.tenantId, p.data.customerName);
    }

    const draft = await rpc.saveDraft(
      sb,
      {
        doc_type: "invoice",
        customer_id: customerId,
        vehicle_id: null,
        template_id: null,
        template_overrides: {},
        valid_until: null,
        due_date: null,
        origin: "standalone",
      },
      rpcLines,
      null,
    );

    const key = p.data.idempotencyKey?.trim() || null;
    const issued = await rpc.issueDocument(sb, draft.id, null, key ? `${key}:issue` : null);
    const totalRupees = Number(issued.total_incl);

    let changeCents = 0;
    if (p.data.method !== "credit") {
      // Link cash to the open till so the end-of-day cash-up reconciles.
      let cashSessionId: string | null = null;
      if (p.data.method === "cash") {
        const { data: sess } = await sb.from("cash_sessions").select("id").eq("status", "open").limit(1).maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cashSessionId = (sess as any)?.id ?? null;
      }

      const tenderedRupees =
        p.data.method === "cash" && p.data.tenderedCents != null ? p.data.tenderedCents / 100 : null;

      await rpc.recordPayment(sb, {
        invoiceId: issued.id,
        method: p.data.method,
        amount: totalRupees,
        tendered: tenderedRupees,
        externalRef: p.data.method === "cash" ? null : (p.data.externalRef?.trim() || "COUNTER"),
        cashSessionId,
        idempotencyKey: key ? `${key}:pay` : null,
      });

      changeCents = tenderedRupees != null ? Math.max(0, Math.round(tenderedRupees * 100) - totals.totalCents) : 0;
    }
    // credit → no payment recorded; the invoice stays fully outstanding (a receivable).

    revalidatePath("/sales");
    revalidatePath("/reports");
    return { ok: true, invoiceId: issued.id, number: issued.number, totalCents: totals.totalCents, changeCents, onAccount: p.data.method === "credit" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
