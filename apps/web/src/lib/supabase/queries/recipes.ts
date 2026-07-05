import { createClient } from "@/lib/supabase/server";

export interface RecipeComponent {
  id: string;
  componentProductId: string;
  name: string;
  unit: string;
  expectedQty: number;
}
export interface RecipeService {
  serviceProductId: string;
  serviceName: string;
  components: RecipeComponent[];
}
export interface RecipesData {
  services: { id: string; name: string }[];
  components: { id: string; name: string; unit: string }[];
  recipes: RecipeService[];
}

export async function getRecipes(): Promise<RecipesData> {
  const sb = await createClient();
  const [svcRes, compRes, recRes] = await Promise.all([
    sb.from("products").select("id, name").eq("kind", "service").eq("is_active", true).order("name"),
    sb.from("products").select("id, name, unit").in("kind", ["consumable", "product"]).eq("is_active", true).order("name"),
    sb.from("service_recipes").select("id, service_product_id, component_product_id, expected_qty, products!service_recipes_component_product_id_fkey(name, unit)"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const services = ((svcRes.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name }));
  const components = ((compRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, unit: c.unit }));

  const byService = new Map<string, RecipeComponent[]>();
  for (const r of (recRes.data ?? []) as any[]) {
    const list = byService.get(r.service_product_id) ?? [];
    list.push({
      id: r.id,
      componentProductId: r.component_product_id,
      name: r.products?.name ?? "—",
      unit: r.products?.unit ?? "",
      expectedQty: Number(r.expected_qty),
    });
    byService.set(r.service_product_id, list);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const recipes: RecipeService[] = services
    .filter((s) => byService.has(s.id))
    .map((s) => ({
      serviceProductId: s.id,
      serviceName: s.name,
      components: (byService.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return { services, components, recipes };
}
