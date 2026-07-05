import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amountCents: number;
  vatCents: number;
  status: string;
}
export interface PORow {
  id: string;
  reference: string | null;
  supplier: string | null;
  date: string | null;
  status: string;
}

export interface PurchasesData {
  expenses: ExpenseRow[];
  expenseTotalCents: number;
  pos: PORow[];
}

export async function getPurchases(): Promise<PurchasesData> {
  const sb = await createClient();
  const [expRes, poRes] = await Promise.all([
    sb.from("expenses").select("id, category, description, amount, vat_amount, status, expense_date").order("expense_date", { ascending: false }).limit(100),
    sb.from("purchase_orders").select("id, reference, status, order_date, suppliers(name)").order("created_at", { ascending: false }).limit(50),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expenses: ExpenseRow[] = ((expRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    date: e.expense_date,
    category: e.category,
    description: e.description,
    amountCents: rupeesToCents(Number(e.amount)),
    vatCents: rupeesToCents(Number(e.vat_amount)),
    status: e.status,
  }));

  return {
    expenses,
    expenseTotalCents: expenses.reduce((s, e) => s + e.amountCents + e.vatCents, 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pos: ((poRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      reference: p.reference,
      supplier: p.suppliers?.name ?? null,
      date: p.order_date,
      status: p.status,
    })),
  };
}
