import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getStockLocations, pickSalesFloor } from "@/lib/supabase/locations";
import { isLow, canMove } from "@/lib/stock/low";
import { rupeesToCents, formatMUR } from "@/lib/money";
import { muToday, muNow } from "@/lib/mu-date";

export interface NotifItem {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "warn" | "danger" | "info";
  /** How many things this alert is about. It is what "has it grown since I
   *  dismissed it?" is measured in — see applyDismissals. */
  count: number;
}

/** One alert a user has cleared: how big it was, and on which Mauritius day. */
export interface Dismissal {
  key: string;
  seenCount: number;
  day: string;
}

/** Which alerts survive the user's dismissals?
 *
 *  A dismissal cannot mean "delete" — every alert here is a live condition that
 *  we recompute from the ledger, so it would simply come back. It means "I have
 *  seen this", and that only holds while two things stay true:
 *   • it is still the same day — tomorrow you should be told again;
 *   • it has not GROWN — you cleared 3 new enquiries, a 4th is news.
 *
 *  Shrinking never un-dismisses: paying one of 5 outstanding invoices is you
 *  working through the list, not something to interrupt you about. */
export function applyDismissals(items: NotifItem[], dismissals: Dismissal[], today: string): NotifItem[] {
  const cleared = new Map(dismissals.map((d) => [d.key, d]));
  return items.filter((item) => {
    const d = cleared.get(item.key);
    if (!d) return true;
    if (d.day !== today) return true;
    return item.count > d.seenCount;
  });
}

// Actionable alerts for the top-bar bell. This runs in the app LAYOUT, so its
// cost lands on every full page load — it is the difference between the shell
// appearing at once and appearing a second and a half later.
//
// Every source is therefore (a) isolated, so one failing query can't break the
// shell, and (b) started at the SAME TIME. They used to run one after another:
// four sequential waits against a database that is a network hop away, which is
// four times the latency for no reason — none of them needs another's answer.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

/** Outstanding invoices (money owed). */
async function outstandingInvoices(sb: SB, today: string): Promise<NotifItem | null> {
  try {
    const inv = await fetchAllRows(() =>
      sb.from("documents").select("total_incl, amount_paid, due_date").eq("doc_type", "invoice").in("status", ["issued", "partly_paid"]),
    );
    let outstanding = 0, count = 0, overdue = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of inv as any[]) {
      const out = rupeesToCents(Number(d.total_incl)) - rupeesToCents(Number(d.amount_paid));
      if (out > 0) { outstanding += out; count += 1; if (d.due_date && d.due_date < today) overdue += 1; }
    }
    if (count === 0) return null;
    return {
      key: "outstanding",
      label: `${count} invoice${count === 1 ? "" : "s"} outstanding`,
      detail: `${formatMUR(outstanding)} owed${overdue ? ` · ${overdue} overdue` : ""}`,
      href: "/sales?status=issued",
      tone: overdue ? "danger" : "warn",
      count,
    };
  } catch {
    return null;
  }
}

/** New enquiries awaiting a reply. */
async function newEnquiries(sb: SB): Promise<NotifItem | null> {
  try {
    const { count } = await sb.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new");
    if (!count || count <= 0) return null;
    return { key: "enquiries", label: `${count} new enquir${count === 1 ? "y" : "ies"}`, detail: "Awaiting a reply", href: "/enquiries", tone: "info", count };
  } catch {
    return null;
  }
}

/** Jobs the server auto-started when their booked time arrived — the web echo of
 *  the tablet's "Due to start now" popup. Counted from the audit trail the flip
 *  writes, so it means exactly "a booking started itself", and only today's, so
 *  it clears overnight rather than lingering. Dismissible like the rest. */
async function jobsStarted(sb: SB, dayStartIso: string): Promise<NotifItem | null> {
  try {
    const { count } = await sb
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "job_auto_started")
      .gte("created_at", dayStartIso);
    if (!count || count <= 0) return null;
    return {
      key: "jobsstarted",
      label: `${count} job${count === 1 ? "" : "s"} started on schedule`,
      detail: "Moved to In progress at the booked time",
      href: "/jobs",
      tone: "info",
      count,
    };
  } catch {
    return null;
  }
}

/** Ceramic maintenance due. */
async function maintenanceDue(sb: SB, today: string): Promise<NotifItem | null> {
  try {
    const { count } = await sb.from("maintenance_reminders").select("id", { count: "exact", head: true }).lte("due_date", today).is("sent_at", null);
    if (!count || count <= 0) return null;
    return { key: "reminders", label: `${count} maintenance due`, detail: "Ceramic maintenance wash", href: "/certificates?tab=reminders", tone: "warn", count };
  } catch {
    return null;
  }
}

