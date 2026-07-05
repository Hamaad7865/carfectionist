import Link from "next/link";
import { getInventory } from "@/lib/supabase/queries/inventory";
import { getTransfers } from "@/lib/supabase/queries/transfers";
import { TransfersPanel } from "@/features/transfers/TransfersPanel";
import { getRecipes } from "@/lib/supabase/queries/recipes";
import { RecipesPanel } from "@/features/recipes/RecipesPanel";
import { formatMUR } from "@/lib/money";

const KIND_LABEL: Record<string, string> = { service: "Service", consumable: "Consumable", product: "Product" };
const COLS = "grid-cols-[1fr_110px_90px_90px_70px_80px_80px_80px]";
const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

const qty = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(n));

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "transfers" ? "transfers" : sp.tab === "recipes" ? "recipes" : "catalogue";
  const rows = tab === "catalogue" ? await getInventory() : [];
  const transferData = tab === "transfers" ? await getTransfers() : null;
  const recipeData = tab === "recipes" ? await getRecipes() : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex gap-1.5">
        <Link href="/products" className={tabCls(tab === "catalogue")}>Catalogue</Link>
        <Link href="/products?tab=transfers" className={tabCls(tab === "transfers")}>Transfers</Link>
        <Link href="/products?tab=recipes" className={tabCls(tab === "recipes")}>Recipes</Link>
      </div>

      {tab === "catalogue" && (
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className={`grid ${COLS} gap-2.5 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-faint`}>
            <span>Product</span>
            <span>Category</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Sell</span>
            <span className="text-right">Margin</span>
            <span className="text-right">Store</span>
            <span className="text-right">Floor</span>
            <span className="text-right">On-hand</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className={`grid ${COLS} items-center gap-2.5 border-b border-line px-5 py-3`}>
              <span className="text-[13px] font-semibold text-body">
                {r.name}
                {r.low && <span className="ml-2 rounded-[5px] bg-[rgba(245,166,35,0.14)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-ink">LOW</span>}
              </span>
              <span className="text-[12px] text-[#5e6a77]">{KIND_LABEL[r.kind] ?? r.kind}</span>
              <span className="num text-right text-[12px] text-muted">{formatMUR(r.costCents)}</span>
              <span className="num text-right text-[12px] font-semibold text-body">{formatMUR(r.sellCents)}</span>
              <span className="num text-right text-[12px] font-semibold text-mint">{r.marginPct}%</span>
              <span className="num text-right text-[12px] text-muted">{qty(r.store)}</span>
              <span className="num text-right text-[12px] text-muted">{qty(r.floor)}</span>
              <span className="num text-right text-[14px] font-extrabold" style={{ color: r.low ? "#b07c14" : r.onHand == null ? "#8c96a1" : "#172130" }}>
                {qty(r.onHand)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "transfers" && transferData && <TransfersPanel transfers={transferData.transfers} refData={transferData.ref} />}
      {tab === "recipes" && recipeData && <RecipesPanel data={recipeData} />}
    </div>
  );
}
