import Link from "next/link";
import { getPurchases, getPurchaseOrders } from "@/lib/supabase/queries/purchases";
import { NewExpenseForm } from "@/features/purchases/NewExpenseForm";
import { ExpensesPanel } from "@/features/purchases/ExpensesPanel";
import { PurchaseOrdersPanel } from "@/features/purchases/PurchaseOrdersPanel";

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "orders" ? "orders" : "expenses";
  const data = tab === "expenses" ? await getPurchases() : null;
  const poData = tab === "orders" ? await getPurchaseOrders() : null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href="/purchases" className={tabCls(tab === "expenses")}>Expenses</Link>
        <Link href="/purchases?tab=orders" className={tabCls(tab === "orders")}>Purchase orders</Link>
        <div className="flex-1" />
        {tab === "expenses" && <NewExpenseForm today={today} />}
      </div>

      {tab === "expenses" && data && (
        <ExpensesPanel expenses={data.expenses} totalCents={data.expenseTotalCents} />
      )}

      {tab === "orders" && poData && <PurchaseOrdersPanel data={poData} />}
    </div>
  );
}
