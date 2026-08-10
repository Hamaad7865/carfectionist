import Link from "next/link";
import { Plus } from "lucide-react";
import { getContacts } from "@/lib/supabase/queries/contacts";
import { CustomerDialog } from "@/features/contacts/CustomerDialog";
import { CustomerList } from "@/features/contacts/CustomerList";
import { ImportExport } from "@/features/dataio/ImportExport";
import { VehiclesEditor } from "@/features/contacts/VehiclesEditor";
import { PointsPanel } from "@/features/contacts/PointsPanel";
import { SuppliersPanel } from "@/features/contacts/SuppliersPanel";
import { WaOptOutToggle } from "@/features/contacts/WaOptOutToggle";
import { StatusPill } from "@/components/ui/StatusPill";
import { getSessionContext } from "@/lib/auth/session";
import { formatMUR } from "@/lib/money";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "suppliers" ? "suppliers" : "customers";
  const [data, session] = await Promise.all([getContacts(sp.c), getSessionContext()]);
  const sel = data.selected;
  const canMarket = session?.role === "owner" || session?.role === "manager";

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-1.5">
        <Link href="/contacts" className={tabCls(tab === "customers")}>Customers</Link>
        <Link href="/contacts?tab=suppliers" className={tabCls(tab === "suppliers")}>Suppliers</Link>
        <div className="flex-1" />
        {tab === "customers" && <ImportExport kind="customers" />}
        {tab === "customers" && <CustomerDialog />}
      </div>

      {tab === "customers" ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_1fr]">
          {/* list — searchable (client-side filter) */}
          <CustomerList customers={data.customers} selectedId={sel?.id} />

          {/* detail */}
          {sel ? (
            <div className="overflow-hidden rounded-[16px] border border-line bg-card">
              <div className="flex items-center gap-3.5 border-b border-line px-[22px] py-5">
                <span className="grad-logo grid size-[52px] place-items-center rounded-[14px] font-display text-[18px] font-extrabold text-white">{initials(sel.name)}</span>
                <div className="flex-1">
                  <div className="font-display text-[19px] font-extrabold text-ink-strong">{sel.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{[sel.phone, sel.email].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <CustomerDialog customer={sel} />
                  <Link href="/sales/new?type=invoice" className="grad-brand shadow-brand flex h-[38px] items-center gap-1.5 rounded-[10px] px-3.5 text-[12.5px] font-bold text-white">
                    <Plus size={14} /> New document
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 p-[22px]">
                <div className="rounded-[12px] border border-line p-4">
                  <div className="text-[11.5px] font-semibold text-muted">Lifetime spend</div>
                  <div className="num mt-1.5 text-[22px] font-extrabold text-ink-strong">{formatMUR(sel.spendCents)}</div>
                </div>
                <div className="rounded-[12px] border border-line p-4">
                  <div className="text-[11.5px] font-semibold text-muted">Outstanding balance</div>
                  <div className={`num mt-1.5 text-[22px] font-extrabold ${sel.outstandingCents > 0 ? "text-amber-ink" : "text-ink-strong"}`}>{formatMUR(sel.outstandingCents)}</div>
                </div>
              </div>

              {canMarket && (
                <div className="px-[22px] pb-1">
                  <WaOptOutToggle customerId={sel.id} optOut={sel.waOptOut} />
                </div>
              )}

              <div className="px-[22px] pb-2">
                <VehiclesEditor customerId={sel.id} vehicles={sel.vehicles} />
              </div>

              <div className="px-[22px] pb-2">
                <PointsPanel balance={sel.pointsBalance} pointValueRupees={sel.pointValueRupees} history={sel.pointsHistory} />
              </div>

              <div className="px-[22px] pb-[22px] pt-3.5">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]">Service history · {sel.history.length}</div>
                <div className="flex flex-col">
                  {sel.history.length === 0 && <div className="rounded-[11px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">No documents yet.</div>}
                  {sel.history.map((h) => (
                    <Link key={h.id} href={`/sales/${h.id}`} className="flex items-center gap-3 border-b border-line px-3 py-2.5 hover:bg-sub">
                      <span className="num text-[12px] font-bold text-link">{h.number ?? "Draft"}</span>
                      <span className="num flex-1 text-[12px] text-muted">{h.date}</span>
                      <StatusPill status={h.status} />
                      <span className="num min-w-20 text-right text-[13px] font-bold text-ink">{formatMUR(h.totalCents)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[16px] border border-line bg-card p-10 text-center text-[13px] text-faint">Select a customer.</div>
          )}
        </div>
      ) : (
        <SuppliersPanel suppliers={data.suppliers} />
      )}
    </div>
  );
}
