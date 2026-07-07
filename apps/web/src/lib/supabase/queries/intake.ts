import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { fetchAllRows } from "@/lib/supabase/paginate";

export interface IntakeVehicle {
  id: string;
  plate: string;
  label: string; // "make model"
}
export interface IntakeCustomer {
  id: string;
  name: string;
  phone: string | null;
  vehicles: IntakeVehicle[];
}

export async function getIntakeData(): Promise<{ tenantId: string; customers: IntakeCustomer[] }> {
  const ctx = await getSessionContext();
  const sb = await createClient();
  const [custData, vehData] = await Promise.all([
    fetchAllRows(() => sb.from("customers").select("id, name, phone").order("name")),
    fetchAllRows(() => sb.from("vehicles").select("id, customer_id, plate, make, model")),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCust = new Map<string, IntakeVehicle[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of vehData as any[]) {
    const list = byCust.get(v.customer_id) ?? [];
    list.push({ id: v.id, plate: v.plate, label: [v.make, v.model].filter(Boolean).join(" ") || "Vehicle" });
    byCust.set(v.customer_id, list);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers: IntakeCustomer[] = (custData as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    vehicles: byCust.get(c.id) ?? [],
  }));

  return { tenantId: ctx?.tenantId ?? "", customers };
}
