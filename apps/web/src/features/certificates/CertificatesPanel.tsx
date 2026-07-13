"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Plus, ShieldCheck, X } from "lucide-react";
import type { CertificatesData } from "@/lib/supabase/queries/certificates";
import { createCertificateAction } from "./actions";
import { CertificateCard } from "./CertificateCard";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const WARRANTIES = [12, 24, 36, 60];

export function CertificatesPanel({ data, today }: { data: CertificatesData; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(data.certificates[0]?.id ?? null);

  const selected = useMemo(() => data.certificates.find((c) => c.id === selectedId) ?? null, [selectedId, data.certificates]);

  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const vehicles = useMemo(() => data.customers.find((c) => c.id === customerId)?.vehicles ?? [], [customerId, data.customers]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [months, setMonths] = useState(36);
  const [appliedAt, setAppliedAt] = useState(today);
  const [notes, setNotes] = useState("");

  function onCustomer(id: string) {
    setCustomerId(id);
    const first = data.customers.find((c) => c.id === id)?.vehicles[0]?.id ?? "";
    setVehicleId(first);
  }

  async function create() {
    setError(null);
    if (!customerId || !vehicleId) return setError("Pick a customer and a vehicle.");
    setBusy(true);
    const r = await createCertificateAction({
      customerId,
      vehicleId,
      productId: productId || null,
      warrantyMonths: months,
      appliedAt,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (r.ok) { setNotes(""); setShowForm(false); router.refresh(); }
    else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Certificates</span>
          <span className="text-[12.5px] text-faint">· {data.certificates.length}</span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body hover:border-brand"
        >
          {showForm ? <X size={15} /> : <Plus size={15} />} {showForm ? "Cancel" : "Issue certificate"}
        </button>
      </div>

      {/* issue form (toggle) */}
      {showForm && (
        <div className="rounded-[15px] border border-line bg-card p-5">
          <p className="mb-4 text-[12.5px] text-muted">Next number <span className="num font-bold text-body">{data.nextNumber}</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Customer</span>
              <select className={field} value={customerId} onChange={(e) => onCustomer(e.target.value)}>
                {data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Vehicle</span>
              <select className={field} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                {vehicles.length === 0 && <option value="">— no vehicle on file —</option>}
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Treatment (optional)</span>
              <select className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">—</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Warranty</span>
              <select className={field} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {WARRANTIES.map((m) => <option key={m} value={m}>{m} months</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Applied</span>
              <input type="date" className={field} value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Notes (optional)</span>
              <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Batch, applicator…" />
            </label>
          </div>
          {error && <p className="mt-3 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
          <button onClick={create} disabled={busy} className="grad-brand shadow-brand mt-4 flex h-11 items-center justify-center gap-2 rounded-[12px] px-5 font-bold text-white disabled:opacity-50">
            <BadgeCheck size={17} /> {busy ? "Issuing…" : "Issue certificate"}
          </button>
        </div>
      )}

      {/* list + detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,44%)_1fr]">
        {/* list */}
        <div className="overflow-hidden rounded-[15px] border border-line bg-card">
          {data.certificates.length === 0 ? (
            <div className="px-5 py-16 text-center text-[13px] text-faint">No certificates issued yet.</div>
          ) : (
            data.certificates.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors ${active ? "bg-band" : "hover:bg-sub"}`}
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-full text-white"
                    style={{ background: c.expired ? "#8494A3" : "linear-gradient(135deg,#0FBFA6,#3E8BFF)" }}
                  >
                    <Check size={17} strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-ink">{c.vehicle}</div>
                    <div className="truncate text-[12px] text-muted">
                      <span className="num">{c.number}</span> · {c.customerName}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {c.plate && <div className="num inline-block rounded-[5px] bg-[#F0C542] px-1.5 py-0.5 text-[11px] font-bold text-[#151208]">{c.plate}</div>}
                    <div className={`mt-1 text-[11px] font-semibold ${c.expired ? "text-rose" : "text-muted"}`}>{c.expired ? "expired" : "to"} {c.expiresAt}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* detail */}
        <div>
          {selected ? (
            <>
              {selected.jobId && (
                <div className="mb-2.5 flex justify-end">
                  <Link href={`/jobs/${selected.jobId}`} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-card px-3 text-[12px] font-bold text-body hover:border-brand">
                    View job & flow →
                  </Link>
                </div>
              )}
              <CertificateCard cert={selected} studioName={data.studioName} />
            </>
          ) : (
            <div className="grid h-full min-h-[300px] place-items-center rounded-[15px] border border-dashed border-line-2 text-[13px] text-faint">
              Select a certificate to view it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
