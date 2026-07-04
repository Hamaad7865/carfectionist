import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The numbering / MRA seam. Every money-path write flows through one of these
 * typed wrappers; callers never format numbers or touch the RPC names directly.
 * Money crosses this boundary in rupees (DB numeric(12,2)); the client keeps
 * integer cents above it.
 */
type Client = SupabaseClient<Database>;

export interface RpcDraftLine {
  product_id: string | null;
  title: string;
  description: string | null;
  qty: number;
  unit_price: number; // rupees
  discount_pct: number;
  vat_rate: number; // percent
  sort_order: number;
}

export interface RpcDraftDoc {
  id?: string | null;
  doc_type: "quote" | "invoice";
  customer_id: string | null;
  vehicle_id: string | null;
  template_id: string | null;
  template_overrides: Record<string, unknown>;
  valid_until: string | null;
  due_date: string | null;
  origin: "standalone" | "from_job";
}

export interface DocumentRow {
  id: string;
  doc_type: string;
  status: string;
  number: string | null;
  subtotal_excl: string;
  vat_total: string;
  total_incl: string;
  amount_paid: string;
  revision: number;
  customer_id: string | null;
  source_document_id: string | null;
  issued_at: string | null;
}

export interface PaymentRow {
  id: string;
  document_id: string;
  method: string;
  amount: string;
  tendered: string | null;
  change_given: string | null;
  external_ref: string | null;
}

async function callRpc<T>(sb: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const saveDraft = (sb: Client, doc: RpcDraftDoc, lines: RpcDraftLine[], expectedRev: number | null) =>
  callRpc<DocumentRow>(sb, "save_draft", { p_doc: doc, p_lines: lines, p_expected_rev: expectedRev });

export const issueDocument = (
  sb: Client,
  documentId: string,
  stockLocationId: string | null = null,
  idempotencyKey: string | null = null,
) =>
  callRpc<DocumentRow>(sb, "issue_document", {
    p_document_id: documentId,
    p_stock_location_id: stockLocationId,
    p_idempotency_key: idempotencyKey,
  });

export const convertQuoteToInvoice = (sb: Client, quoteId: string) =>
  callRpc<DocumentRow>(sb, "convert_quote_to_invoice", { p_quote_id: quoteId });

export interface RecordPaymentArgs {
  invoiceId: string;
  method: "cash" | "card" | "juice" | "bank_transfer";
  amount: number; // rupees
  tendered?: number | null;
  externalRef?: string | null;
  cashSessionId?: string | null;
}

export const recordPayment = (sb: Client, a: RecordPaymentArgs) =>
  callRpc<PaymentRow>(sb, "record_payment", {
    p_invoice_id: a.invoiceId,
    p_method: a.method,
    p_amount: a.amount,
    p_tendered: a.tendered ?? null,
    p_external_ref: a.externalRef ?? null,
    p_cash_session_id: a.cashSessionId ?? null,
  });

export const voidDocument = (sb: Client, id: string, reason: string) =>
  callRpc<DocumentRow>(sb, "void_document", { p_id: id, p_reason: reason });
