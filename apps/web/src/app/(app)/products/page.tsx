import Link from "next/link";
import { getInventory } from "@/lib/supabase/queries/inventory";
import { CataloguePanel } from "@/features/products/CataloguePanel";
import { getTransfers } from "@/lib/supabase/queries/transfers";
import { TransfersPanel } from "@/features/transfers/TransfersPanel";
import { getRecipes } from "@/lib/supabase/queries/recipes";
import { RecipesPanel } from "@/features/recipes/RecipesPanel";
import { getInventoryOps } from "@/lib/supabase/queries/movements";
import { InventoryPanel } from "@/features/inventory/InventoryPanel";
import { getCategoryStats } from "@/lib/supabase/queries/categories";
import { CategoriesPanel } from "@/features/products/CategoriesPanel";
import { getBusinessProfile } from "@/lib/supabase/queries/settings";
import { ImportExport } from "@/features/dataio/ImportExport";

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string; archived?: string }> }) {
  const sp = await searchParams;
  const tab =
    sp.tab === "transfers" ? "transfers" : sp.tab === "recipes" ? "recipes" : sp.tab === "inventory" ? "inventory" : sp.tab === "categories" ? "categories" : "catalogue";
  const showArchived = sp.archived === "1";
  const inventory = tab === "catalogue" ? await getInventory(showArchived) : null;
  const profile = tab === "catalogue" ? await getBusinessProfile() : null;
  const vatDefault = profile?.vatRate ?? 15;
  const pricesInclVat = profile?.pricesVatInclusive ?? false;
  const transferData = tab === "transfers" ? await getTransfers() : null;
  const recipeData = tab === "recipes" ? await getRecipes() : null;
  const invOps = tab === "inventory" ? await getInventoryOps() : null;
  const categoryData = tab === "categories" ? await getCategoryStats() : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0 [&>*]:shrink-0">
        <Link href="/products" className={tabCls(tab === "catalogue")}>Catalogue</Link>
        <Link href="/products?tab=inventory" className={tabCls(tab === "inventory")}>Inventory</Link>
        <Link href="/products?tab=categories" className={tabCls(tab === "categories")}>Categories</Link>
        <Link href="/products?tab=transfers" className={tabCls(tab === "transfers")}>Transfers</Link>
        <Link href="/products?tab=recipes" className={tabCls(tab === "recipes")}>Recipes</Link>
        <div className="flex-1" />
        {(tab === "catalogue" || tab === "inventory") && <ImportExport kind="products" />}
      </div>

      {tab === "catalogue" && inventory && (
        <CataloguePanel products={inventory.rows} locations={inventory.locations} showArchived={showArchived} vatDefault={vatDefault} pricesInclVat={pricesInclVat} />
      )}
      {tab === "inventory" && invOps && <InventoryPanel data={invOps} />}
      {tab === "categories" && categoryData && <CategoriesPanel data={categoryData} />}
      {tab === "transfers" && transferData && <TransfersPanel transfers={transferData.transfers} refData={transferData.ref} />}
      {tab === "recipes" && recipeData && <RecipesPanel data={recipeData} />}
    </div>
  );
}
