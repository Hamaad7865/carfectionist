import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

/** One company's document of a two-company sale (tyre centre: the tyre bill and the service bill). */
export interface CheckoutBill {
  id: string;
  number: string | null;
  docType: string;
  status: string;
  totalCents: number;
  outstandingCents: number;
  legalEntityId: string;
  companyName: string;
  /** The company's place in the shop's sort order — its colour, its place on the receipts. */
  index: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** Every live document of the sale this one belongs to, in company order — or [] when it stands
 *  alone (every Carfectionist document: none has a checkout group). RLS-scoped. */
export async function getCheckoutBills(documentId: string): Promise<CheckoutBill[]> {
  const sb = await createClient();
  const { data: self } = await sb.from("documents").select("checkout_group_id, doc_type").eq("id", documentId).maybeSingle();
  const group = (self as Row)?.checkout_group_id as string | null | undefined;
  if (!group) return [];
  const [docs, ents] = await Promise.all([
    sb
      .from("documents")
      .select("id, number, doc_type, status, total_incl, amount_paid, legal_entity_id")
      .eq("checkout_group_id", group)
      .eq("doc_type", (self as Row).doc_type)
      .neq("status", "void"),
    sb.from("legal_entities").select("id, legal_name, trading_name, is_default, sort_order").order("sort_order").order("id"),
  ]);
  const companies = (ents.data ?? []) as Row[];
  const main = companies.find((c) => c.is_default);
  const bills = ((docs.data ?? []) as Row[]).map((d): CheckoutBill => {
    const entityId = (d.legal_entity_id as string | null) ?? main?.id ?? "";
    const at = companies.findIndex((c) => c.id === entityId);
    const co = companies[at];
    const totalCents = rupeesToCents(Number(d.total_incl));
    return {
      id: d.id,
      number: d.number ?? null,
      docType: d.doc_type,
      status: d.status,
      totalCents,
      outstandingCents: d.doc_type === "invoice" ? totalCents - rupeesToCents(Number(d.amount_paid ?? 0)) : 0,
      legalEntityId: entityId,
      companyName: co ? co.trading_name || co.legal_name : "—",
      index: Math.max(0, at),
    };
  });
  return bills.length > 1 ? bills.sort((a, b) => a.index - b.index) : [];
}
