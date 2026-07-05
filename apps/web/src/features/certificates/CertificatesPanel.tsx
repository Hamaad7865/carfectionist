"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import type { CertificatesData } from "@/lib/supabase/queries/certificates";
import { createCertificateAction } from "./actions";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const WARRANTIES = [12, 24, 36, 60];

export function CertificatesPanel({ data, today }: { data: CertificatesData; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (r.ok) { setNotes(""); router.refresh(); }
    else setError(r.error);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* issue */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Issue certificate</span>
        </div>
        <p className="mb-4 text-[12.5px] text-muted">Next number <span className="num font-bold text-body">{data.nextNumber}</span></p>

        <div className="flex flex-col gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Notes (optional)</span>
            <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Batch, applicator…" />
          </label>

          {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

          <button onClick={create} disabled={busy} className="grad-brand shadow-brand flex h-11 items-center justify-center gap-2 rounded-[12px] font-bold text-white disabled:opacity-50">
            <BadgeCheck size={17} /> {busy ? "Issuing…" : "Issue certificate"}
          </button>
        </div>
      </div>

      {/* register */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="grid grid-cols-[110px_1fr_1fr_100px_100px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          <span>Number</span><span>Customer</span><span>Vehicle · treatment</span><span>Expires</span><span className="text-right">Status</span>
        </div>
        {data.certificates.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No certificates issued yet.</div>
        ) : (
          data.certificates.map((c) => (
            <div key={c.id} className="grid grid-cols-[110px_1fr_1fr_100px_100px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
              <span className="num font-bold text-link">{c.number}</span>
              <span className="truncate text-body">{c.customerName}</span>
              <span className="truncate text-muted">
                {c.vehicle}
                {c.productName && <span className="text-faint"> · {c.productName}</span>}
              </span>
              <span className="num text-muted">{c.expiresAt}</span>
              <span className="text-right">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold ${c.expired ? "bg-[rgba(214,59,80,0.12)] text-rose" : "bg-[rgba(13,167,124,0.14)] text-mint"}`}>
                  {c.expired ? "Expired" : "Active"}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
