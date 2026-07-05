import Link from "next/link";
import { getInventory } from "@/lib/supabase/queries/inventory";
import { CataloguePanel } from "@/features/products/CataloguePanel";
import { getTransfers } from "@/lib/supabase/queries/transfers";
import { TransfersPanel } from "@/features/transfers/TransfersPanel";
import { getRecipes } from "@/lib/supabase/queries/recipes";
import { RecipesPanel } from "@/features/recipes/RecipesPanel";

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string; archived?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "transfers" ? "transfers" : sp.tab === "recipes" ? "recipes" : "catalogue";
  const showArchived = sp.archived === "1";
  const rows = tab === "catalogue" ? await getInventory(showArchived) : [];
  const transferData = tab === "transfers" ? await getTransfers() : null;
  const recipeData = tab === "recipes" ? await getRecipes() : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex gap-1.5">
        <Link href="/products" className={tabCls(tab === "catalogue")}>Catalogue</Link>
        <Link href="/products?tab=transfers" className={tabCls(tab === "transfers")}>Transfers</Link>
        <Link href="/products?tab=recipes" className={tabCls(tab === "recipes")}>Recipes</Link>
      </div>

      {tab === "catalogue" && <CataloguePanel products={rows} showArchived={showArchived} />}
      {tab === "transfers" && transferData && <TransfersPanel transfers={transferData.transfers} refData={transferData.ref} />}
      {tab === "recipes" && recipeData && <RecipesPanel data={recipeData} />}
    </div>
  );
}
