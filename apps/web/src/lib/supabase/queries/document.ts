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
  /** Who took the money — the payments panel reads as a ledger, not a list of amounts. */
  receivedByName: string | null;
  /** A correction mirror (negative row). */
  isReversal: boolean;
  /** An original that a later mirror undid — shown struck, kept visible. */
  wasReversed: boolean;
}

export interface DocumentDetail {
  id: string;
  docType: "quote" | "invoice" | "credit_note";
  status: string;
  number: string | null;
  issueDate: string | null;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  /** The account behind the invoice — what a statement of account is FOR. */
  customerId: string | null;
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
  /** Set when a human filed this out of the working list (never a delete). */
  archivedAt: string | null;
  comment: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
  creditedByNumber: string | null;
  jobId: string | null;
  /** The job's live status — drives the "hand over on account" action on an open bill. */
  jobStatus: string | null;
  /** For a job invoice: the vehicle worked on + what was done (its ticked checklist).
   *  Mirrors the tablet payment panel's "what service the client took" detail. */
  vehicle: { plate: string | null; make: string | null; model: string | null } | null;
  jobChecklist: { label: string; done: boolean }[];
  intake: DocIntake | null;
  /** Client signature captured on the tablet when the quote was accepted. */
  acceptedSignature: { url: string; name: string | null; at: string | null } | null;
  lines: { title: string; description: string | null; qty: number; rateCents: number; amountCents: number }[];
  payments: PaymentView[];
}

export async function getDocumentDetail(id: string): Promise<DocumentDetail | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*, customers(name, email, phone)").eq("id", id).maybeSingle();
  if (!doc) return null;

  const [{ data: lines }, { data: payments }] = await Promise.all([
    sb.from("document_lines").select("*").eq("document_id", id).order("sort_order"),
    sb.from("payments").select("*").eq("document_id", id).order("received_at"),
  ]);

  // Resolve who took each payment, and which originals a mirror later undid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payRows = (payments ?? []) as any[];
  const takerIds = [...new Set(payRows.map((p) => p.received_by).filter(Boolean))] as string[];
  const takersRes = takerIds.length ? await sb.from("app_users").select("id, display_name").in("id", takerIds) : { data: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const takerName = new Map(((takersRes.data ?? []) as any[]).map((u) => [u.id as string, u.display_name as string]));
  const reversedIds = new Set(payRows.filter((p) => p.reverses_payment_id).map((p) => p.reverses_payment_id as string));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;
  let sourceNumber: string | null = null;
  if (d.source_document_id) {
    const { data: src } = await sb.from("documents").select("number").eq("id", d.source_document_id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceNumber = (src as any)?.number ?? null;
  }
  let jobStatus: string | null = null;
  let vehicle: DocumentDetail["vehicle"] = null;
  let jobChecklist: DocumentDetail["jobChecklist"] = [];
  if (d.job_id) {
    const { data: job } = await sb.from("jobs").select("status, checklist, vehicles(plate, make, model)").eq("id", d.job_id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = job as any;
    jobStatus = j?.status ?? null;
    // A many-to-one embed returns an object, but tolerate an array shape too.
    const v = Array.isArray(j?.vehicles) ? j.vehicles[0] : j?.vehicles;
    vehicle = v ? { plate: v.plate ?? null, make: v.make ?? null, model: v.model ?? null } : null;
    jobChecklist = Array.isArray(j?.checklist)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? j.checklist.map((c: any) => ({ label: String(c?.label ?? ""), done: !!c?.done })).filter((c: { label: string }) => c.label)
      : [];
  }
  let creditedByNumber: string | null = null;
  if (d.doc_type === "invoice") {
    const { data: cn } = await sb.from("documents").select("number").eq("source_document_id", id).eq("doc_type", "credit_note").neq("status", "void").order("created_at", { ascending: false }).limit(1).maybeSingle();
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

  // Acceptance signature (drawn on the tablet; stamped by convert_quote_to_job).
  let acceptedSignature: DocumentDetail["acceptedSignature"] = null;
  if (d.accepted_signature?.path) {
    const signed = await signVehiclePhotos(sb, [d.accepted_signature.path]);
    const url = signed[d.accepted_signature.path];
    if (url) acceptedSignature = { url, name: d.accepted_signature.name ?? null, at: d.accepted_signature.at ?? null };
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
    customerEmail: d.customers?.email ?? null,
    customerPhone: d.customers?.phone ?? null,
    customerId: d.customer_id ?? null,
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
    archivedAt: d.archived_at ?? null,
    comment: d.comment ?? null,
    sourceId: d.source_document_id ?? null,
    sourceNumber,
    creditedByNumber,
    jobId: d.job_id ?? null,
    jobStatus,
    vehicle,
    jobChecklist,
    intake,
    acceptedSignature,
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
      receivedByName: takerName.get(p.received_by) ?? null,
      isReversal: p.reverses_payment_id != null,
      wasReversed: reversedIds.has(p.id),
    })),
  };
}
