"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";
import { resolveShopLocationId } from "@/lib/supabase/locations";
import { backOfficeTillId } from "@/lib/supabase/till";
import * as rpc from "@/lib/supabase/rpc";
import { computeTotals, rupeesToCents } from "@/lib/money";
import { isDeterministicRejection, type SettlePhase } from "./settle";
import { fitSplitToTotal, planSplit } from "./split";

const ROLES = ["owner", "manager", "cashier"] as const;

/**
 * A failure carries `settle` once the attempt reached `issue_document`. Past that point the
 * server may hold an invoice under `${idempotencyKey}:issue`, and both money RPCs replay purely
 * on the key — so the caller must freeze the basket and retry the identical request rather than
 * settle a new one. A failure without `settle` committed nothing that costs money.
 */
export type CounterResult =
  | {
      ok: true; invoiceId: string; number: string | null; totalCents: number; changeCents: number; onAccount: boolean;
      /** Every invoice the sale produced, in company order — two on a tyre-centre sale with both
       *  tyres and services (one per issuing company), one otherwise. */
      invoices: { id: string; number: string | null; totalCents: number; legalEntityId: string | null }[];
    }
  | { ok: false; error: string; settle?: SettlePhase; invoiceNo?: string | null };

const lineSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().positive(),
  discountKind: z.enum(["percent", "amount"]).optional(),
  discountPct: z.number().min(0).max(100).optional(),
  discountAmountCents: z.number().int().min(0).optional(),
});

