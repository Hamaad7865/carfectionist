"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { getStockLocations, pickSalesFloor } from "@/lib/supabase/locations";
import { lowStock, outstandingInvoices } from "@/lib/supabase/queries/notifications";
import { muToday } from "@/lib/mu-date";

/** One issuing company as the sidebar shows it. Today a tenant IS one company; when
 *  multi-company billing lands this becomes one row per company, in sort order. */
export interface ShellCompany {
  name: string;
  vatRegistered: boolean;
}

export interface ShellStatus {
  companies: ShellCompany[];
  /** Under the company name in the switcher: the selling floor. */
  shopName: string | null;
  /** Jobs waiting on the desk: ready, so they need paying and handing back. */
  readyJobs: number;
  unpaidInvoices: number;
  lowStock: number;
  tillOpen: boolean;
}

const EMPTY: ShellStatus = { companies: [], shopName: null, readyJobs: 0, unpaidInvoices: 0, lowStock: 0, tillOpen: false };

/** Each source fails alone: a broken count must never take the menu down with it. */
async function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

/** The tyre-centre sidebar's live figures. Asked from the client on every navigation,
 *  like the bell (Topbar), because a layout does not re-run on client navigation. */
export async function getShellStatusAction(): Promise<ShellStatus> {
  if (!(await getSessionContext())) return EMPTY;
  const sb = await createClient();
  const [bs, floor, ready, unpaid, low, till] = await Promise.all([
    safe(sb.from("business_settings").select("legal_name, trading_name, vat_number").limit(1).maybeSingle(), null),
    safe(getStockLocations(sb).then(pickSalesFloor), null),
    safe(sb.from("jobs").select("id", { count: "exact", head: true }).eq("status", "ready"), null),
    safe(outstandingInvoices(sb, muToday()), null),
    safe(lowStock(sb), null),
    safe(sb.from("cash_sessions").select("id", { count: "exact", head: true }).eq("status", "open"), null),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (bs as any)?.data;
  return {
    companies: s
      ? [{ name: (s.trading_name || s.legal_name) as string, vatRegistered: !!(s.vat_number ?? "").trim() }]
      : [],
    shopName: floor?.name ?? null,
    readyJobs: ready?.count ?? 0,
    unpaidInvoices: unpaid?.count ?? 0,
    lowStock: low?.count ?? 0,
    tillOpen: (till?.count ?? 0) > 0,
  };
}
