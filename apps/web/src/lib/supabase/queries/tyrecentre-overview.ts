import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { formatMUR, rupeesToCents } from "@/lib/money";
import { muDate } from "@/lib/mu-date";
import { lowStock, newEnquiries, outstandingTotals, type NotifItem } from "@/lib/supabase/queries/notifications";
import { muDayKeys } from "@/features/tyrecentre/dashboard-series";
import {
  bayRows,
  collectedToday,
  companyIndex,
  salesByCompany,
  todayByCompany,
  topSellers,
  type BayRow,
  type BayTab,
  type Collected,
  type OvCompany,
  type OvDoc,
  type OvJob,
  type OvJobBills,
  type OvLine,
  type SalesByCompany,
  type Seller,
  type TodayCompany,
} from "@/features/tyrecentre/overview-model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** 90 days shown, plus the 90 before them for "vs the period before". */
const SERIES_DAYS = 180;
const SALE_STATUSES = ["issued", "partly_paid", "paid"];

export interface NeedItem {
  key: string;
  /** Mono header: "MONEY OWED · 5 INVOICES". */
  kind: string;
  title: string;
  reason: string;
  action: { label: string; href: string; primary?: boolean };
  /** "12d", "now" — how old the oldest thing in it is. */
  age: string | null;
}

export interface TyreOverview {
  nowMs: number;
  companies: OvCompany[];
  sales: SalesByCompany | null;
  today: TodayCompany[] | null;
  collected: Collected | null;
  bays: Record<BayTab, BayRow[]> | null;
  owed: { cents: number; count: number; oldestDays: number | null } | null;
  needs: NeedItem[];
  top: { tyres: Seller[]; services: Seller[] } | null;
  /** When today's till was opened (HH:MM comes from this); null when the drawer is closed. */
  tillOpenedAt: string | null;
}

/** One source failing empties its own card, never the page (same rule as the bell). */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function companies(sb: SB): Promise<OvCompany[]> {
  const { data, error } = await sb
    .from("legal_entities")
    .select("id, legal_name, trading_name, is_default, vat_registered, sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: (r.trading_name ?? "").trim() || r.legal_name,
    isDefault: r.is_default === true,
    vatRegistered: r.vat_registered !== false,
  }));
}

async function salesDocs(sb: SB, since: string): Promise<OvDoc[]> {
  const rows = await fetchAllRows<Row>(() =>
    sb
      .from("documents")
      .select("id, doc_type, total_incl, vat_total, issued_at, legal_entity_id")
      .in("doc_type", ["invoice", "credit_note"])
      .in("status", SALE_STATUSES)
      .gte("issued_at", since),
  );
  return rows.map((d) => ({
    docType: d.doc_type,
    totalCents: rupeesToCents(Number(d.total_incl)),
    vatCents: rupeesToCents(Number(d.vat_total ?? 0)),
    issuedAt: d.issued_at,
    entityId: d.legal_entity_id ?? null,
  }));
}

async function paymentsToday(sb: SB, dayStart: string) {
  const rows = await fetchAllRows<Row>(() => sb.from("payments").select("id, method, amount, received_at").gte("received_at", dayStart));
  return rows.map((p) => ({ method: p.method as string, cents: rupeesToCents(Number(p.amount)), at: p.received_at as string }));
}

/** The board's jobs (not cancelled; delivered only when handed back today) with their car,
 *  technician, and what their bills say — companies on the lines, money still owed. */
