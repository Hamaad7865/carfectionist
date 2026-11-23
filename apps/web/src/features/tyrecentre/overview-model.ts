import { muDate, muDateTime } from "@/lib/mu-date";
import { formatTyreSize, parseTyreSize } from "@/lib/tyrecentre/tyre-size";
import { periodChange } from "./dashboard-series";

// The tyre-centre Overview's arithmetic, kept free of the database so every rule below is
// tested on fixtures (overview-model.test.ts). The query (tyrecentre-overview.ts) only fetches.

const DAY_MS = 86_400_000;

export interface OvCompany {
  id: string;
  name: string;
  vatRegistered: boolean;
  isDefault: boolean;
}

/** An issued invoice or credit note, in cents. */
export interface OvDoc {
  docType: "invoice" | "credit_note";
  totalCents: number;
  vatCents: number;
  issuedAt: string;
  entityId: string | null;
}

export interface OvPayment {
  method: string;
  cents: number;
  at: string;
}

/** Which company a row belongs to, as its position in `companies`. A row with no company — history
 *  from before companies existed, or a company since retired — is the default company's: the same
 *  rule the Z report and the sales journal use. */
export function companyIndex(entityId: string | null, companies: OvCompany[]): number {
  if (entityId) {
    const i = companies.findIndex((c) => c.id === entityId);
    if (i >= 0) return i;
  }
  const d = companies.findIndex((c) => c.isDefault);
  return d >= 0 ? d : 0;
}

const sign = (d: OvDoc) => (d.docType === "credit_note" ? -1 : 1);

export interface SalesByCompany {
  /** Mauritius days, oldest first. */
  days: string[];
  /** Sales incl. VAT per company per day: perCompany[company][day]. Credit notes count against. */
  perCompany: number[][];
  /** Output VAT per day (a non-VAT company's documents carry 0). */
  vat: number[];
}

export function salesByCompany(days: string[], docs: OvDoc[], companies: OvCompany[]): SalesByCompany {
  const index = new Map(days.map((k, i) => [k, i]));
  const perCompany = companies.map(() => new Array<number>(days.length).fill(0));
  const vat = new Array<number>(days.length).fill(0);
  for (const d of docs) {
    const i = index.get(muDate(d.issuedAt));
    if (i === undefined) continue;
    perCompany[companyIndex(d.entityId, companies)][i] += sign(d) * d.totalCents;
    vat[i] += sign(d) * d.vatCents;
  }
  return { days, perCompany, vat };
}

export interface PeriodSummary {
  days: string[];
  /** Per company, per day, for the chart's stacked bars. */
  perCompanyDaily: number[][];
  totalCents: number;
  perCompanyCents: number[];
  vatCents: number;
  /** Against the same number of days before (0.081 = +8.1%); null with nothing to compare. */
  change: number | null;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** The last `n` days of `s`. */
export function periodSummary(s: SalesByCompany, n: number): PeriodSummary {
  const totals = s.days.map((_, i) => sum(s.perCompany.map((c) => c[i])));
  const perCompanyDaily = s.perCompany.map((c) => c.slice(-n));
  return {
    days: s.days.slice(-n),
    perCompanyDaily,
    totalCents: sum(totals.slice(-n)),
    perCompanyCents: perCompanyDaily.map(sum),
    vatCents: sum(s.vat.slice(-n)),
    change: periodChange(totals, n),
  };
}

export interface TodayCompany {
  cents: number;
  invoices: number;
  /** Against the same weekday last week UP TO THE SAME TIME — a whole last Saturday against
   *  this morning would read as a fall every morning. */
  change: number | null;
}

export function todayByCompany(docs: OvDoc[], companies: OvCompany[], nowMs: number): TodayCompany[] {
  const today = muDate(new Date(nowMs).toISOString());
  const weekAgoMs = nowMs - 7 * DAY_MS;
  const weekAgo = muDate(new Date(weekAgoMs).toISOString());
  const out = companies.map(() => ({ cents: 0, invoices: 0, before: 0 }));
  for (const d of docs) {
    const at = Date.parse(d.issuedAt);
    const day = muDate(d.issuedAt);
    const c = out[companyIndex(d.entityId, companies)];
    if (day === today && at <= nowMs) {
      c.cents += sign(d) * d.totalCents;
      if (d.docType === "invoice") c.invoices += 1;
    } else if (day === weekAgo && at <= weekAgoMs) {
      c.before += sign(d) * d.totalCents;
    }
  }
  return out.map((c) => ({ cents: c.cents, invoices: c.invoices, change: c.before > 0 ? (c.cents - c.before) / c.before : null }));
}

export interface Collected {
  totalCents: number;
  /** Largest first; methods that net to nothing (a payment and its reversal) drop out. */
  byMethod: { method: string; cents: number }[];
}

/** Money taken today, by method. A reversal is a negative row and counts against its day. */
export function collectedToday(payments: OvPayment[], nowMs: number): Collected {
  const today = muDate(new Date(nowMs).toISOString());
  const by = new Map<string, number>();
  for (const p of payments) {
    if (muDate(p.at) !== today) continue;
    by.set(p.method, (by.get(p.method) ?? 0) + p.cents);
  }
  const byMethod = [...by.entries()].filter(([, c]) => c > 0).map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);
  return { totalCents: sum([...by.values()]), byMethod };
}

