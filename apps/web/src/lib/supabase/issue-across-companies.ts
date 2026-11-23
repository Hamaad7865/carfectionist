import type { SupabaseClient } from "@supabase/supabase-js";
import * as rpc from "@/lib/supabase/rpc";
import { readCompanyDiscounts, toCheckoutDiscounts } from "@/lib/documents/company-split";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any>;

/** How many issuing companies this shop runs (RLS: the caller's own shop). */
export async function activeCompanyCount(sb: Client): Promise<number> {
  const { count } = await sb.from("legal_entities").select("id", { count: "exact", head: true }).eq("is_active", true);
  return count ?? 0;
}

export interface IssueOptions {
  stockLocationId?: string | null;
  idempotencyKey?: string | null;
  /** The till that rang it. A quote passes none on purpose (a stale till must not refuse a quote). */
  sessionId?: string | null;
}

/**
 * THE way server code issues a draft — quote or invoice, web or tablet (the tablet reaches it
 * through /api/documents/[id]/send, which issues a draft quotation on the way out).
 *
 *  - A one-company shop (Carfectionist): issue_document, exactly as before.
 *  - A two-company shop (tyre centre): issue_checkout. A draft whose lines are sold by both
 *    companies becomes ONE DOCUMENT PER COMPANY, each numbered in its own company's series; the
 *    first company's keeps this draft's id. A draft for one company is issue_document under the
 *    same key. Each company's discount (stored on the draft, see company-split.ts) goes with it.
 *
 * Returns every document issued, in company order. [0] is always this draft's own id.
 */
export async function issueAcrossCompanies(sb: Client, documentId: string, o: IssueOptions = {}): Promise<rpc.CheckoutDocumentRow[]> {
  const stock = o.stockLocationId ?? null;
  const key = o.idempotencyKey ?? null;
  const session = o.sessionId ?? null;

  if ((await activeCompanyCount(sb)) <= 1) {
    const row = await rpc.issueDocument(sb as any, documentId, stock, key, session);
    return [{ ...row, legal_entity_id: (row as any).legal_entity_id ?? null, checkout_group_id: (row as any).checkout_group_id ?? null }];
  }

  // Only a draft that really spans companies takes per-company discounts; a stale entry left from
  // an earlier edit (the draft has since lost its other company's lines) is ignored.
  let discounts: rpc.CheckoutDiscount[] | null = null;
  const { data: doc } = await sb.from("documents").select("status, template_overrides").eq("id", documentId).maybeSingle();
  if ((doc as any)?.status === "draft") {
    const stored = readCompanyDiscounts((doc as any)?.template_overrides);
    if (Object.keys(stored).length > 0) {
      const plan = await rpc.checkoutDocumentIds(sb as any, documentId);
      if (plan.length > 1) {
        const list = toCheckoutDiscounts(stored, plan.map((p) => p.legal_entity_id));
        discounts = list.length > 0 ? list : null;
      }
    }
  }
  return rpc.issueCheckout(sb as any, documentId, stock, key, session, discounts);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
