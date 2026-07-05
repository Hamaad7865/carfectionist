import { createClient } from "@/lib/supabase/server";
import { departmentLabel } from "@/lib/departments";

export interface AppointmentRow {
  id: string;
  customerName: string;
  vehicle: string;
  service: string | null;
  department: string | null;
  technician: string | null;
  scheduledAt: string;
  status: string;
  notes: string | null;
  jobId: string | null;
  overdue: boolean;
}
export interface AptRefCustomer {
  id: string;
  name: string;
  vehicles: { id: string; label: string }[];
}
export interface AppointmentsData {
  appointments: AppointmentRow[];
  customers: AptRefCustomer[];
  technicians: { id: string; name: string }[];
}

export async function getAppointments(nowISO: string): Promise<AppointmentsData> {
  const sb = await createClient();
  const [aptRes, custRes, vehRes, techRes] = await Promise.all([
    sb
      .from("appointments")
      .select("id, service, department, scheduled_at, status, notes, job_id, customers(name), vehicles(plate, make, model), app_users!appointments_technician_id_fkey(display_name)")
      .order("scheduled_at", { ascending: true })
      .limit(200),
    sb.from("customers").select("id, name").order("name"),
    sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate"),
    sb.from("app_users").select("id, display_name, role").eq("is_active", true).in("role", ["technician", "manager", "owner"]),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const appointments: AppointmentRow[] = ((aptRes.data ?? []) as any[]).map((a) => ({
    id: a.id,
    customerName: a.customers?.name ?? "—",
    vehicle: [a.vehicles?.plate, [a.vehicles?.make, a.vehicles?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—",
    service: a.service,
    department: departmentLabel(a.department),
    technician: a.app_users?.display_name ? a.app_users.display_name.replace(/\s*\(.*\)\s*$/, "").trim() : null,
    scheduledAt: a.scheduled_at,
    status: a.status,
    notes: a.notes,
    jobId: a.job_id,
    overdue: a.scheduled_at < nowISO && ["scheduled", "confirmed"].includes(a.status),
  }));

  const vehByCust = new Map<string, { id: string; label: string }[]>();
  for (const v of (vehRes.data ?? []) as any[]) {
    const label = [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const list = vehByCust.get(v.customer_id) ?? [];
    list.push({ id: v.id, label });
    vehByCust.set(v.customer_id, list);
  }
  const customers: AptRefCustomer[] = ((custRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, vehicles: vehByCust.get(c.id) ?? [] }));
  const technicians = ((techRes.data ?? []) as any[]).map((u) => ({ id: u.id, name: u.display_name.replace(/\s*\(.*\)\s*$/, "").trim() }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { appointments, customers, technicians };
}