async function bays(sb: SB, cos: OvCompany[], dayStart: string, nowMs: number) {
  const { data: jobsData, error } = await sb
    .from("jobs")
    .select("id, status, notes, vehicle_id, technician_id, created_at, scheduled_at, started_at, ready_at, delivered_at, paused_at")
    .in("status", ["scheduled", "in_progress", "ready", "delivered"])
    .or(`status.neq.delivered,delivered_at.gte.${dayStart}`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const jobs = (jobsData ?? []) as Row[];
  if (jobs.length === 0) return bayRows([], new Map(), nowMs);
  const ids = jobs.map((j) => j.id);
  const vehicleIds = [...new Set(jobs.map((j) => j.vehicle_id).filter(Boolean))];
  const techIds = [...new Set(jobs.map((j) => j.technician_id).filter(Boolean))];
  const [veh, users, docs] = await Promise.all([
    vehicleIds.length ? sb.from("vehicles").select("id, plate, model").in("id", vehicleIds) : { data: [] },
    techIds.length ? sb.from("app_users").select("id, display_name").in("id", techIds) : { data: [] },
    sb.from("documents").select("id, job_id, doc_type, status, total_incl, amount_paid").in("job_id", ids).in("doc_type", ["quote", "invoice"]).neq("status", "void"),
  ]);
  const docRows = (docs.data ?? []) as Row[];
  const lines = docRows.length
    ? await fetchAllRows<Row>(() => sb.from("document_lines").select("id, document_id, legal_entity_id").in("document_id", docRows.map((d) => d.id)))
    : [];
  const jobOfDoc = new Map(docRows.map((d) => [d.id, d.job_id]));
  const bills = new Map<string, OvJobBills>();
  const billsOf = (jobId: string) => {
    const b = bills.get(jobId) ?? { companies: [], balanceCents: 0 };
    bills.set(jobId, b);
    return b;
  };
  for (const l of lines) {
    const jobId = jobOfDoc.get(l.document_id);
    if (jobId) billsOf(jobId).companies.push(companyIndex(l.legal_entity_id ?? null, cos));
  }
  for (const d of docRows) {
    if (d.doc_type !== "invoice" || !["issued", "partly_paid"].includes(d.status)) continue;
    billsOf(d.job_id).balanceCents += Math.max(0, rupeesToCents(Number(d.total_incl)) - rupeesToCents(Number(d.amount_paid)));
  }
  const vehicles = new Map(((veh.data ?? []) as Row[]).map((v) => [v.id, v]));
  const names = new Map(((users.data ?? []) as Row[]).map((u) => [u.id, String(u.display_name ?? "").replace(/\s*\(.*\)\s*$/, "").trim()]));
  const ovJobs: OvJob[] = jobs.map((j) => {
    const v = j.vehicle_id ? vehicles.get(j.vehicle_id) : null;
    return {
      id: j.id,
      status: j.status,
      plate: v?.plate ?? null,
      model: v?.model ?? null,
      work: j.notes ?? null,
      technician: j.technician_id ? names.get(j.technician_id) || null : null,
      createdAt: j.created_at,
      scheduledAt: j.scheduled_at ?? null,
      startedAt: j.started_at ?? null,
      readyAt: j.ready_at ?? null,
      deliveredAt: j.delivered_at ?? null,
      pausedAt: j.paused_at ?? null,
    };
  });
  return bayRows(ovJobs, bills, nowMs);
}

/** Lines of this month's issued invoices — the same statuses as the sales figure. */
async function monthLines(sb: SB, monthStart: string): Promise<OvLine[]> {
  const rows = await fetchAllRows<Row>(() =>
    sb
      .from("document_lines")
      .select("id, title, qty, line_total_excl, line_vat, products(kind), documents!inner(doc_type, status, issued_at)")
      .eq("documents.doc_type", "invoice")
      .in("documents.status", SALE_STATUSES)
      .gte("documents.issued_at", monthStart),
  );
  return rows.map((l) => ({
    title: String(l.title ?? ""),
    qty: Number(l.qty),
    cents: rupeesToCents(Number(l.line_total_excl)) + rupeesToCents(Number(l.line_vat)),
    kind: l.products?.kind ?? null,
  }));
}

/** Open tills: today's (for "till open since") and any left open from an earlier day — the
 *  drawer the till gate refuses to work past (back_office_till's strict stale check). */
async function tills(sb: SB, today: string) {
  const { data, error } = await sb.from("cash_sessions").select("id, opened_at, trading_days(business_date)").eq("status", "open");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const dayOf = (s: Row) => s.trading_days?.business_date ?? muDate(s.opened_at);
  const current = rows.filter((s) => dayOf(s) === today).sort((a, b) => a.opened_at.localeCompare(b.opened_at))[0] ?? null;
  const stale = rows.filter((s) => dayOf(s) < today).sort((a, b) => dayOf(a).localeCompare(dayOf(b)))[0] ?? null;
  return { openedAt: current?.opened_at ?? null, staleDay: stale ? (dayOf(stale) as string) : null };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function needs(
  owed: TyreOverview["owed"],
  low: NotifItem | null,
  enquiries: NotifItem | null,
  staleDay: string | null,
  owedLine: string | null,
): NeedItem[] {
  const out: NeedItem[] = [];
  if (owed && owed.count > 0) {
    out.push({
      key: "owed",
      kind: `Money owed · ${owed.count} invoice${owed.count === 1 ? "" : "s"}`,
      title: owedLine ?? "Money waiting to be collected",
      reason: owed.oldestDays != null ? `The oldest has waited ${owed.oldestDays} day${owed.oldestDays === 1 ? "" : "s"}` : "Waiting to be collected",
      action: { label: "Collect", href: "/sales?status=issued", primary: true },
      age: owed.oldestDays != null ? `${owed.oldestDays}d` : null,
    });
  }
  if (low) out.push({ key: "low", kind: "Stock · shop floor", title: low.label, reason: low.detail, action: { label: "See low stock", href: low.href }, age: "now" });
  if (staleDay) {
    const name = DAY_NAMES[new Date(`${staleDay}T00:00:00Z`).getUTCDay()];
    out.push({
      key: "till",
      kind: `Till · ${name}`,
      title: `${name}'s till is still open`,
      reason: "Count and close it so today's sales land on today",
      action: { label: `Close ${name}'s till`, href: "/cash" },
      age: null,
    });
  }
  if (enquiries) out.push({ key: "enquiries", kind: "Enquiries", title: enquiries.label, reason: enquiries.detail, action: { label: "Reply", href: enquiries.href }, age: null });
  return out;
}

export async function getTyreOverview(nowMs = Date.now()): Promise<TyreOverview> {
  const sb = await createClient();
  const today = muDate(new Date(nowMs).toISOString());
  const dayStart = new Date(`${today}T00:00:00+04:00`).toISOString();
  const days = muDayKeys(nowMs, SERIES_DAYS);
  const since = new Date(`${days[0]}T00:00:00+04:00`).toISOString();
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+04:00`).toISOString();

  const cos = await safe(companies(sb), [] as OvCompany[]);
  const list = cos.length ? cos : [{ id: "", name: "Sales", isDefault: true, vatRegistered: true }];

  const [docs, pays, bayData, lines, owedTotals, low, enquiries, till] = await Promise.all([
    safe(salesDocs(sb, since), null),
    safe(paymentsToday(sb, dayStart), null),
    safe(bays(sb, list, dayStart, nowMs), null),
    safe(monthLines(sb, monthStart), null),
    safe(outstandingTotals(sb, today), null),
    lowStock(sb),
    newEnquiries(sb),
    safe(tills(sb, today), { openedAt: null, staleDay: null }),
  ]);

  const owed = owedTotals
    ? { cents: owedTotals.cents, count: owedTotals.count, oldestDays: owedTotals.oldestIssuedAt ? Math.floor((nowMs - Date.parse(owedTotals.oldestIssuedAt)) / 86_400_000) : null }
    : null;
  const owedLine = owedTotals && owedTotals.count > 0 ? `${formatMUR(owedTotals.cents)} waiting to be collected` : null;

  return {
    nowMs,
    companies: list,
    sales: docs ? salesByCompany(days, docs, list) : null,
    today: docs ? todayByCompany(docs, list, nowMs) : null,
    collected: pays ? collectedToday(pays, nowMs) : null,
    bays: bayData,
    owed,
    needs: needs(owed, low, enquiries, till.staleDay, owedLine),
    top: lines ? topSellers(lines) : null,
    tillOpenedAt: till.openedAt,
  };
}

