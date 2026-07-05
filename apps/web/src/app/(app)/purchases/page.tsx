import Link from "next/link";
import { getPurchases } from "@/lib/supabase/queries/purchases";
import { NewExpenseForm } from "@/features/purchases/NewExpenseForm";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";

const tabCls = (on: boolean) =>
  `h-[38px] rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "orders" ? "orders" : "expenses";
  const data = await getPurchases();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-1.5">
        <Link href="/purchases" className={tabCls(tab === "expenses")}>Expenses</Link>
        <Link href="/purchases?tab=orders" className={tabCls(tab === "orders")}>Purchase orders</Link>
        <div className="flex-1" />
        {tab === "expenses" && <NewExpenseForm today={today} />}
      </div>

      {tab === "expenses" ? (
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="grid grid-cols-[100px_150px_1fr_100px_140px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            <span>Date</span>
            <span>Category</span>
            <span>Description</span>
            <span>Status</span>
            <span className="text-right">Amount</span>
          </div>
          {data.expenses.length === 0 ? (
            <div className="px-5 py-14 text-center text-[13px] text-faint">No expenses yet. Add your first with “New expense”.</div>
          ) : (
            data.expenses.map((e) => (
              <div key={e.id} className="grid grid-cols-[100px_150px_1fr_100px_140px] items-center gap-3 border-b border-line px-5 py-3.5 text-[13px]">
                <span className="num text-muted">{e.date}</span>
                <span className="text-[#5e6a77]">{e.category}</span>
                <span className="font-semibold text-body">{e.description ?? "—"}</span>
                <span><StatusPill status={e.status} /></span>
                <span className="num text-right font-bold text-ink">{formatMUR(e.amountCents + e.vatCents)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between bg-band px-5 py-3.5">
            <span className="text-[12.5px] font-bold text-muted">Total expenses (incl. VAT)</span>
            <span className="num text-[14px] font-extrabold text-rose">{formatMUR(data.expenseTotalCents)}</span>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="grid grid-cols-[1fr_120px_140px_120px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            <span>Supplier / reference</span>
            <span>Date</span>
            <span>Status</span>
            <span className="text-right"> </span>
          </div>
          {data.pos.length === 0 ? (
            <div className="px-5 py-14 text-center text-[13px] text-muted">
              No purchase orders yet. PO creation and receiving (which fires <span className="num">purchase</span> stock movements) arrive with
              suppliers in <span className="font-semibold text-body">Phase 2/3</span>.
            </div>
          ) : (
            data.pos.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_120px_140px_120px] items-center gap-3 border-b border-line px-5 py-3.5 text-[13px]">
                <span className="font-semibold text-body">{p.supplier ?? p.reference ?? "—"}</span>
                <span className="num text-muted">{p.date ?? "—"}</span>
                <span><StatusPill status={p.status} /></span>
                <span />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
