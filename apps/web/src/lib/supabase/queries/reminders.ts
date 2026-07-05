import { createClient } from "@/lib/supabase/server";

export interface ReminderRow {
  id: string;
  customerName: string;
  vehicle: string;
  kind: string;
  dueDate: string;
  status: string;
  notes: string | null;
  overdue: boolean;
}
export interface ReminderRefCustomer {
  id: string;
  name: string;
  vehicles: { id: string; label: string }[];
}
export interface RemindersData {
  reminders: ReminderRow[];
  customers: ReminderRefCustomer[];
}

export async function getReminders(todayISO: string): Promise<RemindersData> {
  const sb = await createClient();
  const [remRes, custRes, vehRes] = await Promise.all([
    sb
      .from("maintenance_reminders")
      .select("id, kind, due_date, status, notes, customers(name), vehicles(plate, make, model)")
      .order("due_date"),
    sb.from("customers").select("id, name").order("name"),
    sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const reminders: ReminderRow[] = ((remRes.data ?? []) as any[]).map((r) => ({
    id: r.id,
    customerName: r.customers?.name ?? "—",
    vehicle: [r.vehicles?.plate, [r.vehicles?.make, r.vehicles?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—",
    kind: r.kind,
    dueDate: r.due_date,
    status: r.status,
    notes: r.notes,
    overdue: r.status === "pending" && r.due_date < todayISO,
  }));

  const vehByCust = new Map<string, { id: string; label: string }[]>();
  for (const v of (vehRes.data ?? []) as any[]) {
    const label = [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const list = vehByCust.get(v.customer_id) ?? [];
    list.push({ id: v.id, label });
    vehByCust.set(v.customer_id, list);
  }
  const customers: ReminderRefCustomer[] = ((custRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    vehicles: vehByCust.get(c.id) ?? [],
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { reminders, customers };
}
