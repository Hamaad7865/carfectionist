"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createJobAction } from "./actions";
import { DEPARTMENTS } from "@/lib/departments";
import type { IntakeRef } from "@/lib/supabase/queries/jobs";
import { btn } from "@/components/ui/button";

const field = "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

export function NewJobForm({ intake }: { intake: IntakeRef }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newMake, setNewMake] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [department, setDepartment] = useState("");
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicles = intake.vehicles.filter((v) => v.customerId === customerId);

  function reset() {
    setService(""); setVehicleId(""); setNewName(""); setNewPhone(""); setNewPlate(""); setNewMake(""); setDepartment("");
  }

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await createJobAction(
      mode === "existing"
        ? { customerId, vehicleId, service, technicianId: technicianId || null, department: department || null }
        : { newCustomerName: newName, newCustomerPhone: newPhone, newVehiclePlate: newPlate, newVehicleMake: newMake, service, technicianId: technicianId || null, department: department || null },
    );
    setBusy(false);
    if (r.ok) { setOpen(false); reset(); router.refresh(); }
    else setError(r.error);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btn("primary", "lg", "gap-2")}>
        <Plus size={16} strokeWidth={2.4} /> New job (intake)
      </button>
    );
  }

  const seg = (on: boolean) => `inline-flex h-8 items-center justify-center rounded-[8px] px-3 text-[12px] font-bold ${on ? "grad-brand shadow-brand text-white" : "text-muted"}`;

  return (
    <div className="w-full rounded-[14px] border border-line bg-card p-4">
      <div className="mb-3 flex w-fit gap-0 rounded-[10px] border border-line-2 bg-sub p-1">
        <button onClick={() => setMode("existing")} className={seg(mode === "existing")}>Existing customer</button>
        <button onClick={() => setMode("new")} className={seg(mode === "new")}>New customer</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {mode === "existing" ? (
          <>
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
          </>
        ) : (
          <>
            <label className="block">
              <span className={lbl}>Customer name</span>
              <input className={field} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
            </label>
            <label className="block">
              <span className={lbl}>Phone</span>
              <input className={field} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+230 …" />
            </label>
            <label className="block">
              <span className={lbl}>Plate</span>
              <input className={field} value={newPlate} onChange={(e) => setNewPlate(e.target.value)} placeholder="1234 AB 26" />
            </label>
            <label className="block">
              <span className={lbl}>Make / model</span>
              <input className={field} value={newMake} onChange={(e) => setNewMake(e.target.value)} placeholder="e.g. BMW X5" />
            </label>
          </>
        )}
        <label className="block">
          <span className={lbl}>Assigned to</span>
          <select className={field} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">— unassigned —</option>
            {intake.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Place of work</span>
          <select className={field} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">— department —</option>
            {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={lbl}>Service</span>
          <input className={field} value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Full detail + ceramic" />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-rose">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className={btn("primary")}>
          {busy ? "Creating…" : "Create job"}
        </button>
        <button onClick={() => setOpen(false)} className={btn("quiet")}>Cancel</button>
      </div>
    </div>
  );
}