const schema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  lines: z.array(lineSchema).min(1),
  orderDiscountKind: z.enum(["percent", "amount"]).nullable().optional(),
  orderDiscountValue: z.number().min(0).optional(), // percent: % ; amount: Cents (VAT-inclusive)
  // Why the discount was given. app.assert_discount_allowed reads it back and refuses a
  // discount reaching a carwash allowance without one.
  orderDiscountReason: z.string().optional(),
  // "credit" = on account: issue the invoice but collect nothing now; the total
  // stays as money owed (receivable). Not a real payment_method, so it never
  // reaches record_payment.
  // "split" = several payments on the one invoice, listed in `split` (see split.ts).
  method: z.enum(["cash", "card", "juice", "bank_transfer", "cheque", "credit", "split"]),
  split: z.array(z.object({
    method: z.enum(["cash", "card", "juice", "bank_transfer", "cheque"]),
    amountCents: z.number().int().positive(),
    tenderedCents: z.number().int().nonnegative().nullable().optional(),
    externalRef: z.string().optional(),
  })).optional(),
  // The car the sale is for (tyre centre): stamped on the invoice so it shows in the car's
  // history. Must belong to the chosen customer.
  vehicleId: z.string().uuid().optional(),
  tenderedCents: z.number().int().nonnegative().nullable().optional(),
  externalRef: z.string().optional(),
  // One key per sale attempt (stable across retries) → a replayed submit returns
  // the same invoice + payment instead of creating duplicates.
  idempotencyKey: z.string().optional(),
  // The id to draft under, named by the till before the document exists so an owner's
  // "Ask the owner" approval — which app.assert_discount_allowed re-reads by ref_id — can be
  // pinned to it. save_draft upserts by id, so a retry re-locks the same row rather than
  // littering orphan drafts. Mirrors SaleRepository.draftIdFor on the tablet.
  draftId: z.string().uuid().optional(),
  // A cart spanning two issuing companies (tyre centre) takes no bill discount — each company's
  // bill block has its own (owner rule 2026-11-22). Amount in VAT-inclusive cents.
  companyDiscounts: z.array(z.object({
    legalEntityId: z.string().uuid(),
    kind: z.enum(["percent", "amount"]),
    value: z.number().min(0),
    reason: z.string().optional(),
  })).optional(),
  // Part payment across two companies' bills: "proportional", or the company filled first.
  allocation: z.string().optional(),
}).superRefine((d, ctx) => {
  // A percent order discount can't exceed 100% (else totals go negative).
  if (d.orderDiscountKind === "percent" && (d.orderDiscountValue ?? 0) > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Discount cannot exceed 100%", path: ["orderDiscountValue"] });
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function walkInCustomerId(sb: any, tenantId: string, name?: string): Promise<string> {
  const clean = (name ?? "").trim() || "Walk-in customer";
  const { data: existing } = await sb.from("customers").select("id").eq("name", clean).limit(1).maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await sb.from("customers").insert({ tenant_id: tenantId, name: clean }).select("id").single();
  return created.id;
}

type CartLineInput = z.infer<typeof lineSchema>;

/** The cart as draft lines, priced from the catalogue — never from the client. */
async function catalogueLines(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  lines: CartLineInput[],
): Promise<{ ok: true; rpcLines: rpc.RpcDraftLine[]; lineCompanies: (string | null)[] } | { ok: false; error: string }> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const { data: prods, error: pe } = await sb
    .from("products")
    .select("id, name, selling_price, price_includes_vat, vat_rate, legal_entity_id")
    .in("id", ids);
  if (pe) return { ok: false, error: pe.message };
  // A company that is not VAT-registered charges no VAT; the database forces 0 on its lines
  // (20261122000010), and the till's own arithmetic has to agree with it. One-company shops have
  // no such company, so nothing changes for them.
  const { data: ents } = await sb.from("legal_entities").select("id, vat_registered, is_default");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entRows = (ents ?? []) as any[];
  const defaultEnt = entRows.find((e) => e.is_default);
  const noVat = (entityId: string | null) => {
    const e = entityId ? entRows.find((x) => x.id === entityId) : defaultEnt;
    return e ? e.vat_registered === false : false;
  };
  const { data: bs } = await sb.from("business_settings").select("vat_rate").limit(1).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vatDefault = Number((bs as any)?.vat_rate ?? 15);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map((prods as any[]).map((x) => [x.id, x]));
  if (ids.some((id) => !byId.has(id))) return { ok: false, error: "A product in the sale is no longer in the catalogue." };

  const rpcLines = lines.map((l, i): rpc.RpcDraftLine => {
    const prod = byId.get(l.productId);
    return {
      product_id: l.productId,
      vehicle_id: null, // the document carries the car; a counter line is not about a second one
      title: prod.name as string,
      // A counter sale is a product off the shelf rung up at the till — there is no
      // authoring surface here and never will be, so both stay null deliberately.
      description: null,
      description_richtext: null,
      unit_label: null,
      qty: l.qty,
      unit_price: Number(prod.selling_price),
      discount_pct: l.discountPct ?? 0,
      discount_kind: l.discountKind ?? "percent",
      discount_amount: (l.discountAmountCents ?? 0) / 100,
      vat_rate: noVat(prod.legal_entity_id ?? null) ? 0 : prod.vat_rate == null ? vatDefault : Number(prod.vat_rate),
      sort_order: i,
      // A flagged product's selling_price IS the exact gross the owner typed, so its line
      // carries the flag and the ledger extracts VAT (20260812000030). An unflagged product
      // keeps the stored-NET, added-VAT path exactly as before.
      price_includes_vat: prod.price_includes_vat === true,
      // Every counter line comes from the catalogue, so its product answers for it.
      line_kind: null,
    };
  });

  // A product with no price in the catalogue would be sold for nothing — the prices come
  // from the catalogue (above), so nothing the till types could fix it. Name the product,
  // because "price it first" is only useful if you know which one.
  const unpriced = rpcLines.filter((l) => !(l.unit_price > 0)).map((l) => l.title);
  if (unpriced.length > 0) {
    return {
      ok: false,
      error: `${unpriced.slice(0, 3).join(", ")}${unpriced.length > 3 ? ` and ${unpriced.length - 3} more` : ""} ${unpriced.length === 1 ? "has" : "have"} no price. Set the price first — the sale takes its prices from the catalogue.`,
    };
  }
  // Which company sells each line (a product with none is the default company's) — the till's
  // per-company arithmetic follows the same rule the database stamps lines with.
  const lineCompanies = lines.map((l) => (byId.get(l.productId).legal_entity_id as string | null) ?? defaultEnt?.id ?? null);
  return { ok: true, rpcLines, lineCompanies };
}

export async function counterSaleAction(input: z.infer<typeof schema>): Promise<CounterResult> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Add at least one product to the sale." };
  if (p.data.method === "credit" && !p.data.customerId) {
    return { ok: false, error: "A credit (on-account) sale needs a selected customer — so you know who owes you." };
  }
  if (p.data.vehicleId && !p.data.customerId) return { ok: false, error: "Pick the car's owner as the customer." };
  const sb = await createClient();

  const built = await catalogueLines(sb, p.data.lines);
  if (!built.ok) return built;
  const { rpcLines, lineCompanies } = built;

  const orderDiscount = p.data.orderDiscountKind ? { kind: p.data.orderDiscountKind, value: p.data.orderDiscountValue ?? 0 } : null;
  const asTotalsLine = (l: rpc.RpcDraftLine) => ({
    qty: l.qty,
    unitCents: Math.round(l.unit_price * 100),
    discountPct: l.discount_pct,
    discountKind: l.discount_kind,
    discountAmountCents: Math.round(l.discount_amount * 100),
    vatRatePct: l.vat_rate,
    // A flagged line's unit_price IS the gross — carry the flag so this recompute extracts VAT
    // instead of adding it, or the change owed and the "Paid" figure shown/WhatsApp'd would be
    // the VAT-inflated total while the issued invoice (DB) is correct.
    priceInclusive: l.price_includes_vat,
  });
  // Per-company discounts (two-company shop): each company's bill is its own total with its own
  // discount, exactly as issue_checkout will issue it; the sale's total is their sum. Without
  // them, today's single computation.
  const companyDiscounts = p.data.companyDiscounts ?? [];
  const totals = companyDiscounts.length
    ? {
        totalCents: [...new Set(lineCompanies)].reduce((sum, co) => {
          const d = companyDiscounts.find((x) => x.legalEntityId === co);
          return sum + computeTotals(
            rpcLines.filter((_, i) => lineCompanies[i] === co).map(asTotalsLine),
            d ? { kind: d.kind, value: d.value } : null,
          ).totalCents;
        }, 0),
      }
    : computeTotals(rpcLines.map(asTotalsLine), orderDiscount);
  if (companyDiscounts.length && orderDiscount) {
    return { ok: false, error: "Give each company's bill its own discount — a bill discount can't cover two companies." };
  }

  // A receipt for nothing is never intentional, and a Rs 0.00 invoice jams the collect
  // screen (it can never be settled — there is nothing to pay).
  if (totals.totalCents <= 0) {
    return { ok: false, error: "This sale comes to Rs 0.00 — check the prices or the discount before charging." };
  }

  const key = p.data.idempotencyKey?.trim() || null;
  // A split that cannot settle this total is refused before anything is drawn or moved.
  const splitPlan = p.data.method === "split" ? planSplit(p.data.split ?? [], totals.totalCents, key) : null;
  if (splitPlan && !splitPlan.ok) return { ok: false, error: splitPlan.error };

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
    if (p.data.vehicleId) {
      const { data: car } = await sb.from("vehicles").select("customer_id").eq("id", p.data.vehicleId).maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!car || (car as any).customer_id !== customerId) return { ok: false, error: "That car doesn't belong to this customer." };
    }

    const draft = await rpc.saveDraft(
      sb,
      {
        id: p.data.draftId ?? null,
        doc_type: "invoice",
        customer_id: customerId,
        vehicle_id: p.data.vehicleId ?? null,
        template_id: null,
        template_overrides: {},
        valid_until: null,
        due_date: null,
        origin: "standalone",
        discount_kind: p.data.orderDiscountKind ?? null,
        discount_value: p.data.orderDiscountKind === "amount" ? (p.data.orderDiscountValue ?? 0) / 100 : (p.data.orderDiscountValue ?? 0),
        // Typed at the till when the ticket's discount reaches a carwash allowance. Blank is
        // null, not "" — save_draft's nullif('') would do it anyway, but the intent is that
        // nothing was said, and issue_document refuses on exactly that.
        discount_reason: p.data.orderDiscountReason?.trim() || null,
      },
      rpcLines,
      null,
    );

    // Counter sales draw stock from the Shop (walk-in front), not the Warehouse
    // default; fall back to the tenant default if no Shop location exists.
    const shopLocationId = await resolveShopLocationId(sb);
    // The DESK's till — never "any open till". Picking the first open session put a
    // back-office sale into a tablet's drawer and corrupted both cash-ups. The TICKET and
    // its PAYMENT must land on the same service, or the cash-up shows money with no sale.
    const cashSessionId: string = await backOfficeTillId(sb);
    // Point of no return: this draws the gapless INV number and fires stock movements. If it
    // throws we cannot tell a lost request from a lost response, so the invoice may exist under
    // `${key}:issue` — and a replay would ignore any new draft we sent it.
    // A shop with ONE issuing company (Carfectionist) keeps today's path exactly. A shop with two
    // (tyre centre: VAT tyres + non-VAT services) issues through issue_checkout — one invoice per
    // company, same key, a one-company cart still a single invoice.
    const { count: companies } = await sb.from("legal_entities").select("id", { count: "exact", head: true }).eq("is_active", true);
    const severalCompanies = (companies ?? 0) > 1;
    const discounts: rpc.CheckoutDiscount[] | null = p.data.companyDiscounts?.length
      ? p.data.companyDiscounts.map((d) => ({
          legal_entity_id: d.legalEntityId,
          discount_kind: d.kind,
          discount_value: d.kind === "amount" ? d.value / 100 : d.value,
          discount_reason: d.reason?.trim() || null,
        }))
      : null;
    if (discounts && !severalCompanies) return { ok: false, error: "Per-company discounts need a shop with more than one company." };

    let bills: rpc.CheckoutDocumentRow[];
    try {
      // The ticket belongs to the desk's till — that is the service it will appear under
      // on the cash-up.
      bills = severalCompanies
        ? await rpc.issueCheckout(sb, draft.id, shopLocationId, key ? `${key}:issue` : null, cashSessionId, discounts)
        : [{ ...(await rpc.issueDocument(sb, draft.id, shopLocationId, key ? `${key}:issue` : null, cashSessionId)), legal_entity_id: null, checkout_group_id: null }];
    } catch (e) {
      // A definitive refusal (day closed, stale till, …) commits nothing costing money —
      // no `settle`, so the basket stays live instead of freezing behind a false
      // "couldn't confirm the sale reached the server".
      if (isDeterministicRejection((e as Error).message)) return { ok: false, error: (e as Error).message };
      return { ok: false, error: (e as Error).message, settle: "uncertain" };
    }
    const issued = bills[0];
    const invoices = bills.map((b) => ({ id: b.id, number: b.number, totalCents: rupeesToCents(Number(b.total_incl)), legalEntityId: b.legal_entity_id }));

    // Everything below runs against a real, issued invoice. Any failure here — including a
    // payment that committed but whose response was lost — leaves the sale unresolved, so it
    // must be retried as-is rather than re-settled with a different basket.
    try {
      if (bills.length > 1) {
        // Two companies' bills, ONE payment (or one per tender of a split): each call spreads its
        // money across both bills in one transaction, so a failure never leaves one bill paid
        // and the other not by accident. The issued totals are the authority.
        const groupCents = invoices.reduce((sum, b) => sum + b.totalCents, 0);
        const ids = invoices.map((b) => b.id);
        let changeCents = 0;
        if (splitPlan?.ok) {
          const fitted = fitSplitToTotal(splitPlan, groupCents);
          if (!fitted.ok) throw new Error(fitted.error);
          for (const pay of fitted.payments) {
            await rpc.recordCheckoutPayment(sb, { invoiceIds: ids, ...pay, cashSessionId, allocation: p.data.allocation });
          }
          changeCents = fitted.changeCents;
        } else if (p.data.method !== "credit" && p.data.method !== "split") {
          const tenderedRupees = p.data.method === "cash" && p.data.tenderedCents != null ? p.data.tenderedCents / 100 : null;
          await rpc.recordCheckoutPayment(sb, {
            invoiceIds: ids,
            method: p.data.method,
            amount: groupCents / 100,
            tendered: tenderedRupees,
            externalRef:
              p.data.method === "cash"
                ? null
                : p.data.method === "cheque"
                  ? p.data.externalRef?.trim() || null
                  : p.data.externalRef?.trim() || "COUNTER",
            cashSessionId,
            allocation: p.data.allocation,
            idempotencyKey: key ? `${key}:pay` : null,
          });
          changeCents = tenderedRupees != null ? Math.max(0, Math.round(tenderedRupees * 100) - groupCents) : 0;
        }
        revalidatePath("/sales");
        revalidatePath("/reports");
        return { ok: true, invoiceId: issued.id, number: issued.number, totalCents: groupCents, changeCents, onAccount: p.data.method === "credit", invoices };
      }

      const totalRupees = Number(issued.total_incl);

      let changeCents = 0;
      if (splitPlan?.ok) {
        // The parts were planned against the till's arithmetic; the issued invoice is the
        // authority. Its number is already drawn, so a cent of rounding is absorbed by the
        // last part (as on the tablet) instead of stranding an issued, unpaid invoice.
        const fitted = fitSplitToTotal(splitPlan, rupeesToCents(totalRupees));
        if (!fitted.ok) throw new Error(fitted.error);
        for (const pay of fitted.payments) {
          await rpc.recordPayment(sb, { invoiceId: issued.id, ...pay, cashSessionId });
        }
        changeCents = fitted.changeCents;
      } else if (p.data.method !== "credit" && p.data.method !== "split") {
        // Every payment is linked to the till it was taken on (resolved above, so the
        // ticket and the money land on the same service).
        const tenderedRupees =
          p.data.method === "cash" && p.data.tenderedCents != null ? p.data.tenderedCents / 100 : null;

        await rpc.recordPayment(sb, {
          invoiceId: issued.id,
          method: p.data.method,
          amount: totalRupees,
          tendered: tenderedRupees,
          // Cash and cheque cite nothing external — a cheque number is optional and
          // kept only when typed; card/Juice/bank fall back to "COUNTER".
          externalRef:
            p.data.method === "cash"
              ? null
              : p.data.method === "cheque"
                ? p.data.externalRef?.trim() || null
                : p.data.externalRef?.trim() || "COUNTER",
          cashSessionId,
          idempotencyKey: key ? `${key}:pay` : null,
        });

        changeCents = tenderedRupees != null ? Math.max(0, Math.round(tenderedRupees * 100) - totals.totalCents) : 0;
      }
      // credit → no payment recorded; the invoice stays fully outstanding (a receivable).

      revalidatePath("/sales");
      revalidatePath("/reports");
      return { ok: true, invoiceId: issued.id, number: issued.number, totalCents: splitPlan?.ok ? rupeesToCents(totalRupees) : totals.totalCents, changeCents, onAccount: p.data.method === "credit", invoices };
    } catch (e) {
      return { ok: false, error: (e as Error).message, settle: "issued", invoiceNo: invoices.map((b) => b.number).filter(Boolean).join(" + ") || null };
    }
  } catch (e) {
    // Nothing past save_draft ran: no number drawn, no stock moved. Safe to edit and retry.
    return { ok: false, error: (e as Error).message };
  }
}

