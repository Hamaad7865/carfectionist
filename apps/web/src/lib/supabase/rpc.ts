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
  discount_kind: "percent" | "amount";
  discount_amount: number; // rupees, VAT-inclusive
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
  comment?: string | null;
  discount_kind: "percent" | "amount" | null;
  discount_value: number; // percent 0..100, or rupees (VAT-inclusive) for 'amount'
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
  // The service that rang this ticket. Without it the sale is money with no till, and the
  // cash-up cannot say which service it belongs to.
  sessionId: string | null = null,
) =>
  callRpc<DocumentRow>(sb, "issue_document", {
    p_document_id: documentId,
    p_stock_location_id: stockLocationId,
    p_idempotency_key: idempotencyKey,
    p_session_id: sessionId,
  });

export const convertQuoteToInvoice = (sb: Client, quoteId: string) =>
  callRpc<DocumentRow>(sb, "convert_quote_to_invoice", { p_quote_id: quoteId });

export const reviseQuote = (sb: Client, quoteId: string) =>
  callRpc<DocumentRow>(sb, "revise_quote", { p_quote_id: quoteId });

export const duplicateDocument = (sb: Client, id: string) =>
  callRpc<DocumentRow>(sb, "duplicate_document", { p_id: id });

export const createDocumentFromJob = (sb: Client, jobId: string, docType: "quote" | "invoice") =>
  callRpc<DocumentRow>(sb, "create_document_from_job", { p_job_id: jobId, p_doc_type: docType });

export interface CreateJobArgs {
  customerId?: string | null;
  newCustomerName?: string | null;
  newCustomerPhone?: string | null;
  vehicleId?: string | null;
  newVehiclePlate?: string | null;
  newVehicleMake?: string | null;
  service?: string | null;
  technicianId?: string | null;
  department?: string | null;
  checklist: unknown;
}
export interface CreateIntakeQuoteArgs {
  customerId?: string | null;
  newCustomerName?: string | null;
  newCustomerPhone?: string | null;
  vehicleId?: string | null;
  newVehiclePlate?: string | null;
  newVehicleMake?: string | null;
  service?: string | null;
  markers: unknown;
  photos: unknown;
}
export const createIntakeQuote = (sb: Client, a: CreateIntakeQuoteArgs) =>
  callRpc<DocumentRow>(sb, "create_intake_quote", {
    p_customer_id: a.customerId ?? null,
    p_new_customer_name: a.newCustomerName ?? null,
    p_new_customer_phone: a.newCustomerPhone ?? null,
    p_vehicle_id: a.vehicleId ?? null,
    p_new_vehicle_plate: a.newVehiclePlate ?? null,
    p_new_vehicle_make: a.newVehicleMake ?? null,
    p_service: a.service ?? null,
    p_markers: a.markers,
    p_photos: a.photos,
  });
export const createJobFromDocument = (sb: Client, documentId: string) =>
  callRpc<{ id: string }>(sb, "create_job_from_document", { p_document_id: documentId });

/** Accept a quote → issue+accept it and spawn the linked job in one txn.
 *  Idempotent: a re-click returns the same job (same RPC the Android POS uses). */
export const convertQuoteToJob = (sb: Client, quoteId: string) =>
  callRpc<{ id: string }>(sb, "convert_quote_to_job", { p_quote_id: quoteId, p_technician_id: null, p_scheduled_at: null });

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  stock_adjusted?: number;
  errors: { name?: string; sku?: string; error: string }[];
}
export const importCustomers = (sb: Client, rows: unknown[], dryRun: boolean) =>
  callRpc<ImportReport>(sb, "import_customers", { p_rows: rows, p_dry_run: dryRun });
export const importProducts = (sb: Client, rows: unknown[], dryRun: boolean) =>
  callRpc<ImportReport>(sb, "import_products", { p_rows: rows, p_dry_run: dryRun });

