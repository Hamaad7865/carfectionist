import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { departmentLabel } from "@/lib/departments";
import { signVehiclePhotos } from "@/lib/supabase/storage";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { jobClock } from "@/features/jobs/clock";
import { JOB_COLUMNS as COLUMNS } from "@/features/jobs/columns";
import { pickDoc, pickQuote, liveInvoices, outstandingCents, toJobDoc, type JobDoc, type RawDoc } from "@/features/jobs/job-docs";
import type { Marker } from "@/features/intake/damage";

// Lives in features/jobs/columns so client components can read it without
// importing this server-only module. Re-exported here for existing callers.
export { JOB_COLUMNS } from "@/features/jobs/columns";

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
    sb.from("jobs").select("id, status, notes, customer_id, vehicle_id, technician_id, department, created_at, started_at, ready_at, delivered_at, board_dismissed_at, paused_at, paused_ms").order("created_at", { ascending: false }),
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
  for (const c of COLUMNS) board[c.status] = [];
  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const j of (jobsRes.data ?? []) as any[]) {
    // A delivered card leaves the board two ways: swiped away by staff (on either app),
    // or aged off 48h after the handover. The job row itself is permanent — its history
    // lives in Sales/Reports.
    if (j.status === "delivered") {
      if (j.board_dismissed_at) continue;
      if (j.delivered_at && now - Date.parse(j.delivered_at) >= 48 * 3600_000) continue;
    }
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

// ── The searchable jobs list (second tab) ────────────────────────────────────
// Every job ever, with the quote it came from and the invoice it was billed on —
// this is where you find the car from three months ago, so it deliberately does
// NOT inherit the board's "delivered cards leave after 48h / when swiped" rules.

export interface JobListRow extends JobCardSummary {
  createdAt: string;
  phone: string | null;
  quote: JobDoc | null;
  invoice: JobDoc | null;
  invoiceCount: number; // live invoices — >1 means the row shows only the latest
  outstandingCents: number; // across ALL live invoices, not just the one shown
  // Every document number on the job — the two on the card, plus revised quotes and
  // reissued invoices. Search reads these; the card still shows only the two.
  docNumbers: string[];
}

const DOC_COLS = "id, job_id, doc_type, status, number, total_incl, amount_paid, source_document_id, created_at";

const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function listJobs(): Promise<JobListRow[]> {
  const sb = await createClient();

  // Flat reads joined in memory — the same shape as getJobsBoard above, and
  // deliberately no PostgREST embeds: jobs↔documents has two FKs and documents↔
  // documents is self-referencing, and a mis-hinted embed 400s the WHOLE query,
  // which renders as a silently empty list rather than an error.
  // fetchAllRows pages past PostgREST's 1000-row cap — a "find any job" feature
  // that quietly stops at row 1000 is worse than no feature.
  const [jobs, customers, vehicles, users, timers, linkedDocs] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() =>
      sb.from("jobs").select("id, status, notes, customer_id, vehicle_id, technician_id, department, created_at, started_at, ready_at, delivered_at, paused_at, paused_ms, source_quote_id"),
    ),
    fetchAllRows<{ id: string; name: string | null; phone: string | null }>(() => sb.from("customers").select("id, name, phone")),
    fetchAllRows<{ id: string; make: string | null; model: string | null; plate: string | null }>(() => sb.from("vehicles").select("id, make, model, plate")),
    fetchAllRows<{ id: string; display_name: string | null }>(() => sb.from("app_users").select("id, display_name")),
    fetchAllRows<{ id: string; job_id: string }>(() => sb.from("job_timers").select("id, job_id, stopped_at").is("stopped_at", null)),
    // Only documents that carry a job link. This picks up the quote as well as the
    // invoice: convert_quote_to_job stamps job_id on the QUOTE too (and credit notes
    // carry it as well) — which is exactly why the doc_type filter below matters.
    fetchAllRows<RawDoc & { job_id: string; source_document_id: string | null }>(() =>
      sb.from("documents").select(DOC_COLS).not("job_id", "is", null),
    ),
  ]);

  // Group the documents onto their job. Adding is idempotent by document id: the same
  // invoice reaching a job twice (from two of the passes below, or a paging hiccup) would
  // silently DOUBLE what the customer appears to owe, and money must never be counted
  // twice because of how it was fetched.
  const byJob = new Map<string, Map<string, RawDoc>>();
  const add = (jobId: string, d: RawDoc) => {
    const docs = byJob.get(jobId);
    if (docs) docs.set(d.id, d);
    else byJob.set(jobId, new Map([[d.id, d]]));
  };
  const docsOf = (jobId: string): RawDoc[] => [...(byJob.get(jobId)?.values() ?? [])];

  for (const d of linkedDocs) add(d.job_id, d);

  // A job's source quote is normally among the linked docs (convert_quote_to_job stamps
  // job_id on it). An older job's quote may not be — fetch the stragglers by id so the
  // row never shows "No quote" for a job that plainly came from one.
  const jobOfSourceQuote = new Map<string, string>();
  for (const raw of jobs) {
    const sq = raw.source_quote_id as string | null;
    if (sq) jobOfSourceQuote.set(sq, raw.id as string);
  }
  const known = new Set(linkedDocs.map((d) => d.id));
  const missingQuoteIds = [...jobOfSourceQuote.keys()].filter((id) => !known.has(id));

  // .in() with hundreds of uuids builds a multi-KB URL; chunk it so these never trip the
  // request-line limit once the shop has years of history.
  const quoteIds = [...new Set([...linkedDocs.filter((d) => d.doc_type === "quote").map((d) => d.id), ...missingQuoteIds])];
  const [missingQuotePages, orphanPages] = await Promise.all([
    Promise.all(chunk(missingQuoteIds, 100).map((ids) => sb.from("documents").select(DOC_COLS).in("id", ids))),
    // An invoice raised from a quote BEFORE the job existed has job_id = null; it links
    // back only through source_document_id → the quote. Without this pass the row claims
    // "not invoiced" on a job that has been billed.
    Promise.all(
      chunk(quoteIds, 100).map((ids) =>
        sb.from("documents").select(DOC_COLS).eq("doc_type", "invoice").is("job_id", null).in("source_document_id", ids),
      ),
    ),
  ]);

  const rowsOf = (pages: { data: unknown; error: { message: string } | null }[]) =>
    pages.flatMap((r) => {
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as (RawDoc & { source_document_id: string | null })[];
    });

  for (const d of rowsOf(missingQuotePages)) {
    const jobId = jobOfSourceQuote.get(d.id);
    if (jobId) add(jobId, d);
  }

  // Which job each quote belongs to — used to route an orphan invoice back to its job.
  const jobOfQuote = new Map<string, string>(jobOfSourceQuote);
  for (const d of linkedDocs) if (d.doc_type === "quote") jobOfQuote.set(d.id, d.job_id);
  for (const d of rowsOf(orphanPages)) {
    const jobId = d.source_document_id ? jobOfQuote.get(d.source_document_id) : undefined;
    if (jobId) add(jobId, d);
  }

  const running = new Set(timers.map((t) => t.job_id));
  const now = Date.now();

  // Index by id — a .find() per job is quadratic, and this list is every job the
  // shop has ever done.
  const customerOf = new Map(customers.map((c) => [c.id, c]));
  const vehicleOf = new Map(vehicles.map((v) => [v.id, v]));
  const techOf = new Map(users.map((u) => [u.id, u.display_name]));

  const rows = jobs.map((raw) => {
    const j = raw as Record<string, string | null>;
    const id = j.id as string;
    const v = j.vehicle_id ? vehicleOf.get(j.vehicle_id) : undefined;
    const cust = j.customer_id ? customerOf.get(j.customer_id) : undefined;
    const tech = (j.technician_id ? techOf.get(j.technician_id) : null) ?? null;
    const docs = docsOf(id);
    const quoteRaw = pickQuote(docs, (j.source_quote_id as string | null) ?? null);
    const invoiceRaw = pickDoc(docs, "invoice");
    const clock = jobClock(
      { status: j.status as string, startedAt: j.started_at, readyAt: j.ready_at, deliveredAt: j.delivered_at, pausedAt: j.paused_at, pausedMs: Number(raw.paused_ms ?? 0) },
      now,
    );
    return {
      id,
      status: j.status as string,
      service: j.notes,
      customer: cust?.name ?? null,
      phone: cust?.phone ?? null,
      vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") || null : null,
      plate: v?.plate ?? null,
      technician: tech ? tech.replace(/\s*\(.*\)\s*$/, "").trim() : null,
      technicianInitials: initials(tech),
      department: departmentLabel(j.department),
      running: clock ? clock.running : running.has(id),
      paused: clock?.paused ?? false,
      createdAt: (j.created_at as string) ?? "",
      quote: quoteRaw ? toJobDoc(quoteRaw) : null,
      invoice: invoiceRaw ? toJobDoc(invoiceRaw) : null,
      invoiceCount: liveInvoices(docs).length,
      outstandingCents: outstandingCents(docs),
      docNumbers: docs.map((d) => d.number).filter((n): n is string => !!n),
    } satisfies JobListRow;
  });

  // fetchAllRows pages by id for stable paging — order for display here.
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
  // The timeline. Raw ISO so the card can recompute the estimated finish on every
  // tick — a paused job's ETA slides, and a value frozen on the server would lie.
  createdAt: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  pausedAt: string | null;
  pausedMs: number;
  estimatedMinutes: number | null;
  /** Born of an accepted quote — so "Accepted" is the honest label, not "Opened". */
  fromQuote: boolean;
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
      createdAt: j.created_at ?? null,
      scheduledAt: j.scheduled_at ?? null,
      startedAt: j.started_at ?? null,
      readyAt: j.ready_at ?? null,
      deliveredAt: j.delivered_at ?? null,
      pausedAt: j.paused_at ?? null,
      pausedMs: Number(j.paused_ms ?? 0),
      estimatedMinutes: j.estimated_minutes ?? null,
      fromQuote: j.source_quote_id != null,
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
