import { z } from "zod";
import type { RpcDraftDoc, RpcDraftLine } from "@/lib/supabase/rpc";
import { richDocSchema } from "@/lib/rich/schema";
import { richToPlainText } from "@/lib/rich/plain";

/** Mirrors the document_lines_unit_label_len CHECK. */
const MAX_UNIT_LABEL = 24;

/**
 * Builder → RPC boundary. The builder works in integer cents; here we validate
 * and convert to the DB's rupee-native shape. Pure (no server directives) so it
 * is unit-testable.
 */
export const draftLineSchema = z.object({
  productId: z.string().nullable(),
  title: z.string(),
  // Legacy flat text. Kept for lines saved before rich content existed; for any
  // line that has a tree, this is DERIVED at the seam below and never trusted.
  description: z.string().nullable().optional(),
  rich: richDocSchema.nullable().optional(),
  unitLabel: z.string().max(MAX_UNIT_LABEL).nullable().optional(),
  qty: z.number().positive(),
  unitCents: z.number().int().min(0), // a line can't carry a negative price (audit #10)
  discountPct: z.number().min(0).max(100).optional(),
  discountKind: z.enum(["percent", "amount"]).optional(),
  discountAmountCents: z.number().int().min(0).optional(), // VAT-inclusive
  vatRatePct: z.number(),
  // Stated on a hand-typed line only; a catalogue line leaves it null and lets
  // products.kind answer. Decides whether an accepted quote raises a job.
  lineKind: z.enum(["service", "product"]).nullable().optional(),
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
  comment: z.string().nullable().optional(), // internal note; never on a receipt/PDF
  discountKind: z.enum(["percent", "amount"]).nullable().optional(),
  discountValue: z.number().min(0).optional(), // percent: %, amount: Cents (VAT-inclusive)
  discountReason: z.string().optional(), // why — required once the discount reaches a carwash allowance
}).superRefine((d, ctx) => {
  // Order percent discount is bounded like the line-level one — an uncapped value
  // would drive an issued invoice's totals negative.
  if (d.discountKind === "percent" && (d.discountValue ?? 0) > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Discount cannot exceed 100%", path: ["discountValue"] });
  }
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
    comment: doc.comment ?? null,
    discount_kind: doc.discountKind ?? null,
    // amount is held in cents above the seam; the DB wants rupees (VAT-inclusive)
    discount_value: doc.discountKind === "amount" ? (doc.discountValue ?? 0) / 100 : (doc.discountValue ?? 0),
    // "" arrives whenever no reason was typed; save_draft's own nullif('') turns that into null.
    discount_reason: doc.discountReason ?? null,
  };
}

export function toRpcLines(lines: SaveDraftInput["lines"]): RpcDraftLine[] {
  return lines.map((l, i) => {
    // The flat mirror is DERIVED, never a second thing to keep in step. A tree that
    // flattens to nothing — an editor left with one empty paragraph — is not content,
    // so both columns go back to null rather than storing an empty shell.
    const flat = richToPlainText(l.rich ?? null);
    const hasRich = flat.trim().length > 0;

    return {
      product_id: l.productId,
      title: l.title,
      description: hasRich ? flat : (l.description ?? null),
      description_richtext: hasRich ? (l.rich ?? null) : null,
      unit_label: l.unitLabel?.trim() || null,
      qty: l.qty,
      unit_price: l.unitCents / 100, // cents → rupees for numeric(12,2)
      discount_pct: l.discountPct ?? 0,
      discount_kind: l.discountKind ?? "percent",
      discount_amount: (l.discountAmountCents ?? 0) / 100, // cents → rupees (VAT-inclusive)
      vat_rate: l.vatRatePct,
      sort_order: i,
      // Only a hand-typed line states one — null hands the question to the product.
      line_kind: l.productId ? null : l.lineKind ?? null,
    };
  });
}
