import type { SalesJournalFilters } from "@/lib/supabase/queries/sales-journal";
import { muToday } from "@/lib/mu-date";
import { COMPARISONS, type CompareKey, type Range } from "./periods";

// The URL is the report's only state. Parsed in one place so the screen and the
// PDF endpoint can never read the same link differently.

export interface JournalParams {
  range: Range;
  compare: CompareKey;
  filters: SalesJournalFilters;
}

export interface RawParams {
  from?: string;
  to?: string;
  cmp?: string;
  dev?: string;
  svc?: string;
  usr?: string;
  t0?: string;
  t1?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export function parseParams(sp: RawParams, today = muToday()): JournalParams {
  // A journal with no dates is today's journal — Cashmag's landing state.
  const from = sp.from && DAY.test(sp.from) ? sp.from : today;
  const to = sp.to && DAY.test(sp.to) ? sp.to : from;
  // A backwards range is a typo, not a query: read it in the order that works.
  const range: Range = from <= to ? { from, to } : { from: to, to: from };

  const compare = (COMPARISONS.some((c) => c.key === sp.cmp) ? sp.cmp : "none") as CompareKey;

  return {
    range,
    compare,
    filters: {
      device: sp.dev || undefined,
      service: sp.svc || undefined,
      user: sp.usr || undefined,
      timeFrom: sp.t0 && TIME.test(sp.t0) ? sp.t0 : undefined,
      timeTo: sp.t1 && TIME.test(sp.t1) ? sp.t1 : undefined,
    },
  };
}

/** The dialog's form shape, which uses "" rather than undefined for "no filter". */
export function toFilterState(f: SalesJournalFilters) {
  return {
    device: f.device ?? "",
    service: f.service ?? "",
    user: f.user ?? "",
    timeFrom: f.timeFrom ?? "",
    timeTo: f.timeTo ?? "",
  };
}

/** Rebuild the query string — used for the PDF link, which must carry the view. */
export function toQuery(p: JournalParams): string {
  const q = new URLSearchParams({ from: p.range.from, to: p.range.to });
  if (p.compare !== "none") q.set("cmp", p.compare);
  if (p.filters.device) q.set("dev", p.filters.device);
  if (p.filters.service) q.set("svc", p.filters.service);
  if (p.filters.user) q.set("usr", p.filters.user);
  if (p.filters.timeFrom) q.set("t0", p.filters.timeFrom);
  if (p.filters.timeTo) q.set("t1", p.filters.timeTo);
  return q.toString();
}
