import type { DailySummary, DailySummaryRow } from "@/lib/supabase/queries/daily-summary";
import type { Cell } from "@/lib/xlsx";

// Section definitions shared by the on-screen table and the Excel export, so the
// two can never drift apart. No JSX here on purpose — the export route imports
// this and must not pull React into its bundle.

export const SECTIONS = [
  { key: "devices", label: "Sale methods" },
  { key: "payments", label: "Payments" },
  { key: "taxes", label: "Taxes" },
  { key: "sellers", label: "User logs" },
  { key: "services", label: "Services" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];
export const ALL_SECTIONS = SECTIONS.map((s) => s.key) as SectionKey[];

/** `sec` param → enabled sections. Absent means all; "none" means none. */
export function parseSections(sec?: string): Set<SectionKey> {
  if (sec === undefined) return new Set(ALL_SECTIONS);
  const picked = sec.split(",").filter((k): k is SectionKey => (ALL_SECTIONS as string[]).includes(k));
  return new Set(picked);
}

export interface ColumnDef {
  head: string;
  group: string;
  /** raw value — cents for money, count for tallies. The table formats it; Excel takes the number. */
  cents?: (r: DailySummaryRow) => number;
  count?: (r: DailySummaryRow) => number;
  text?: (r: DailySummaryRow) => string;
}

const BASE_GROUP = "Daily summary";

/** The column set for a summary — dynamic, mirroring Cashmag: a service only gets
 *  a column if it actually sold in the period. */
export function columnDefs(s: DailySummary, on: Set<SectionKey>): ColumnDef[] {
  const cols: ColumnDef[] = [
    { group: BASE_GROUP, head: "Date", text: (r) => r.day },
    { group: BASE_GROUP, head: "Tickets", count: (r) => r.tickets },
    { group: BASE_GROUP, head: "Avg ticket incl", cents: (r) => r.avgInclCents },
    { group: BASE_GROUP, head: "Avg ticket excl", cents: (r) => r.avgExclCents },
    { group: BASE_GROUP, head: "Total incl", cents: (r) => r.totalInclCents },
    { group: BASE_GROUP, head: "Total excl", cents: (r) => r.totalExclCents },
    { group: BASE_GROUP, head: "Turnover incl", cents: (r) => r.totalInclCents },
    { group: BASE_GROUP, head: "Clients", count: (r) => r.clients },
  ];
  if (on.has("devices")) {
    for (const d of s.devices) {
      cols.push({ group: "Sale methods", head: `${d} / Total incl`, cents: (r) => r.byDevice[d]?.cents ?? 0 });
      cols.push({ group: "Sale methods", head: `${d} / Tickets`, count: (r) => r.byDevice[d]?.n ?? 0 });
    }
  }
  if (on.has("payments")) {
    for (const m of s.methods) {
      const label = m.replace(/_/g, " ");
      cols.push({ group: "Payments", head: `${label} / Qty`, count: (r) => r.byMethod[m]?.n ?? 0 });
      cols.push({ group: "Payments", head: `${label} / Total`, cents: (r) => r.byMethod[m]?.cents ?? 0 });
    }
  }
  if (on.has("taxes")) {
    for (const t of s.taxes) {
      cols.push({ group: "Taxes", head: `${t} / Total incl`, cents: (r) => r.byTax[t]?.inclCents ?? 0 });
      cols.push({ group: "Taxes", head: `${t} / Total excl`, cents: (r) => r.byTax[t]?.exclCents ?? 0 });
      cols.push({ group: "Taxes", head: `${t} / Tax`, cents: (r) => r.byTax[t]?.taxCents ?? 0 });
    }
  }
  if (on.has("sellers")) {
    for (const u of s.sellers) {
      cols.push({ group: "User logs", head: `${u} / Total incl`, cents: (r) => r.bySeller[u]?.cents ?? 0 });
      cols.push({ group: "User logs", head: `${u} / Tickets`, count: (r) => r.bySeller[u]?.n ?? 0 });
    }
  }
  if (on.has("services")) {
    for (const sv of s.services) {
      cols.push({ group: "Services", head: `${sv} / Total incl`, cents: (r) => r.byService[sv]?.cents ?? 0 });
      cols.push({ group: "Services", head: `${sv} / Tickets`, count: (r) => r.byService[sv]?.n ?? 0 });
    }
  }
  return cols;
}

/** Group label → column span, for the first header row. */
export function groupSpans(cols: ColumnDef[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    if (last && last.label === c.group) last.span += 1;
    else out.push({ label: c.group, span: 1 });
  }
  return out;
}

/** The whole sheet: sparse group row, header row, a row per day, then totals —
 *  the same shape as Cashmag's export. Money goes out as real numbers (rupees). */
export function toExportRows(s: DailySummary, on: Set<SectionKey>): Cell[][] {
  const cols = columnDefs(s, on);
  const rows: Cell[][] = [];

  // row 1 — group labels at the first column of each span, blanks between
  const groupRow: Cell[] = [];
  let at = 0;
  for (const g of groupSpans(cols)) {
    groupRow[at] = g.label;
    for (let i = 1; i < g.span; i++) groupRow[at + i] = null;
    at += g.span;
  }
  rows.push(groupRow);

  // row 2 — column names
  rows.push(cols.map((c) => c.head));

  const line = (r: DailySummaryRow, dateOverride?: string): Cell[] =>
    cols.map((c, i) => {
      if (i === 0 && dateOverride !== undefined) return dateOverride;
      if (c.text) return c.text(r);
      if (c.cents) return Number((c.cents(r) / 100).toFixed(2)); // cents → rupees, as a number
      return c.count ? c.count(r) : null;
    });

  for (const r of s.rows) rows.push(line(r));
  rows.push(line(s.totals, "Total"));
  return rows;
}