const keepSchema = z.object({
  as: z.enum(["quote", "job"]),
  customerId: z.string().min(1),
  vehicleId: z.string().uuid().optional(),
  lines: z.array(lineSchema).min(1),
  orderDiscountKind: z.enum(["percent", "amount"]).nullable().optional(),
  orderDiscountValue: z.number().min(0).optional(), // percent: % ; amount: Cents (VAT-inclusive)
  orderDiscountReason: z.string().optional(),
  // A cart spanning two companies (tyre centre): "one" quote covering both (numbered in the main
  // company's series), or "two" — one quote per company, each with its own discount.
  quotes: z.enum(["one", "two"]).optional(),
  companyDiscounts: z.array(z.object({
    legalEntityId: z.string().uuid(),
    kind: z.enum(["percent", "amount"]),
    value: z.number().min(0),
    reason: z.string().optional(),
  })).optional(),
});

export type KeepCartResult =
  | { ok: true; quoteId: string; jobId: string | null; quoteIds: string[] }
  | { ok: false; error: string; quoteId?: string };

/**
 * The till's cart kept for later instead of charged (tyre-centre New sale).
 *
 * "quote": a DRAFT quote with the cart's lines, opened in the document editor — no number is
 * drawn; issuing it later goes through issue_document like any quote.
 * "job": the same draft, then convert_quote_to_job — the customer at the counter has agreed
 * the work, so the quote is issued (its gapless number drawn inside the RPC) and accepted,
 * and the car goes on the board. Same path the tablet and the web quote page use.
 */
