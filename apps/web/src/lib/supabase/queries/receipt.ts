import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ReceiptLine { qty: number; title: string; unitInclCents: number; totalInclCents: number; }
export interface ReceiptVatGroup { rate: number; baseCents: number; vatCents: number; inclCents: number; }
export interface ReceiptData {
  studioName: string;
  address: string;
  brn: string;
  vatNo: string;
  number: string | null;
  dateTime: string;
  cashier: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  vatGroups: ReceiptVatGroup[];
  payments: { method: string; amountCents: number }[];
}

const METHOD_LABEL: Record<string, string> = { cash: "CASH", card: "CARD", juice: "JUICE", bank_transfer: "BANK TRANSFER" };

/** DD-MM-YYYY HH:MM:SS in Mauritius time (+04), matching the thermal receipt. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 4 * 3600_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export async function getReceipt(id: string): Promise<ReceiptData | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*, customers(name)").eq("id", id).maybeSingle();
  if (!doc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;

  const [{ data: lines }, { data: pays }, { data: bs }] = await Promise.all([
    sb.from("document_lines").select("qty, title, line_total_excl, line_vat").eq("document_id", id).order("sort_order"),
    sb.from("payments").select("method, amount").eq("document_id", id).order("received_at"),
    sb.from("business_settings").select("trading_name, address, brn, vat_number").limit(1).maybeSingle(),
  ]);

  let cashier = "";
  if (d.created_by) {
    const { data: u } = await sb.from("app_users").select("display_name").eq("id", d.created_by).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cashier = (((u as any)?.display_name ?? "") as string).replace(/\s*\(.*\)\s*$/, "").trim();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rLines: ReceiptLine[] = ((lines ?? []) as any[]).map((l) => {
    const qty = Number(l.qty);
    const incl = rupeesToCents(Number(l.line_total_excl)) + rupeesToCents(Number(l.line_vat));
    return { qty, title: l.title, unitInclCents: qty ? Math.round(incl / qty) : incl, totalInclCents: incl };
  });

  const subtotalCents = rupeesToCents(Number(d.subtotal_excl));
  const vatCents = rupeesToCents(Number(d.vat_total));
  const totalCents = rupeesToCents(Number(d.total_incl));

  let vatGroups: ReceiptVatGroup[] = Array.isArray(d.vat_breakdown)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (d.vat_breakdown as any[]).map((g) => {
        const base = rupeesToCents(Number(g.base));
        const vat = rupeesToCents(Number(g.vat));
        return { rate: Number(g.rate), baseCents: base, vatCents: vat, inclCents: base + vat };
      })
    : [];
  if (vatGroups.length === 0 && totalCents > 0) {
    vatGroups = [{ rate: 15, baseCents: subtotalCents, vatCents, inclCents: totalCents }];
  }

  // Net tenders by method so reversal/re-payment pairs collapse to the effective
  // amount actually taken (a receipt shows what was paid, not the audit trail).
  const payMap = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (pays ?? []) as any[]) payMap.set(p.method, (payMap.get(p.method) ?? 0) + rupeesToCents(Number(p.amount)));
  const payments = [...payMap.entries()].filter(([, c]) => c > 0).map(([m, c]) => ({ method: METHOD_LABEL[m] ?? m.toUpperCase(), amountCents: c }));

  return {
    studioName: b.trading_name ?? "Carfectionist",
    address: b.address ?? "",
    brn: b.brn ?? "",
    vatNo: b.vat_number ?? "",
    number: d.number,
    dateTime: fmtDateTime(d.issued_at ?? (d.issue_date ? `${d.issue_date}T00:00:00Z` : null) ?? d.created_at),
    cashier,
    lines: rLines,
    subtotalCents,
    vatCents,
    totalCents,
    vatGroups,
    payments,
  };
}
