"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, requireRole, type SessionContext } from "@/lib/auth/session";
import { logAudit } from "@/lib/supabase/audit";
import type { ActivityRow } from "./activity";

const ROLES = ["owner", "manager"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Record a manual selling/cost price change (there's no price-history table). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logPriceChange(sb: any, ctx: SessionContext, id: string, name: string, before: any, sellingTo: number, costTo: number) {
  if (!before) return;
  const sFrom = Number(before.selling_price), cFrom = Number(before.cost_price);
  const sChanged = Math.abs(sFrom - sellingTo) > 0.0001;
  const cChanged = Math.abs(cFrom - costTo) > 0.0001;
  if (!sChanged && !cChanged) return;
  const { data: me } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  await logAudit(sb, {
    tenantId: ctx.tenantId, actorId: me?.id ?? null, eventType: "price_changed", refType: "product", refId: id,
    payload: { name, ...(sChanged ? { sellingFrom: sFrom, sellingTo } : {}), ...(cChanged ? { costFrom: cFrom, costTo } : {}) },
  });
}

// Prices may carry thousands separators / spaces from the input (e.g. "32,000").
const parseNum = (v: string | number) => (typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s]/g, "")));
const numOpt = z.union([z.number(), z.string()]).optional().transform((v) => {
  if (v === undefined || v === "" || v === null) return null;
  const n = parseNum(v);
  return Number.isFinite(n) ? n : null;
});
const num = z.union([z.number(), z.string()]).optional().transform((v) => {
  if (v === undefined || v === "" || v === null) return 0;
  const n = parseNum(v);
  return Number.isFinite(n) ? n : 0;
});
const strOpt = z.string().trim().optional().transform((v) => (v ? v : null));

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  sku: strOpt,
  description: strOpt,
  kind: z.enum(["service", "product", "consumable"]),
  category: strOpt,
  unit: z.enum(["ml", "l", "g", "kg", "m2", "piece", "service"]),
  discountPolicy: z.enum(["inherit", "none", "carwash", "free"]).optional().default("inherit"),
  sellingPrice: num,
  costPrice: num,
  vatRate: numOpt,
  barcode: strOpt,
  isStocked: z.boolean().optional().default(false),
  threshold: numOpt,
  isActive: z.boolean().optional().default(true),
  photoPath: strOpt,
});

export async function saveProductAction(input: z.input<typeof schema>): Promise<Result<{ id: string }>> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid product" };
  const sb = await createClient();

  // Services are never stocked (DB check constraint).
  const isStocked = p.data.kind === "service" ? false : p.data.isStocked;
  const row = {
    name: p.data.name,
    sku: p.data.sku,
    description: p.data.description,
    kind: p.data.kind,
    category: p.data.category,
    unit: p.data.unit,
    discount_policy: p.data.discountPolicy,
    selling_price: p.data.sellingPrice,
    cost_price: p.data.costPrice,
    vat_rate: p.data.vatRate,
    barcode: p.data.barcode,
    is_stocked: isStocked,
    // blank = default 10 (client display); hard-capped at 20 (also a DB check constraint)
    low_stock_threshold: isStocked && p.data.threshold != null ? Math.min(Math.max(p.data.threshold, 0), 20) : null,
    is_active: p.data.isActive,
    photo_path: p.data.photoPath,
  };

  if (p.data.id) {
    const { data: before } = await sb.from("products").select("selling_price, cost_price").eq("id", p.data.id).maybeSingle();
    const { error } = await sb.from("products").update(row).eq("id", p.data.id);
    if (error) return { ok: false, error: friendly(error.message) };
    await logPriceChange(sb, ctx, p.data.id, p.data.name, before, p.data.sellingPrice, p.data.costPrice);
    revalidatePath("/products");
    return { ok: true, data: { id: p.data.id } };
  }
  const { data, error } = await sb.from("products").insert({ tenant_id: ctx.tenantId, ...row }).select("id").single();
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/products");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, data: { id: (data as any).id } };
}

