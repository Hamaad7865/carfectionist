import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents, formatMUR } from "@/lib/money";
import { muToday, muNow } from "@/lib/mu-date";

export interface NotifItem {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "warn" | "danger" | "info";
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
    return { key: "enquiries", label: `${count} new enquir${count === 1 ? "y" : "ies"}`, detail: "Awaiting a reply", href: "/enquiries", tone: "info" };
  } catch {
    return null;
  }
}

/** Ceramic maintenance due. */
async function maintenanceDue(sb: SB, today: string): Promise<NotifItem | null> {
  try {
    const { count } = await sb.from("maintenance_reminders").select("id", { count: "exact", head: true }).lte("due_date", today).is("sent_at", null);
    if (!count || count <= 0) return null;
    return { key: "reminders", label: `${count} maintenance due`, detail: "Ceramic maintenance wash", href: "/certificates?tab=reminders", tone: "warn" };
  } catch {
    return null;
  }
}

/** Low stock at the shop (only for items actually carried, to avoid noise). */
async function lowStock(sb: SB): Promise<NotifItem | null> {
  try {
    // The locations lookup gates the rest, but the two big reads run together.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locs = ((await sb.from("stock_locations").select("id, is_default")).data ?? []) as any[];
    const shopId = locs.find((l) => !l.is_default)?.id;
    if (!shopId) return null;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of prods as any[]) {
      if ((totalQty.get(p.id) ?? 0) > 0 && (shopQty.get(p.id) ?? 0) < Number(p.low_stock_threshold)) low += 1;
    }
    if (low === 0) return null;
    return { key: "lowstock", label: `${low} product${low === 1 ? "" : "s"} low at the shop`, detail: "Restock from the warehouse", href: "/products?tab=inventory", tone: "warn" };
  } catch {
    return null;
  }
}

export async function getNotifications(): Promise<NotifItem[]> {
  const sb = await createClient();
  const today = muToday(); // Mauritius calendar day, not UTC

  // All four at once — the wall-clock cost is now the slowest single source,
  // not the sum of all of them.
  const items = await Promise.all([
    outstandingInvoices(sb, today),
    newEnquiries(sb),
    maintenanceDue(sb, today),
    lowStock(sb),
  ]);
  return items.filter((i): i is NotifItem => i !== null);
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
