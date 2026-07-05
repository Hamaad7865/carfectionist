import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ContactVehicle {
  make: string;
  plate: string;
  color: string;
}
export interface ContactDoc {
  id: string;
  number: string | null;
  status: string;
  date: string;
  totalCents: number;
}
export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  vehicleCount: number;
  outstandingCents: number;
}
export interface CustomerDetail extends CustomerSummary {
  spendCents: number;
  vehicles: ContactVehicle[];
  history: ContactDoc[];
}
export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface ContactsData {
  customers: CustomerSummary[];
  selected: CustomerDetail | null;
  suppliers: SupplierRow[];
}

export async function getContacts(selectedId?: string): Promise<ContactsData> {
  const sb = await createClient();
  const [custRes, vehRes, docRes, supRes] = await Promise.all([
    sb.from("customers").select("id, name, phone, email").order("name"),
    sb.from("vehicles").select("id, customer_id, make, model, plate, color"),
    sb.from("documents").select("id, customer_id, doc_type, number, status, total_incl, amount_paid, issue_date, created_at"),
    sb.from("suppliers").select("id, name, phone, email").order("name"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vehicles = (vehRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (docRes.data ?? []) as any[];

  const outstandingByCust = new Map<string, number>();
  const spendByCust = new Map<string, number>();
  for (const d of docs) {
    if (!d.customer_id || d.doc_type !== "invoice") continue;
    if (["issued", "partly_paid", "paid"].includes(d.status)) {
      spendByCust.set(d.customer_id, (spendByCust.get(d.customer_id) ?? 0) + rupeesToCents(Number(d.total_incl)));
    }
    if (["issued", "partly_paid"].includes(d.status)) {
      outstandingByCust.set(d.customer_id, (outstandingByCust.get(d.customer_id) ?? 0) + rupeesToCents(Number(d.total_incl) - Number(d.amount_paid)));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers: CustomerSummary[] = ((custRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    vehicleCount: vehicles.filter((v) => v.customer_id === c.id).length,
    outstandingCents: outstandingByCust.get(c.id) ?? 0,
  }));

  const selId = selectedId && customers.some((c) => c.id === selectedId) ? selectedId : customers[0]?.id;
  let selected: CustomerDetail | null = null;
  if (selId) {
    const base = customers.find((c) => c.id === selId)!;
    selected = {
      ...base,
      spendCents: spendByCust.get(selId) ?? 0,
      vehicles: vehicles
        .filter((v) => v.customer_id === selId)
        .map((v) => ({ make: [v.make, v.model].filter(Boolean).join(" "), plate: v.plate, color: v.color ?? "" })),
      history: docs
        .filter((d) => d.customer_id === selId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((d) => ({
          id: d.id,
          number: d.number,
          status: d.status,
          date: d.issue_date ?? (d.created_at as string).slice(0, 10),
          totalCents: rupeesToCents(Number(d.total_incl)),
        })),
    };
  }

  return {
    customers,
    selected,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suppliers: ((supRes.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name, phone: s.phone, email: s.email })),
  };
}
