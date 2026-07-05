"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Plus, Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveVehicleAction, deleteVehicleAction } from "./actions";
import type { ContactVehicle } from "@/lib/supabase/queries/contacts";

type VForm = { plate: string; make: string; model: string; year: string; color: string; vin: string };
const seed = (v?: ContactVehicle): VForm => ({
  plate: v?.plate ?? "",
  make: v?.make ?? "",
  model: v?.model ?? "",
  year: v?.year != null ? String(v.year) : "",
  color: v?.color ?? "",
  vin: v?.vin ?? "",
});

export function VehiclesEditor({ customerId, vehicles }: { customerId: string; vehicles: ContactVehicle[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [f, setF] = useState<VForm>(seed());

  function launch(v?: ContactVehicle) {
    setEditId(v?.id ?? null);
    setF(seed(v));
    setError(null);
    setOpen(true);
  }
  const set = (k: keyof VForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await saveVehicleAction({ id: editId ?? undefined, customerId, ...f });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    } else setError(r.error);
  }

  async function remove(id: string) {
    setListError(null);
    setBusy(true);
    const r = await deleteVehicleAction(id);
    setBusy(false);
    if (r.ok) router.refresh();
    else setListError(r.error);
  }

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]">Vehicles</div>
        <button onClick={() => launch()} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12px] font-bold text-body hover:border-brand">
          <Plus size={13} /> Add vehicle
        </button>
      </div>
      {listError && <div className="mb-2"><FormError error={listError} /></div>}
      <div className="flex flex-col gap-2">
        {vehicles.length === 0 && <div className="rounded-[11px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">No vehicles on file.</div>}
        {vehicles.map((v) => (
          <div key={v.id} className="flex items-center gap-3 rounded-[11px] border border-line px-3.5 py-2.5">
            <Car size={20} className="text-link" strokeWidth={1.8} />
            <span className="flex-1 text-[13px] font-bold text-body">{[v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}</span>
            <span className="num text-[12px] text-muted">{v.plate}</span>
            {v.color && <span className="text-[12px] text-muted">{v.color}</span>}
            <button onClick={() => launch(v)} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-body"><Pencil size={14} /></button>
            <button onClick={() => remove(v.id)} disabled={busy} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-rose disabled:opacity-50"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit vehicle" : "Add vehicle"}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={submit} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
              {busy ? "Saving…" : editId ? "Save changes" : "Add vehicle"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Number plate"><input className={inputCls} value={f.plate} onChange={set("plate")} placeholder="e.g. 1234 AB 26" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Make"><input className={inputCls} value={f.make} onChange={set("make")} placeholder="e.g. BMW" /></Field>
            <Field label="Model"><input className={inputCls} value={f.model} onChange={set("model")} placeholder="e.g. X5" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Year"><input className={inputCls} value={f.year} onChange={set("year")} inputMode="numeric" placeholder="2022" /></Field>
            <Field label="Colour"><input className={inputCls} value={f.color} onChange={set("color")} placeholder="Black" /></Field>
            <Field label="VIN"><input className={inputCls} value={f.vin} onChange={set("vin")} placeholder="Optional" /></Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
