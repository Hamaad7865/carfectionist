import { getSessionContext } from "@/lib/auth/session";
import { getTyreSaleRef } from "@/lib/supabase/queries/tyrecentre-sale";
import { NewSale } from "./new-sale/NewSale";

/** The tyre-centre New sale (DESIGN-SPEC §6.3), served at /sales/counter for that brand. */
export async function TyreNewSalePage() {
  const [data, ctx] = await Promise.all([getTyreSaleRef(), getSessionContext()]);
  // Pricing the catalogue is an owner/manager decision (the server action enforces it too).
  const canPrice = ctx?.role === "owner" || ctx?.role === "manager";
  return <NewSale data={data} canPrice={canPrice} shopLabel={data.companies[0]?.name ?? "Shop"} />;
}
