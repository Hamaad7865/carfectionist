import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCounterRef } from "@/lib/supabase/queries/counter";
import { getSessionContext } from "@/lib/auth/session";
import { CounterSale } from "@/features/counter/CounterSale";

export default async function CounterSalePage() {
  const [{ products, customers, pricesInclVat }, ctx] = await Promise.all([getCounterRef(), getSessionContext()]);
  // Pricing the catalogue is an owner/manager decision — a cashier at the till may not
  // invent a price (the server action enforces this too; this only shapes the UI).
  const canPrice = ctx?.role === "owner" || ctx?.role === "manager";

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/sales" className="flex size-9 items-center justify-center rounded-[10px] border border-line-2 bg-card text-muted hover:text-body">
          <ArrowLeft size={17} />
        </Link>
        <div>
          <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Counter sale</h2>
          <p className="text-[12.5px] text-muted">Walk-in sale — issues a standalone invoice and takes payment in one step.</p>
        </div>
      </div>
      <CounterSale products={products} customers={customers} canPrice={canPrice} pricesInclVat={pricesInclVat} />
    </div>
  );
}
