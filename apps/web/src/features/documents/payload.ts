import { z } from "zod";
import type { RpcDraftDoc, RpcDraftLine } from "@/lib/supabase/rpc";

/**
 * Builder → RPC boundary. The builder works in integer cents; here we validate
 * and convert to the DB's rupee-native shape. Pure (no server directives) so it
 * is unit-testable.
 */
export const draftLineSchema = z.object({
  productId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable().optional(),
  qty: z.number().positive(),
  unitCents: z.number().int(),
  discountPct: z.number().min(0).max(100).optional(),
  vatRatePct: z.number(),
});

export const draftDocSchema = z.object({
  id: z.string().nullable().optional(),
  docType: z.enum(["quote", "invoice"]),
  customerId: z.string().nullable().optional(),
  vehicleId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  templateOverrides: z.record(z.string(), z.unknown()).optional(),
  validUntil: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  origin: z.enum(["standalone", "from_job"]).optional(),
});

export const saveDraftInputSchema = z.object({
  doc: draftDocSchema,
  lines: z.array(draftLineSchema),
  expectedRev: z.number().int().nullable().optional(),
});

export type SaveDraftInput = z.infer<typeof saveDraftInputSchema>;

export function toRpcDoc(doc: SaveDraftInput["doc"]): RpcDraftDoc {
  return {
    id: doc.id ?? null,
    doc_type: doc.docType,
    customer_id: doc.customerId ?? null,
    vehicle_id: doc.vehicleId ?? null,
    template_id: doc.templateId ?? null,
    template_overrides: doc.templateOverrides ?? {},
    valid_until: doc.validUntil ?? null,
    due_date: doc.dueDate ?? null,
    origin: doc.origin ?? "standalone",
  };
}

export function toRpcLines(lines: SaveDraftInput["lines"]): RpcDraftLine[] {
  return lines.map((l, i) => ({
    product_id: l.productId,
    title: l.title,
    description: l.description ?? null,
    qty: l.qty,
    unit_price: l.unitCents / 100, // cents → rupees for numeric(12,2)
    discount_pct: l.discountPct ?? 0,
    vat_rate: l.vatRatePct,
    sort_order: i,
  }));
}
