import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { departmentLabel } from "@/lib/departments";
import { signVehiclePhotos } from "@/lib/supabase/storage";
import { jobClock } from "@/features/jobs/clock";
import type { Marker } from "@/features/intake/damage";

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
  department: string | null;
  running: boolean;
  paused: boolean;
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
    sb.from("jobs").select("id, status, notes, customer_id, vehicle_id, technician_id, department, created_at, started_at, ready_at, delivered_at, paused_at, paused_ms").order("created_at", { ascending: false }),
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
  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const j of (jobsRes.data ?? []) as any[]) {
    const v = vehicles.find((x) => x.id === j.vehicle_id);
    const tech = nameById(users, j.technician_id);
    // The POS clock (started_at/paused) is authoritative when present; a job the
    // web only ever drove via timer rows falls back to its open-timer state.
    const clock = jobClock(
      { status: j.status, startedAt: j.started_at, readyAt: j.ready_at, deliveredAt: j.delivered_at, pausedAt: j.paused_at, pausedMs: j.paused_ms },
      now,
    );
    const card: JobCardSummary = {
      id: j.id,
      status: j.status,
      service: j.notes,
      customer: nameById(customers, j.customer_id, "name"),
      vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") : null,
      plate: v?.plate ?? null,
      technician: tech ? tech.replace(/\s*\(.*\)\s*$/, "").trim() : null,
      technicianInitials: initials(tech),
      department: departmentLabel(j.department),
      running: clock ? clock.running : running.has(j.id),
      paused: clock?.paused ?? false,
    };
    (board[j.status] ?? (board[j.status] = [])).push(card);
  }
  return board;
}

export interface JobDocument {
  id: string;
  docType: "quote" | "invoice" | "credit_note";
  status: string;
  number: string | null;
  totalCents: number;
  outstandingCents: number;
}

export interface JobPhoto {
  url: string;
  phase: string;
  caption: string | null;
}
export interface JobDetail {
  id: string;
  tenantId: string;
  status: string;
  service: string | null;
  customer: string | null;
  vehicle: string | null;
  plate: string | null;
  technicianId: string | null;
  department: string | null;
  revision: number;
  checklist: { label: string; done: boolean }[];
  damageMarkers: Marker[];
  photos: JobPhoto[];
  elapsedSeconds: number;
  running: boolean;
  paused: boolean;
  documents: JobDocument[];
}

export interface JobRefData {
  technicians: { id: string; name: string }[];
  consumables: { id: string; name: string; unit: string }[];
}

export async function getJob(id: string): Promise<{ job: JobDetail; ref: JobRefData } | null> {
  const sb = await createClient();
  const { data: job } = await sb.from("jobs").select("*, customers(name), vehicles(make, model, plate)").eq("id", id).maybeSingle();
  if (!job) return null;

  const [timerRes, usersRes, prodRes, docRes, photoRes] = await Promise.all([
    sb.from("job_timers").select("started_at, stopped_at").eq("job_id", id),
    sb.from("app_users").select("id, display_name, role").eq("is_active", true).in("role", ["technician", "manager", "owner"]),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    sb.from("documents").select("id, doc_type, status, number, total_incl, amount_paid").eq("job_id", id).order("created_at"),
    sb.from("job_photos").select("storage_path, phase, caption").eq("job_id", id).order("created_at"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPhotos = (photoRes.data ?? []) as any[];
  const signed = await signVehiclePhotos(sb, rawPhotos.map((p) => p.storage_path));
  const photos: JobPhoto[] = rawPhotos
    .filter((p) => signed[p.storage_path])
    .map((p) => ({ url: signed[p.storage_path], phase: p.phase, caption: p.caption ?? null }));

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
  // The POS clock (started_at → ready, minus pauses) overrides the legacy
  // timer-row sum whenever the job has been started — one clock on both apps.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jr: any = job;
  const clock = jobClock(
    { status: jr.status, startedAt: jr.started_at, readyAt: jr.ready_at, deliveredAt: jr.delivered_at, pausedAt: jr.paused_at, pausedMs: jr.paused_ms },
    now,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const documents: JobDocument[] = ((docRes.data ?? []) as any[]).map((d) => {
    const totalCents = rupeesToCents(Number(d.total_incl));
    const paidCents = rupeesToCents(Number(d.amount_paid));
    return {
      id: d.id,
      docType: d.doc_type,
      status: d.status,
      number: d.number,
      totalCents,
      // Only a live invoice is collectible — a void/paid one owes nothing.
      outstandingCents:
        d.doc_type === "invoice" && (d.status === "issued" || d.status === "partly_paid")
          ? Math.max(0, totalCents - paidCents)
          : 0,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = job;
  return {
    job: {
      id: j.id,
      tenantId: j.tenant_id,
      status: j.status,
      service: j.notes,
      customer: j.customers?.name ?? null,
      vehicle: j.vehicles ? [j.vehicles.make, j.vehicles.model].filter(Boolean).join(" ") : null,
      plate: j.vehicles?.plate ?? null,
      technicianId: j.technician_id,
      department: j.department ?? null,
      revision: 0,
      checklist: Array.isArray(j.checklist) ? j.checklist : [],
      damageMarkers: Array.isArray(j.damage_markers) ? j.damage_markers : [],
      photos,
      elapsedSeconds: clock?.elapsedSeconds ?? elapsed,
      running: clock?.running ?? running,
      paused: clock?.paused ?? false,
      documents,
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