export const createJob = (sb: Client, a: CreateJobArgs) =>
  callRpc<{ id: string }>(sb, "create_job", {
    p_customer_id: a.customerId ?? null,
    p_new_customer_name: a.newCustomerName ?? null,
    p_new_customer_phone: a.newCustomerPhone ?? null,
    p_vehicle_id: a.vehicleId ?? null,
    p_new_vehicle_plate: a.newVehiclePlate ?? null,
    p_new_vehicle_make: a.newVehicleMake ?? null,
    p_service: a.service ?? null,
    p_technician_id: a.technicianId ?? null,
    p_department: a.department ?? null,
    p_checklist: a.checklist,
  });

export interface RecordPaymentArgs {
  invoiceId: string;
  method: "cash" | "card" | "juice" | "bank_transfer";
  amount: number; // rupees
  tendered?: number | null;
  externalRef?: string | null;
  cashSessionId?: string | null;
  idempotencyKey?: string | null;
}

export const recordPayment = (sb: Client, a: RecordPaymentArgs) =>
  callRpc<PaymentRow>(sb, "record_payment", {
    p_invoice_id: a.invoiceId,
    p_method: a.method,
    p_amount: a.amount,
    p_tendered: a.tendered ?? null,
    p_external_ref: a.externalRef ?? null,
    p_cash_session_id: a.cashSessionId ?? null,
    p_idempotency_key: a.idempotencyKey ?? null,
  });

export const voidDocument = (sb: Client, id: string, reason: string) =>
  callRpc<DocumentRow>(sb, "void_document", { p_id: id, p_reason: reason });

export const createCreditNote = (sb: Client, invoiceId: string, restock: boolean, location: string | null = null) =>
  callRpc<DocumentRow>(sb, "create_and_issue_credit_note", { p_invoice_id: invoiceId, p_stock_location_id: location, p_restock: restock });

// ── Operations (migration 0004) ──────────────────────────────────────────────
export const completeJob = (sb: Client, jobId: string, consumptions: { product_id: string; qty: number }[], location: string | null = null) =>
  callRpc<unknown>(sb, "complete_job", { p_job_id: jobId, p_location: location, p_consumptions: consumptions });

export const openCashSession = (sb: Client, deviceId: string, openingFloat: number) =>
  callRpc<{ id: string }>(sb, "open_cash_session", { p_device_id: deviceId, p_opening_float: openingFloat });

export const closeCashSession = (sb: Client, id: string, closingCount: number) =>
  callRpc<{ id: string; variance: string }>(sb, "close_cash_session", { p_id: id, p_closing_count: closingCount });

export const dispatchTransfer = (sb: Client, id: string) =>
  callRpc<{ id: string }>(sb, "dispatch_transfer", { p_id: id });

export const receiveTransfer = (sb: Client, id: string, lines: { line_id: string; qty_received: number }[]) =>
  callRpc<{ id: string }>(sb, "receive_transfer", { p_id: id, p_lines: lines });

export const receivePurchaseOrder = (sb: Client, id: string, location: string | null, lines: { line_id: string; qty: number }[]) =>
  callRpc<{ id: string }>(sb, "receive_purchase_order", { p_id: id, p_location: location, p_lines: lines });

// ── Point of Sale module (migration 20260711000004) ──────────────────────────
export interface DeviceRow {
  id: string;
  device_code: string;
  display_name: string | null;
  model: string | null;
  app_version: string | null;
  is_active: boolean;
  first_seen: string;
  last_seen: string;
}

export const renameDevice = (sb: Client, deviceId: string, name: string) =>
  callRpc<DeviceRow>(sb, "rename_device", { p_device_id: deviceId, p_name: name });

export const setDeviceActive = (sb: Client, deviceId: string, active: boolean) =>
  callRpc<DeviceRow>(sb, "set_device_active", { p_device_id: deviceId, p_active: active });

export const closePeriod = (sb: Client, period: string) =>
  callRpc<{ id: string; period: string; totals: unknown }>(sb, "close_period", { p_period: period });

export interface TillMovementRow {
  id: string;
  cash_session_id: string;
  amount: string; // negative = cash out
  reason: string;
  created_at: string;
}

export const recordTillCashOut = (sb: Client, sessionId: string, amount: number, reason: string, idempotencyKey: string | null = null) =>
  callRpc<TillMovementRow>(sb, "record_till_cash_out", {
    p_session_id: sessionId,
    p_amount: amount,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