function friendly(msg: string): string {
  if (/idx_products_barcode|barcode/i.test(msg) && /duplicate|unique/i.test(msg)) return "That barcode is already used by another product.";
  if (/products_check|is_stocked/i.test(msg)) return "Services cannot be stocked.";
  return msg;
}

/**
 * Put a price on a product that has none, from wherever it is needed (the counter
 * hits this when someone tries to sell an unpriced part). It writes the price into
 * the CATALOGUE rather than the sale, because the sale reads its prices from the
 * catalogue and would otherwise still charge zero — and because the next person to
 * sell that part should not have to price it again. Owner/manager only, audited
 * like any other price change.
 */
const priceSchema = z.object({
  id: z.string().uuid(),
  sellingPrice: z.union([z.number(), z.string()]).transform((v) => parseNum(v)),
});

export async function setProductPriceAction(input: z.input<typeof priceSchema>): Promise<Result<{ priceCents: number }>> {
  const ctx = await requireRole(...ROLES);
  const p = priceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter a price." };
  const price = p.data.sellingPrice;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "The price has to be more than zero." };

  const sb = await createClient();
  const { data: before } = await sb.from("products").select("name, selling_price, cost_price").eq("id", p.data.id).maybeSingle();
  if (!before) return { ok: false, error: "That product no longer exists." };

  const { error } = await sb.from("products").update({ selling_price: price }).eq("id", p.data.id);
  if (error) return { ok: false, error: friendly(error.message) };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = before as any;
  await logPriceChange(sb, ctx, p.data.id, b.name, before, price, Number(b.cost_price ?? 0));
  revalidatePath("/products");
  revalidatePath("/sales/counter");
  return { ok: true, data: { priceCents: Math.round(price * 100) } };
}

/**
 * The last few things that happened to one catalogue item, for the history line
 * that opens under its row. Fetched on expand rather than with the page: 397
 * products' worth of ledger is not worth loading for a list you mostly open to
 * check a price.
 *
 * Read-only, so it is gated on being signed in rather than on a role — RLS
 * decides what the ledger will show, exactly as it does for the row above it.
 */
export async function getProductActivityAction(productId: string): Promise<Result<ActivityRow[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Your session has expired — sign in again." };
  if (!z.string().uuid().safeParse(productId).success) return { ok: false, error: "Unknown product." };

  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("product_recent_activity", { p_product_id: productId, p_limit: 8 });
  if (error) return { ok: false, error: error.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: ActivityRow[] = ((data ?? []) as any[]).map((r) => ({
    eventId: String(r.event_id),
    happenedAt: r.happened_at,
    source: r.source === "line" ? "line" : "movement",
    kind: String(r.kind),
    qty: Number(r.qty),
    refId: r.ref_id ?? null,
    locationName: r.location_name ?? null,
    docNumber: r.doc_number ?? null,
    partyName: r.party_name ?? null,
    note: r.note ?? null,
    actorName: r.actor_name ?? null,
  }));
  return { ok: true, data: rows };
}

// Categories are a text column, so renaming = bulk-updating every product that
// carries the exact `from` string. Rename to an existing name → merge; rename
// to "" → clear (uncategorise). RLS scopes the update to the tenant; the role
// gate above restricts it to owner/manager.
const categorySchema = z.object({
  from: z.string().min(1, "Pick a category to change"),
  to: z.string().trim().max(80, "Category name is too long"),
});

export async function renameCategoryAction(input: z.input<typeof categorySchema>): Promise<Result<{ updated: number }>> {
  await requireRole(...ROLES);
  const p = categorySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid category" };
  const from = p.data.from;
  const to = p.data.to.trim();
  if (to === from) return { ok: true, data: { updated: 0 } }; // no-op

  const sb = await createClient();
  const { data, error } = await sb
    .from("products")
    .update({ category: to === "" ? null : to })
    .eq("category", from)
    .select("id");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/products");
  return { ok: true, data: { updated: (data ?? []).length } };
}
