import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getStockLocations, pickSalesFloor } from "@/lib/supabase/locations";
import { isLow } from "@/lib/stock/low";
import { rupeesToCents } from "@/lib/money";
import {
  buildDotChart,
  muClock,
  muDayStartMs,
  muWeekday,
  overviewDateLine,
  overviewWindow,
  percentChange,
  type DotChart,
  type OverviewRange,
} from "@/features/tyrecentre/overview-model";

export interface CompanyTotal {
  name: string;
  vatRegistered: boolean;
  totalCents: number;
}

export interface BayRow {
  id: string;
  plate: string;
  /** Mono second line: "axio · 4 tyres + align". */
  summary: string;
  stepsDone: number;
  stepsTotal: number;
  status: "scheduled" | "in_progress" | "ready" | "delivered";
  paused: boolean;
  /** Has a quote or invoice — i.e. a company it bills to. */
  billed: boolean;
  scheduledAt: string | null;
  checkedInAt: string;
  deliveredAt: string | null;
}

export interface NeedsItem {
  key: string;
  header: string;
  age: string;
  title: string;
  reason: string;
  action: { label: string; href: string } | null;
}

export interface OverviewTip {
  text: string;
  emphasis: string;
  action: { label: string; href: string } | null;
}

export interface TyreOverview {
  range: OverviewRange;
  /** The instant this was read — screens compare against it, not their own clock. */
  nowMs: number;
  dateLine: string;
  tillOpenSince: string | null;
  companies: CompanyTotal[];
  totalCents: number;
  vatCents: number;
  change: number | null;
  compareLabel: string;
  chart: DotChart;
  tip: OverviewTip | null;
  bays: { active: BayRow[]; ready: BayRow[]; done: BayRow[] };
  needs: NeedsItem[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const SALE_TYPES = ["invoice", "credit_note"];
const SALE_STATUSES = ["issued", "partly_paid", "paid"];
const iso = (ms: number) => new Date(ms).toISOString();

/** "2m", "1h", "18h", "3d" — how long something has been waiting. */
export function ageLabel(fromMs: number, nowMs: number): string {
  const m = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Signed sale rows in a window: a credit note takes its total back off. */
async function salesIn(sb: SB, fromMs: number, toMs: number): Promise<Row[]> {
  return fetchAllRows(() =>
    sb
      .from("documents")
      .select("id, doc_type, total_incl, vat_total, issued_at")
      .in("doc_type", SALE_TYPES)
      .in("status", SALE_STATUSES)
      .gte("issued_at", iso(fromMs))
      .lt("issued_at", iso(toMs)),
  );
}

const sign = (d: Row) => (d.doc_type === "credit_note" ? -1 : 1);

async function bays(sb: SB, dayStartMs: number): Promise<TyreOverview["bays"]> {
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, status, notes, checklist, vehicle_id, scheduled_at, created_at, delivered_at, paused_at")
    .or(`status.in.(scheduled,in_progress,ready),and(status.eq.delivered,delivered_at.gte.${iso(dayStartMs)})`)
    .order("created_at", { ascending: true })
    .limit(200);
  const list: Row[] = jobs ?? [];
  const ids = list.map((j) => j.id);
  const vehicleIds = [...new Set(list.map((j) => j.vehicle_id).filter(Boolean))];
  const [veh, docs] = await Promise.all([
    vehicleIds.length ? sb.from("vehicles").select("id, plate, make, model").in("id", vehicleIds) : { data: [] },
    ids.length ? sb.from("documents").select("job_id").in("job_id", ids).neq("status", "void") : { data: [] },
  ]);
  const vehicles = new Map(((veh.data ?? []) as Row[]).map((v) => [v.id, v]));
  const billed = new Set(((docs.data ?? []) as Row[]).map((d) => d.job_id));

  const rows: BayRow[] = list.map((j) => {
    const v = vehicles.get(j.vehicle_id);
    const steps: { done?: boolean }[] = Array.isArray(j.checklist) ? j.checklist : [];
    const model = (v?.model || v?.make || "").toString().toLowerCase();
    return {
      id: j.id,
      plate: v?.plate ?? "—",
      summary: [model, (j.notes ?? "").toString().toLowerCase()].filter(Boolean).join(" · "),
      stepsDone: steps.filter((s) => s?.done).length,
      stepsTotal: steps.length,
      status: j.status,
      paused: !!j.paused_at,
      billed: billed.has(j.id),
      scheduledAt: j.scheduled_at,
      checkedInAt: j.created_at,
      deliveredAt: j.delivered_at,
    };
  });
  return {
    active: rows.filter((r) => r.status === "scheduled" || r.status === "in_progress"),
    ready: rows.filter((r) => r.status === "ready"),
    done: rows.filter((r) => r.status === "delivered"),
  };
}

/** A tip only when the ledger backs it: the low-stock line the shop sells most. */
async function lowStockTip(sb: SB, nowMs: number, canOrder: boolean): Promise<OverviewTip | null> {
  const floor = pickSalesFloor(await getStockLocations(sb));
  if (!floor) return null;
  const [prods, oh] = await Promise.all([
    fetchAllRows(() => sb.from("products").select("id, name, low_stock_threshold").eq("is_stocked", true).eq("is_active", true).not("low_stock_threshold", "is", null)),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
  ]);
  const shop = new Map<string, number>();
  const total = new Map<string, number>();
  for (const r of oh as Row[]) {
    total.set(r.product_id, (total.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
    if (r.location_id === floor.id) shop.set(r.product_id, (shop.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
  }
  const low = (prods as Row[]).filter((p) =>
    isLow({ isStocked: true, threshold: Number(p.low_stock_threshold), floorQty: shop.get(p.id) ?? 0, totalQty: total.get(p.id) ?? 0 }),
  );
  if (low.length === 0) return null;

  const since = iso(nowMs - 14 * 86_400_000);
  const lines: Row[] = await fetchAllRows(() =>
    sb
      .from("document_lines")
      .select("id, product_id, qty, documents!inner(doc_type, status, issued_at)")
      .in("product_id", low.slice(0, 200).map((p) => p.id))
      .eq("documents.doc_type", "invoice")
      .in("documents.status", SALE_STATUSES)
      .gte("documents.issued_at", since),
  );
  const sold = new Map<string, number>();
  for (const l of lines) sold.set(l.product_id, (sold.get(l.product_id) ?? 0) + Number(l.qty));
  const pick = [...low].sort(
    (a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || (shop.get(a.id) ?? 0) - (shop.get(b.id) ?? 0),
  )[0];
  const left = Math.max(0, shop.get(pick.id) ?? 0);
  const n = sold.get(pick.id) ?? 0;
  const fmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));
  return {
    emphasis: `${pick.name} is running low.`,
    text: `${fmt(left)} left at ${floor.name}${n > 0 ? `, ${fmt(n)} sold in the last 14 days` : ""}.`,
    action: canOrder ? { label: "Order more", href: "/purchases" } : null,
  };
}

async function needsYou(sb: SB, nowMs: number, dayStartMs: number, canTill: boolean, canPurchase: boolean): Promise<NeedsItem[]> {
  const items: NeedsItem[] = [];
  // A till left open from an earlier day: today's sales would be refused or land wrong.
  const { data: stale } = await sb
    .from("cash_sessions")
    .select("id, device_id, opened_at")
    .eq("status", "open")
    .lt("opened_at", iso(dayStartMs))
    .order("opened_at", { ascending: true });
  for (const s of (stale ?? []) as Row[]) {
    const opened = Date.parse(s.opened_at);
    const day = muWeekday(opened);
    const yesterday = muDayStartMs(opened) === dayStartMs - 86_400_000;
    items.push({
      key: `till-${s.id}`,
      header: `TILL · ${day.toUpperCase()}`,
      age: ageLabel(opened, nowMs),
      title: `${yesterday ? "Yesterday" : day}'s till is still open`,
      reason: "Close it so today's sales land on today.",
      action: canTill ? { label: `Close ${day}'s till`, href: "/point-of-sale" } : null,
    });
  }
  // A delivery that came in short: the order stays partly received until the rest arrives.
  if (canPurchase) {
    const { data: pos } = await sb
      .from("purchase_orders")
      .select("id, reference, updated_at, purchase_order_lines(qty_ordered, qty_received, products(name))")
      .eq("status", "partially_received")
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const po of (pos ?? []) as Row[]) {
      const short = ((po.purchase_order_lines ?? []) as Row[]).filter((l) => Number(l.qty_received) < Number(l.qty_ordered));
      if (short.length === 0) continue;
      const names = short.map((l) => l.products?.name).filter(Boolean) as string[];
      items.push({
        key: `po-${po.id}`,
        header: `STOCK · DELIVERY${po.reference ? ` · ${po.reference}` : ""}`,
        age: ageLabel(Date.parse(po.updated_at), nowMs),
        title: `Delivery short by ${short.length} item${short.length === 1 ? "" : "s"}`,
        reason: `${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""} missing`,
        action: { label: "Open purchases", href: "/purchases" },
      });
    }
  }
  return items;
}

export async function getTyreOverview(
  range: OverviewRange,
  access: { canTill: boolean; canPurchase: boolean },
  nowMs = Date.now(),
): Promise<TyreOverview> {
  const sb = await createClient();
  const win = overviewWindow(range, nowMs);
  const dayStart = muDayStartMs(nowMs);
  // Every source fails alone — one broken read must not blank the whole Overview.
  const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const [cur, prev, bs, booked, openTill, bayData, tip, needs] = await Promise.all([
    safe(salesIn(sb, win.startMs, win.endMs), [] as Row[]),
    safe(salesIn(sb, win.prevStartMs, win.prevEndMs), [] as Row[]),
    safe(sb.from("business_settings").select("legal_name, trading_name, vat_number").limit(1).maybeSingle(), { data: null } as Row),
    range === "today"
      ? safe(
          sb.from("appointments").select("scheduled_at").in("status", ["scheduled", "confirmed"]).gt("scheduled_at", iso(nowMs)).lt("scheduled_at", iso(dayStart + 86_400_000)),
          { data: [] } as Row,
        )
      : Promise.resolve({ data: [] } as Row),
    safe(sb.from("cash_sessions").select("opened_at").eq("status", "open").gte("opened_at", iso(dayStart)).order("opened_at").limit(1), { data: [] } as Row),
    safe(bays(sb, dayStart), { active: [], ready: [], done: [] }),
    safe(lowStockTip(sb, nowMs, access.canPurchase), null),
    safe(needsYou(sb, nowMs, dayStart, access.canTill, access.canPurchase), [] as NeedsItem[]),
  ]);

  const totalCents = cur.reduce((s: number, d: Row) => s + sign(d) * rupeesToCents(Number(d.total_incl)), 0);
  const vatCents = cur.reduce((s: number, d: Row) => s + sign(d) * rupeesToCents(Number(d.vat_total)), 0);
  const prevCents = prev.reduce((s: number, d: Row) => s + sign(d) * rupeesToCents(Number(d.total_incl)), 0);
  const s = bs?.data;
  // One company per tenant today; multi-company billing will split these by issuer.
  const companies: CompanyTotal[] = s
    ? [{ name: s.trading_name || s.legal_name, vatRegistered: !!(s.vat_number ?? "").trim(), totalCents }]
    : [];
  const chart = buildDotChart(
    range,
    win,
    cur.filter((d: Row) => d.doc_type === "invoice").map((d: Row) => ({ atMs: Date.parse(d.issued_at), companyIndex: 0 })),
    ((booked?.data ?? []) as Row[]).map((a) => Date.parse(a.scheduled_at)),
    nowMs,
  );
  const tillSince = (openTill?.data ?? [])[0]?.opened_at as string | undefined;

  return {
    range,
    nowMs,
    dateLine: overviewDateLine(nowMs),
    tillOpenSince: tillSince ? muClock(Date.parse(tillSince)) : null,
    companies,
    totalCents,
    vatCents,
    change: percentChange(totalCents, prevCents),
    compareLabel: win.compareLabel,
    chart,
    tip,
    bays: bayData,
    needs,
  };
}
