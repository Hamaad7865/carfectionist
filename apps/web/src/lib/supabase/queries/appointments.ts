import { fetchAllResult } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { departmentLabel } from "@/lib/departments";
import { getSessionContext } from "@/lib/auth/session";
import { isTyreShop } from "@/lib/auth/roles";
import {
  appointmentDisplayNotes,
  missingAppointmentAlignmentColumns,
  parseAppointmentAlignment,
} from "@/lib/appointments/alignment";

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
  alignedOn: string | null;
  alignedAtKm: number | null;
  nextAtKm: number | null;
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
  workPlaces: { id: string; name: string }[];
  isTyreShop: boolean;
}

async function fetchAppointmentRows(
  sb: Awaited<ReturnType<typeof createClient>>,
): Promise<unknown[]> {
  const columns =
    "id, service, department, scheduled_at, duration_minutes, status, notes, job_id, " +
    "aligned_on, aligned_at_km, next_at_km, customers(name), vehicles(plate, make, model), " +
    "app_users!appointments_technician_id_fkey(display_name)";
  const extended = await sb
    .from("appointments")
    .select(columns)
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (!extended.error) return extended.data ?? [];
  if (!missingAppointmentAlignmentColumns(extended.error)) {
    throw new Error(extended.error.message);
  }
  const legacy = await sb
    .from("appointments")
    .select("id, service, department, scheduled_at, duration_minutes, status, notes, job_id, customers(name), vehicles(plate, make, model), app_users!appointments_technician_id_fkey(display_name)")
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data ?? [];
}

export async function getAppointments(nowISO: string): Promise<AppointmentsData> {
  const sb = await createClient();
  const session = await getSessionContext();
  const tyreShop = session ? isTyreShop(session.tenantId) : false;
  const [appointmentsRaw, custRes, vehRes, techRes, placesRes] = await Promise.all([
    fetchAppointmentRows(sb),
    fetchAllResult(() => sb.from("customers").select("id, name").order("name")),
    fetchAllResult(() => sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate")),
    sb.from("app_users").select("id, display_name, role").eq("is_active", true).in("role", ["technician", "manager", "owner"]),
    sb.from("work_places").select("id, name").order("sort_order").order("name"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const appointments: AppointmentRow[] = appointmentsRaw.map((a: any) => {
    const marker = parseAppointmentAlignment(a.notes);
    return {
      id: a.id,
      customerName: a.customers?.name ?? "—",
      vehicle: [a.vehicles?.plate, [a.vehicles?.make, a.vehicles?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—",
      service: a.service,
      department: departmentLabel(a.department),
      technician: a.app_users?.display_name ? a.app_users.display_name.replace(/\s*\(.*\)\s*$/, "").trim() : null,
      scheduledAt: a.scheduled_at,
      status: a.status,
      notes: appointmentDisplayNotes(a.notes),
      jobId: a.job_id,
      alignedOn: a.aligned_on ?? marker.alignedOn,
      alignedAtKm: a.aligned_at_km ?? marker.alignedAtKm,
      nextAtKm: a.next_at_km ?? marker.nextAtKm,
      overdue: new Date(a.scheduled_at).getTime() < new Date(nowISO).getTime() && ["scheduled", "confirmed"].includes(a.status),
    };
  });

  const vehByCust = new Map<string, { id: string; label: string }[]>();
  for (const v of (vehRes.data ?? []) as any[]) {
    const label = [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const list = vehByCust.get(v.customer_id) ?? [];
    list.push({ id: v.id, label });
    vehByCust.set(v.customer_id, list);
  }
  const customers: AptRefCustomer[] = ((custRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, vehicles: vehByCust.get(c.id) ?? [] }));
  const technicians = ((techRes.data ?? []) as any[]).map((u) => ({ id: u.id, name: u.display_name.replace(/\s*\(.*\)\s*$/, "").trim() }));
  const workPlaces = ((placesRes.data ?? []) as any[]).map((place) => ({ id: place.id, name: place.name }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { appointments, customers, technicians, workPlaces, isTyreShop: tyreShop };
}
