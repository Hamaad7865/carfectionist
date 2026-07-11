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

/** Actionable alerts for the top-bar bell. Runs on every page load, so each
 *  source is isolated — one failing query never breaks the shell. */
export async function getNotifications(): Promise<NotifItem[]> {
  const sb = await createClient();
  const today = muToday(); // Mauritius calendar day, not UTC
  const items: NotifItem[] = [];

  // 1. Outstanding invoices (money owed)
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
    if (count > 0) items.push({
      key: "outstanding",
      label: `${count} invoice${count === 1 ? "" : "s"} outstanding`,
      detail: `${formatMUR(outstanding)} owed${overdue ? ` · ${overdue} overdue` : ""}`,
      href: "/sales?status=issued",
      tone: overdue ? "danger" : "warn",
    });
  } catch { /* ignore */ }

  // 2. New enquiries
  try {
    const { count } = await sb.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new");
    if (count && count > 0) items.push({ key: "enquiries", label: `${count} new enquir${count === 1 ? "y" : "ies"}`, detail: "Awaiting a reply", href: "/enquiries", tone: "info" });
  } catch { /* ignore */ }

  // 3. Maintenance reminders due
  try {
    const { count } = await sb.from("maintenance_reminders").select("id", { count: "exact", head: true }).lte("due_date", today).is("sent_at", null);
    if (count && count > 0) items.push({ key: "reminders", label: `${count} maintenance due`, detail: "Ceramic maintenance wash", href: "/certificates?tab=reminders", tone: "warn" });
  } catch { /* ignore */ }

  // 4. Low stock at the shop (only for items you actually carry, to avoid noise)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locs = ((await sb.from("stock_locations").select("id, is_default")).data ?? []) as any[];
    const shopId = locs.find((l) => !l.is_default)?.id;
    if (shopId) {
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
      if (low > 0) items.push({ key: "lowstock", label: `${low} product${low === 1 ? "" : "s"} low at the shop`, detail: "Restock from the warehouse", href: "/products?tab=inventory", tone: "warn" });
    }
  } catch { /* ignore */ }

  return items;
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
