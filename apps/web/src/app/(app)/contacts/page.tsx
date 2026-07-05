import Link from "next/link";
import { Car, Plus } from "lucide-react";
import { getContacts } from "@/lib/supabase/queries/contacts";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

const tabCls = (on: boolean) =>
  `h-[38px] rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "suppliers" ? "suppliers" : "customers";
  const data = await getContacts(sp.c);
  const sel = data.selected;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex gap-1.5">
        <Link href="/contacts" className={tabCls(tab === "customers")}>Customers</Link>
        <Link href="/contacts?tab=suppliers" className={tabCls(tab === "suppliers")}>Suppliers</Link>
      </div>

      {tab === "customers" ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_1fr]">
          {/* list */}
          <div className="rounded-[14px] border border-line bg-card p-2">
            {data.customers.length === 0 && <div className="p-6 text-center text-[12.5px] text-faint">No customers.</div>}
            {data.customers.map((c) => {
              const on = sel?.id === c.id;
              return (
                <Link
                  key={c.id}
                  href={`/contacts?c=${c.id}`}
                  className={`mb-1 flex w-full items-center gap-3 rounded-[11px] border px-3 py-2.5 ${on ? "border-link bg-[rgba(43,140,255,0.08)]" : "border-transparent hover:bg-sub"}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] font-display text-[12px] font-extrabold text-[#3f5065]" style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}>
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-ink">{c.name}</div>
                    <div className="text-[11.5px] text-muted">{c.vehicleCount} vehicle{c.vehicleCount === 1 ? "" : "s"}</div>
                  </div>
                  <span className={`num text-[11px] font-semibold ${c.outstandingCents > 0 ? "text-amber-ink" : "text-faint"}`}>
                    {c.outstandingCents > 0 ? formatMUR(c.outstandingCents) : "—"}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* detail */}
          {sel ? (
            <div className="overflow-hidden rounded-[16px] border border-line bg-card">
              <div className="flex items-center gap-3.5 border-b border-line px-[22px] py-5">
                <span className="grad-logo grid size-[52px] place-items-center rounded-[14px] font-display text-[18px] font-extrabold text-white">{initials(sel.name)}</span>
                <div className="flex-1">
                  <div className="font-display text-[19px] font-extrabold text-ink-strong">{sel.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{[sel.phone, sel.email].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <Link href="/sales/new?type=invoice" className="grad-brand shadow-brand flex h-[38px] items-center gap-1.5 rounded-[10px] px-3.5 text-[12.5px] font-bold text-white">
                  <Plus size={14} /> New document
                </Link>
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

              <div className="px-[22px] pb-2">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]">Vehicles</div>
                <div className="flex flex-col gap-2">
                  {sel.vehicles.length === 0 && <div className="rounded-[11px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">No vehicles on file.</div>}
                  {sel.vehicles.map((v, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-[11px] border border-line px-3.5 py-2.5">
                      <Car size={20} className="text-link" strokeWidth={1.8} />
                      <span className="flex-1 text-[13px] font-bold text-body">{v.make}</span>
                      <span className="num text-[12px] text-muted">{v.plate}</span>
                      <span className="text-[12px] text-muted">{v.color}</span>
                    </div>
                  ))}
                </div>
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
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="grid grid-cols-[1fr_180px_1fr] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            <span>Supplier</span>
            <span>Phone</span>
            <span>Email</span>
          </div>
          {data.suppliers.length === 0 ? (
            <div className="px-5 py-14 text-center text-[13px] text-faint">No suppliers yet. Supplier management arrives with Purchases (Phase 2/3).</div>
          ) : (
            data.suppliers.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_180px_1fr] gap-3 border-b border-line px-5 py-3.5 text-[13px]">
                <span className="font-bold text-body">{s.name}</span>
                <span className="num text-muted">{s.phone ?? "—"}</span>
                <span className="text-muted">{s.email ?? "—"}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
