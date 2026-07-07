"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const ROLES = ["owner", "manager"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

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
  sellingPrice: num,
  costPrice: num,
  vatRate: numOpt,
  barcode: strOpt,
  isStocked: z.boolean().optional().default(false),
  threshold: numOpt,
  isActive: z.boolean().optional().default(true),
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
    selling_price: p.data.sellingPrice,
    cost_price: p.data.costPrice,
    vat_rate: p.data.vatRate,
    barcode: p.data.barcode,
    is_stocked: isStocked,
    low_stock_threshold: isStocked ? p.data.threshold : null,
    is_active: p.data.isActive,
  };

  if (p.data.id) {
    const { error } = await sb.from("products").update(row).eq("id", p.data.id);
    if (error) return { ok: false, error: friendly(error.message) };
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