/** Low stock on the selling floor (only for items actually carried, to avoid noise). */
async function lowStock(sb: SB): Promise<NotifItem | null> {
  try {
    // The locations lookup gates the rest, but the two big reads run together.
    // Ask which floor the till sells from rather than guessing "the one that
    // isn't the default" — with a second warehouse that guess was a coin flip,
    // and this alert would quietly start reporting on the wrong building.
    const floor = pickSalesFloor(await getStockLocations(sb));
    if (!floor) return null;
    const shopId = floor.id;
    const [prods, oh] = await Promise.all([
      fetchAllRows(() => sb.from("products").select("id, low_stock_threshold").eq("is_stocked", true).eq("is_active", true).not("low_stock_threshold", "is", null)),
      fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    ]);
    const shopQty = new Map<string, number>();
    const totalQty = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of oh as any[]) {
      totalQty.set(r.product_id, (totalQty.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
      if (r.location_id === shopId) shopQty.set(r.product_id, (shopQty.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
    }
    let low = 0;
    let movable = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of prods as any[]) {
      // The SAME rule the catalogue's filter uses, so this count and the list it
      // links to can't disagree — they used to, 11 against 36.
      const level = { isStocked: true, threshold: Number(p.low_stock_threshold), floorQty: shopQty.get(p.id) ?? 0, totalQty: totalQty.get(p.id) ?? 0 };
      if (!isLow(level)) continue;
      low += 1;
      if (canMove(level)) movable += 1;
    }
    if (low === 0) return null;
    // Say what's actually true. This line used to read "Restock from the
    // warehouse" for every alert; on the live catalogue only 2 of 11 could be
    // restocked — the other 9 had an empty warehouse, so it was sending someone
    // to fetch what wasn't there.
    const detail =
      movable === 0
        ? "None in the warehouse — these need reordering"
        : movable === low
          ? "Move them over from the warehouse"
          : `${movable} can be moved from the warehouse · ${low - movable} to reorder`;
    // Name the floor: with more than one, "at the shop" would be ambiguous.
    // The link lands on exactly these products, not on a screen to search.
    return { key: "lowstock", label: `${low} product${low === 1 ? "" : "s"} low at ${floor.name}`, detail, href: "/products?low=1", tone: "warn", count: low };
  } catch {
    return null;
  }
}

/** Everything that is true right now, before anyone's dismissals are applied.
 *  Exported because the dismiss action needs the SERVER's count of an alert —
 *  a stale browser must not be able to silence one bigger than it has seen. */
export async function collectNotifications(sb: SB, today: string): Promise<NotifItem[]> {
  // All four at once — the wall-clock cost is now the slowest single source,
  // not the sum of all of them.
  // Start of the Mauritius business day (UTC+4, no DST) as an instant — the
  // window for "started today".
  const dayStartIso = new Date(`${today}T00:00:00+04:00`).toISOString();
  const items = await Promise.all([
    outstandingInvoices(sb, today),
    newEnquiries(sb),
    maintenanceDue(sb, today),
    lowStock(sb),
    jobsStarted(sb, dayStartIso),
  ]);
  return items.filter((i): i is NotifItem => i !== null);
}

/** The current user's cleared alerts. RLS returns only their own rows. */
async function myDismissals(sb: SB): Promise<Dismissal[]> {
  try {
    const { data } = await sb.from("notification_dismissals").select("key, seen_count, dismissed_day");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((d) => ({ key: d.key, seenCount: Number(d.seen_count), day: d.dismissed_day }));
  } catch {
    return []; // never let the bell's memory break the bell
  }
}

export async function getNotifications(): Promise<NotifItem[]> {
  const sb = await createClient();
  const today = muToday(); // Mauritius calendar day, not UTC

  const [items, dismissals] = await Promise.all([collectNotifications(sb, today), myDismissals(sb)]);
  return applyDismissals(items, dismissals, today);
}

/** Mauritius fiscal years (1 Jul – 30 Jun), current + the previous two. */
export function fiscalYears(now = new Date()): { label: string; from: string; to: string }[] {
  const mu = muNow(now.getTime()); // read month/year in Mauritius local time
  const startYear = mu.getUTCMonth() >= 6 ? mu.getUTCFullYear() : mu.getUTCFullYear() - 1;
  return [0, 1, 2].map((i) => {
    const s = startYear - i;
    return { label: `FY ${s}–${String(s + 1).slice(2)}`, from: `${s}-07-01`, to: `${s + 1}-06-30` };
  });
}
