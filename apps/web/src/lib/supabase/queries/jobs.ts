import { createClient } from "@/lib/supabase/server";

export const JOB_COLUMNS = [
  { status: "scheduled", label: "Scheduled", dot: "#8c96a1" },
  { status: "in_progress", label: "In progress", dot: "#2b8cff" },
  { status: "ready", label: "Ready", dot: "#0da77c" },
  { status: "delivered", label: "Delivered", dot: "#6a5cff" },
] as const;

export interface JobCardSummary {
  id: string;
  status: string;
  service: string | null;
  customer: string | null;
  vehicle: string | null;
  plate: string | null;
  technician: string | null;
  technicianInitials: string | null;
  running: boolean;
}

function initials(name: string | null): string | null {
  if (!name) return null;
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const p = clean.split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : clean.slice(0, 2)) || "?").toUpperCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameById(rows: any[], id: string | null, field = "display_name"): string | null {
  if (!id) return null;
  return rows.find((r) => r.id === id)?.[field] ?? null;
}

export async function getJobsBoard(): Promise<Record<string, JobCardSummary[]>> {
  const sb = await createClient();
  const [jobsRes, custRes, vehRes, usersRes, timerRes] = await Promise.all([
    sb.from("jobs").select("id, status, notes, customer_id, vehicle_id, technician_id, created_at").order("created_at", { ascending: false }),
    sb.from("customers").select("id, name"),
    sb.from("vehicles").select("id, make, model, plate"),
    sb.from("app_users").select("id, display_name"),
    sb.from("job_timers").select("job_id, stopped_at").is("stopped_at", null),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers = (custRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vehicles = (vehRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = (usersRes.data ?? []) as any[];
  const running = new Set(((timerRes.data ?? []) as { job_id: string }[]).map((t) => t.job_id));

  const board: Record<string, JobCardSummary[]> = {};
  for (const c of JOB_COLUMNS) board[c.status] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const j of (jobsRes.data ?? []) as any[]) {
    const v = vehicles.find((x) => x.id === j.vehicle_id);
    const tech = nameById(users, j.technician_id);
    const card: JobCardSummary = {
      id: j.id,
      status: j.status,
      service: j.notes,
      customer: nameById(customers, j.customer_id, "name"),
      vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") : null,
      plate: v?.plate ?? null,
      technician: tech ? tech.replace(/\s*\(.*\)\s*$/, "").trim() : null,
      technicianInitials: initials(tech),
      running: running.has(j.id),
    };
    (board[j.status] ?? (board[j.status] = [])).push(card);
  }
  return board;
}

export interface JobDetail {
  id: string;
  status: string;
  service: string | null;
  customer: string | null;
  vehicle: string | null;
  plate: string | null;
  technicianId: string | null;
  revision: number;
  checklist: { label: string; done: boolean }[];
  elapsedSeconds: number;
  running: boolean;
}

export interface JobRefData {
  technicians: { id: string; name: string }[];
  consumables: { id: string; name: string; unit: string }[];
}

export async function getJob(id: string): Promise<{ job: JobDetail; ref: JobRefData } | null> {
  const sb = await createClient();
  const { data: job } = await sb.from("jobs").select("*, customers(name), vehicles(make, model, plate)").eq("id", id).maybeSingle();
  if (!job) return null;

  const [timerRes, usersRes, prodRes] = await Promise.all([
    sb.from("job_timers").select("started_at, stopped_at").eq("job_id", id),
    sb.from("app_users").select("id, display_name, role").eq("is_active", true).in("role", ["technician", "manager", "owner"]),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
  ]);

  const now = Date.now();
  let elapsed = 0;
  let running = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (timerRes.data ?? []) as any[]) {
    const start = Date.parse(t.started_at);
    const end = t.stopped_at ? Date.parse(t.stopped_at) : now;
    if (!t.stopped_at) running = true;
    if (!Number.isNaN(start)) elapsed += Math.max(0, Math.floor((end - start) / 1000));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = job;
  return {
    job: {
      id: j.id,
      status: j.status,
      service: j.notes,
      customer: j.customers?.name ?? null,
      vehicle: j.vehicles ? [j.vehicles.make, j.vehicles.model].filter(Boolean).join(" ") : null,
      plate: j.vehicles?.plate ?? null,
      technicianId: j.technician_id,
      revision: 0,
      checklist: Array.isArray(j.checklist) ? j.checklist : [],
      elapsedSeconds: elapsed,
      running,
    },
    ref: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      technicians: ((usersRes.data ?? []) as any[]).map((u) => ({ id: u.id, name: u.display_name.replace(/\s*\(.*\)\s*$/, "").trim() })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      consumables: ((prodRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit })),
    },
  };
}

export interface IntakeRef {
  customers: { id: string; name: string }[];
  vehicles: { id: string; customerId: string; label: string }[];
  technicians: { id: string; name: string }[];
}

export async function getIntakeRef(): Promise<IntakeRef> {
  const sb = await createClient();
  const [custRes, vehRes, usersRes] = await Promise.all([
    sb.from("customers").select("id, name").order("name"),
    sb.from("vehicles").select("id, customer_id, make, model, plate"),
    sb.from("app_users").select("id, display_name, role").eq("is_active", true).in("role", ["technician", "manager", "owner"]),
  ]);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: ((custRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vehicles: ((vehRes.data ?? []) as any[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${[v.make, v.model].filter(Boolean).join(" ")} · ${v.plate}` })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    technicians: ((usersRes.data ?? []) as any[]).map((u) => ({ id: u.id, name: u.display_name.replace(/\s*\(.*\)\s*$/, "").trim() })),
  };
}
