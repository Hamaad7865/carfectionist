import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { signVehiclePhotos } from "@/lib/supabase/storage";
import type { Marker } from "@/features/intake/damage";

export interface DocIntake {
  markers: Marker[];
  photos: { path: string; url: string; caption: string | null }[];
}

export interface PaymentView {
  id: string;
  method: string;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number | null;
  externalRef: string | null;
  receivedAt: string;
}

export interface DocumentDetail {
  id: string;
  docType: "quote" | "invoice" | "credit_note";
  status: string;
  number: string | null;
  issueDate: string | null;
  createdAt: string;
  customerName: string | null;
  subtotalCents: number;        // ex-VAT taxable base (post-discount)
  grossSubtotalCents: number;   // sum of line amounts (pre-order-discount)
  orderDiscountCents: number;   // whole-sale discount, ex-VAT
  discountKind: "percent" | "amount" | null;
  discountValue: number;
  vatCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  voidReason: string | null;
  voidedAt: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
  creditedByNumber: string | null;
  jobId: string | null;
  intake: DocIntake | null;
  lines: { title: string; description: string | null; qty: number; rateCents: number; amountCents: number }[];
  payments: PaymentView[];
}

export async function getDocumentDetail(id: string): Promise<DocumentDetail | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*, customers(name)").eq("id", id).maybeSingle();
  if (!doc) return null;

  const [{ data: lines }, { data: payments }] = await Promise.all([
    sb.from("document_lines").select("*").eq("document_id", id).order("sort_order"),
    sb.from("payments").select("*").eq("document_id", id).order("received_at"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;
  let sourceNumber: string | null = null;
  if (d.source_document_id) {
    const { data: src } = await sb.from("documents").select("number").eq("id", d.source_document_id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceNumber = (src as any)?.number ?? null;
  }
  let creditedByNumber: string | null = null;
  if (d.doc_type === "invoice") {
    const { data: cn } = await sb.from("documents").select("number").eq("source_document_id", id).eq("doc_type", "credit_note").neq("status", "void").maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    creditedByNumber = (cn as any)?.number ?? null;
  }
  // Intake condition (markers + before-photos stashed on the quote). Sign the
  // private photo paths for display.
  let intake: DocIntake | null = null;
  if (d.intake && (Array.isArray(d.intake.markers) || Array.isArray(d.intake.photos))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPhotos = (Array.isArray(d.intake.photos) ? d.intake.photos : []) as any[];
    const signed = await signVehiclePhotos(sb, rawPhotos.map((p) => p.path).filter(Boolean));
    intake = {
      markers: Array.isArray(d.intake.markers) ? d.intake.markers : [],
      photos: rawPhotos
        .filter((p) => p.path && signed[p.path])
        .map((p) => ({ path: p.path, url: signed[p.path], caption: p.caption ?? null })),
    };
  }

  const totalCents = rupeesToCents(Number(d.total_incl));
  const paidCents = rupeesToCents(Number(d.amount_paid));
  const subtotalCents = rupeesToCents(Number(d.subtotal_excl));
  // Sum of the (line-discounted) line amounts, before any whole-sale discount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grossSubtotalCents = ((lines ?? []) as any[]).reduce((s, l) => s + rupeesToCents(Number(l.line_total_excl)), 0);
  const orderDiscountCents = Math.max(0, grossSubtotalCents - subtotalCents);

  return {
    id: d.id,
    docType: d.doc_type,
    status: d.status,
    number: d.number,
    issueDate: d.issue_date,
    createdAt: d.created_at,
    customerName: d.customers?.name ?? d.bill_to_name ?? null,
    subtotalCents,
    grossSubtotalCents,
    orderDiscountCents,
    discountKind: d.discount_kind ?? null,
    discountValue: Number(d.discount_value ?? 0),
    vatCents: rupeesToCents(Number(d.vat_total)),
    totalCents,
    paidCents,
    outstandingCents: totalCents - paidCents,
    voidReason: d.void_reason ?? null,
    voidedAt: d.voided_at ?? null,
    sourceId: d.source_document_id ?? null,
    sourceNumber,
    creditedByNumber,
    jobId: d.job_id ?? null,
    intake,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (lines ?? []).map((l: any) => ({
      title: l.title,
      description: l.description,
      qty: Number(l.qty),
      rateCents: rupeesToCents(Number(l.unit_price)),
      amountCents: rupeesToCents(Number(l.line_total_excl)),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payments: (payments ?? []).map((p: any) => ({
      id: p.id,
      method: p.method,
      amountCents: rupeesToCents(Number(p.amount)),
      tenderedCents: p.tendered != null ? rupeesToCents(Number(p.tendered)) : null,
      changeCents: p.change_given != null ? rupeesToCents(Number(p.change_given)) : null,
      externalRef: p.external_ref,
      receivedAt: p.received_at,
    })),
  };
}
