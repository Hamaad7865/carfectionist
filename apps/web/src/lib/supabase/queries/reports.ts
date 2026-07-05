import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface PaymentReportRow {
  id: string;
  date: string;
  number: string | null;
  customer: string | null;
  method: string;
  amountCents: number;
}

export interface ReportsData {
  payments: PaymentReportRow[];
  byMethod: { method: string; cents: number }[];
  collectedCents: number;
  invoicedCents: number;
  outstandingCents: number;
  vat: { outputCents: number; inputCents: number; netCents: number };
  aged: { label: string; cents: number }[];
}

function daysBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / 86_400_000);
}

export async function getReportsData(from?: string, to?: string): Promise<ReportsData> {
  const sb = await createClient();

  let payQ = sb
    .from("payments")
    .select("id, method, amount, received_at, documents(number, customers(name))")
    .order("received_at", { ascending: false })
    .limit(500);
  if (from) payQ = payQ.gte("received_at", from);
  if (to) payQ = payQ.lte("received_at", `${to}T23:59:59`);

  const [payRes, invRes, expRes] = await Promise.all([
    payQ,
    sb.from("documents").select("total_incl, vat_total, amount_paid, status, issue_date").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]),
    sb.from("expenses").select("vat_amount"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: PaymentReportRow[] = ((payRes.data ?? []) as any[])
    .filter((p) => Number(p.amount) > 0)
    .map((p) => ({
      id: p.id,
      date: (p.received_at as string).slice(0, 16).replace("T", " "),
      number: p.documents?.number ?? null,
      customer: p.documents?.customers?.name ?? null,
      method: p.method,
      amountCents: rupeesToCents(Number(p.amount)),
    }));

  const methodMap = new Map<string, number>();
  for (const p of payments) methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + p.amountCents);
  const byMethod = [...methodMap.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);
  const collectedCents = payments.reduce((s, p) => s + p.amountCents, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoices = (invRes.data ?? []) as any[];
  const invoicedCents = invoices.reduce((s, d) => s + rupeesToCents(Number(d.total_incl)), 0);
  const outputVat = invoices.reduce((s, d) => s + rupeesToCents(Number(d.vat_total)), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputVat = ((expRes.data ?? []) as any[]).reduce((s, e) => s + rupeesToCents(Number(e.vat_amount)), 0);

  const now = Date.now();
  const buckets = [
    { label: "0–30 days", cents: 0 },
    { label: "31–60 days", cents: 0 },
    { label: "61–90 days", cents: 0 },
    { label: "90+ days", cents: 0 },
  ];
  let outstandingCents = 0;
  for (const d of invoices) {
    if (!["issued", "partly_paid"].includes(d.status)) continue;
    const owed = rupeesToCents(Number(d.total_incl) - Number(d.amount_paid));
    if (owed <= 0) continue;
    outstandingCents += owed;
    const age = d.issue_date ? daysBetween(d.issue_date, now) : 0;
    const i = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    buckets[i].cents += owed;
  }

  return {
    payments,
    byMethod,
    collectedCents,
    invoicedCents,
    outstandingCents,
    vat: { outputCents: outputVat, inputCents: inputVat, netCents: outputVat - inputVat },
    aged: buckets,
  };
}