// ── Top sellers ────────────────────────────────────────────────────────────

/** A line of an issued invoice this month. */
export interface OvLine {
  title: string;
  qty: number;
  /** Incl. VAT. */
  cents: number;
  kind: string | null;
}

export interface Seller {
  label: string;
  qty: number;
  cents: number;
}

function rank(groups: Map<string, Seller>, limit: number): Seller[] {
  return [...groups.values()].sort((a, b) => b.cents - a.cents || b.qty - a.qty).slice(0, limit);
}

/** Tyres grouped by SIZE (the trade sells "a 195/65 R15", whatever the brand), services by name. */
export function topSellers(lines: OvLine[], limit = 4): { tyres: Seller[]; services: Seller[] } {
  const tyres = new Map<string, Seller>();
  const services = new Map<string, Seller>();
  for (const l of lines) {
    let map: Map<string, Seller>;
    let label: string;
    if (l.kind === "service") {
      map = services;
      label = l.title.trim();
    } else {
      const size = parseTyreSize(l.title);
      if (!size) continue;
      map = tyres;
      label = formatTyreSize(size);
    }
    const g = map.get(label) ?? { label, qty: 0, cents: 0 };
    g.qty += l.qty;
    g.cents += l.cents;
    map.set(label, g);
  }
  return { tyres: rank(tyres, limit), services: rank(services, limit) };
}

// ── In the bays ────────────────────────────────────────────────────────────

export interface OvJob {
  id: string;
  status: string;
  plate: string | null;
  model: string | null;
  work: string | null;
  technician: string | null;
  createdAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  pausedAt: string | null;
}

/** What a job's bills say: the companies with lines on its quote or invoices, and what is still owed. */
export interface OvJobBills {
  companies: number[];
  balanceCents: number;
}

export type BayTab = "onsite" | "booked" | "handed";
export type BayTone = "attention" | "outline" | "danger" | "neutral";

export interface BayRow {
  id: string;
  plate: string;
  detail: string;
  technician: string | null;
  /** 1 booked · 2 in progress · 3 ready · 4 handed back — the four job stages. */
  stage: 1 | 2 | 3 | 4;
  /** A paused job: its current stage shows red. */
  blocked: boolean;
  companies: number[];
  status: { label: string; tone: BayTone };
  /** Minutes on site (started → handed back or now); null for a car not yet in. */
  minutes: number | null;
}

const STAGE: Record<string, 1 | 2 | 3 | 4> = { scheduled: 1, in_progress: 2, ready: 3, delivered: 4 };
const clock = (iso: string) => muDateTime(iso).slice(11);

/** "38 min", "1 h 05", and whole days past a day ("3 d") — a car left on site for weeks. */
export function onSiteLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} d`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The job board as three tabs. On site = in progress or ready; booked = not started, due today or
 * earlier; handed back = delivered today. Ready jobs come first — they are money waiting — then the
 * longest on site.
 */
export function bayRows(jobs: OvJob[], bills: Map<string, OvJobBills>, nowMs: number): Record<BayTab, BayRow[]> {
  const today = muDate(new Date(nowMs).toISOString());
  const out: Record<BayTab, BayRow[]> = { onsite: [], booked: [], handed: [] };
  for (const j of jobs) {
    const stage = STAGE[j.status];
    if (!stage) continue;
    let tab: BayTab;
    if (j.status === "in_progress" || j.status === "ready") tab = "onsite";
    else if (j.status === "scheduled") {
      if (j.scheduledAt && muDate(j.scheduledAt) > today) continue;
      tab = "booked";
    } else {
      if (!j.deliveredAt || muDate(j.deliveredAt) !== today) continue;
      tab = "handed";
    }
    const b = bills.get(j.id) ?? { companies: [], balanceCents: 0 };
    const paused = j.status === "in_progress" && j.pausedAt != null;
    const status =
      j.status === "ready"
        ? b.balanceCents > 0
          ? { label: "Ready to pay", tone: "attention" as const }
          : { label: "Ready", tone: "outline" as const }
        : j.status === "in_progress"
          ? paused
            ? { label: "Paused", tone: "danger" as const }
            : { label: "In progress", tone: "outline" as const }
          : j.status === "scheduled"
            ? { label: j.scheduledAt ? `Booked ${clock(j.scheduledAt)}` : "Booked", tone: "neutral" as const }
            : { label: `Handed back ${clock(j.deliveredAt as string)}`, tone: "neutral" as const };
    const since = j.startedAt ?? (tab === "booked" ? null : j.createdAt);
    const until = j.deliveredAt ? Date.parse(j.deliveredAt) : nowMs;
    out[tab].push({
      id: j.id,
      plate: j.plate ?? "No plate",
      detail: [j.model?.toLowerCase(), j.work?.toLowerCase()].filter(Boolean).join(" · "),
      technician: j.technician,
      stage,
      blocked: paused,
      companies: [...new Set(b.companies)].sort((a, b2) => a - b2),
      status,
      minutes: since ? Math.max(0, Math.floor((until - Date.parse(since)) / 60_000)) : null,
    });
  }
  const order = (r: BayRow) => (r.status.tone === "attention" ? 0 : 1);
  out.onsite.sort((a, b) => order(a) - order(b) || (b.minutes ?? 0) - (a.minutes ?? 0));
  out.booked.sort((a, b) => a.status.label.localeCompare(b.status.label));
  return out;
}
