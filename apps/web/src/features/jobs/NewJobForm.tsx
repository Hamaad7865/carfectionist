"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createJobAction } from "./actions";
import type { IntakeRef } from "@/lib/supabase/queries/jobs";

const field = "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

export function NewJobForm({ intake }: { intake: IntakeRef }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [service, setService] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicles = intake.vehicles.filter((v) => v.customerId === customerId);

  async function submit() {
    setError(null);
    if (!customerId || !vehicleId) return setError("Pick a customer and vehicle.");
    setBusy(true);
    const r = await createJobAction({ customerId, vehicleId, service, technicianId: technicianId || null });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setService("");
      setVehicleId("");
      router.refresh();
    } else setError(r.error);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="grad-brand shadow-brand flex h-10 items-center gap-2 rounded-[11px] px-4 text-[13px] font-bold text-white">
        <Plus size={16} strokeWidth={2.4} /> New job (intake)
      </button>
    );
  }

  return (
    <div className="w-full rounded-[14px] border border-line bg-card p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={lbl}>Customer</span>
          <select className={field} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setVehicleId(""); }}>
            <option value="">— select —</option>
            {intake.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Vehicle</span>
          <select className={field} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!customerId}>
            <option value="">— select —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Technician</span>
          <select className={field} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">— unassigned —</option>
            {intake.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Service</span>
          <input className={field} value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Full detail + ceramic" />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-rose">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className="grad-brand shadow-brand inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-60">
          {busy ? "Creating…" : "Create job"}
        </button>
        <button onClick={() => setOpen(false)} className="inline-flex h-9 items-center justify-center rounded-[10px] px-3 text-[13px] font-semibold text-muted">Cancel</button>
      </div>
    </div>
  );
}