export async function keepCartAction(input: z.infer<typeof keepSchema>): Promise<KeepCartResult> {
  await requireRole(...ROLES);
  const p = keepSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a customer and add at least one item first." };
  if (p.data.as === "job" && !p.data.vehicleId) return { ok: false, error: "A job needs a car — pick one of the customer's cars." };
  const sb = await createClient();

  if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
  if (p.data.vehicleId) {
    const { data: car } = await sb.from("vehicles").select("customer_id").eq("id", p.data.vehicleId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!car || (car as any).customer_id !== p.data.customerId) return { ok: false, error: "That car doesn't belong to this customer." };
  }
  const built = await catalogueLines(sb, p.data.lines);
  if (!built.ok) return built;

  // Two companies in the cart: a bill discount belongs to one company's quote. One company only
  // (or a one-company shop): its discount is simply the quote's discount, as before.
  const cartCompanies = [...new Set(built.lineCompanies)];
  const mixed = cartCompanies.length > 1;
  const coDiscounts = (p.data.companyDiscounts ?? []).filter((d) => d.value > 0);
  const splitQuotes = mixed && p.data.as === "quote" && p.data.quotes === "two";
  if (mixed && coDiscounts.length && !splitQuotes) {
    return {
      ok: false,
      error: p.data.as === "job"
        ? "A job covering both companies can't carry a discount yet — give each company's discount when you charge."
        : "One quote covering both companies can't carry a discount — choose Two quotes, or remove the discount.",
    };
  }
  const single = !mixed && coDiscounts.length ? coDiscounts.find((d) => d.legalEntityId === cartCompanies[0]) ?? null : null;
  const orderKind = single ? single.kind : mixed ? null : (p.data.orderDiscountKind ?? null);
  const orderValue = single ? single.value : mixed ? 0 : (p.data.orderDiscountValue ?? 0);
  const orderReason = single ? single.reason : mixed ? undefined : p.data.orderDiscountReason;

  let quoteId: string;
  let quoteIds: string[];
  try {
    const draft = await rpc.saveDraft(
      sb,
      {
        id: null,
        doc_type: "quote",
        customer_id: p.data.customerId,
        vehicle_id: p.data.vehicleId ?? null,
        template_id: null,
        template_overrides: {},
        valid_until: null,
        due_date: null,
        origin: "standalone",
        discount_kind: orderKind,
        discount_value: orderKind === "amount" ? orderValue / 100 : orderValue,
        discount_reason: orderReason?.trim() || null,
      },
      built.rpcLines,
      null,
    );
    quoteId = draft.id;
    quoteIds = [draft.id];
    if (splitQuotes) {
      // "Two quotes": the draft becomes one draft per company, linked as one sale, nothing issued
      // (split_document_by_company, the same path the document builder uses). Each company's
      // discount then goes on its own quote — save_draft keeps its company and its link.
      const parts = await rpc.splitDocumentByCompany(sb, draft.id);
      quoteIds = parts.map((d) => d.id);
      for (const part of parts) {
        const d = coDiscounts.find((x) => x.legalEntityId === part.legal_entity_id);
        if (!d) continue;
        const lines = built.rpcLines
          .filter((_, i) => built.lineCompanies[i] === part.legal_entity_id)
          .map((l, i) => ({ ...l, sort_order: i }));
        await rpc.saveDraft(
          sb,
          {
            id: part.id,
            doc_type: "quote",
            customer_id: p.data.customerId,
            vehicle_id: p.data.vehicleId ?? null,
            template_id: null,
            template_overrides: {},
            valid_until: null,
            due_date: null,
            origin: "standalone",
            discount_kind: d.kind,
            discount_value: d.kind === "amount" ? d.value / 100 : d.value,
            discount_reason: d.reason?.trim() || null,
          },
          lines,
          null,
        );
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/sales");

  if (p.data.as === "quote") return { ok: true, quoteId, jobId: null, quoteIds };
  try {
    const job = await rpc.convertQuoteToJob(sb, quoteId);
    revalidatePath("/jobs");
    return { ok: true, quoteId, jobId: job.id, quoteIds };
  } catch (e) {
    // The quote is saved either way; say so, so nobody rings the cart up twice.
    return { ok: false, error: `Saved as a draft quote, but the job wasn't started: ${(e as Error).message}`, quoteId };
  }
}
