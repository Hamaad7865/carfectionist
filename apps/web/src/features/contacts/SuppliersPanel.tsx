"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveSupplierAction } from "./actions";
import type { SupplierRow } from "@/lib/supabase/queries/contacts";
import { btn } from "@/components/ui/button";

type SForm = { name: string; phone: string; email: string; address: string; brn: string; vatNumber: string; notes: string };
const seed = (s?: SupplierRow): SForm => ({
  name: s?.name ?? "",
  phone: s?.phone ?? "",
  email: s?.email ?? "",
  address: s?.address ?? "",
  brn: s?.brn ?? "",
  vatNumber: s?.vatNumber ?? "",
  notes: s?.notes ?? "",
});

export function SuppliersPanel({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<SForm>(seed());

  function launch(s?: SupplierRow) {
    setEditId(s?.id ?? null);
    setF(seed(s));
    setError(null);
    setOpen(true);
  }
  const set = (k: keyof SForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF((st) => ({ ...st, [k]: e.target.value }));

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await saveSupplierAction({ id: editId ?? undefined, ...f });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    } else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button onClick={() => launch()} className={btn("primary", "lg", "gap-2")}>
          <Plus size={16} strokeWidth={2.4} /> New supplier
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="hidden grid-cols-[1fr_160px_1fr_44px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th sm:grid">
          <span>Supplier</span><span>Phone</span><span>Email</span><span />
        </div>
        {suppliers.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">No suppliers yet. Add your first with “New supplier”.</div>
        ) : (
          suppliers.map((s) => (
            // Phones: name on top, phone · email under it, edit on the right. sm and up: the table.
            <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-x-3 gap-y-0.5 border-b border-line px-4 py-3.5 text-[13px] sm:grid-cols-[1fr_160px_1fr_44px] sm:px-5">
              <span className="min-w-0 truncate font-bold text-body" title={s.name}>{s.name}</span>
              <span className="num col-start-1 row-start-2 min-w-0 truncate text-[12px] text-muted sm:col-start-auto sm:row-start-auto sm:text-[13px]">
                {s.phone ?? "—"}
                {s.email && <span className="sm:hidden"> · {s.email}</span>}
              </span>
              <span className="hidden min-w-0 truncate text-muted sm:block">{s.email ?? "—"}</span>
              <button onClick={() => launch(s)} aria-label={`Edit ${s.name}`} className="col-start-2 row-span-2 row-start-1 grid size-10 place-items-center justify-self-end rounded-md text-faint hover:bg-sub hover:text-body sm:col-start-auto sm:row-span-1 sm:row-start-auto sm:size-7"><Pencil size={14} /></button>
            </div>
          ))
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit supplier" : "New supplier"}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={submit} disabled={busy} className={btn("primary", "lg", "px-5")}>
              {busy ? "Saving…" : editId ? "Save changes" : "Create supplier"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Name"><input className={inputCls} value={f.name} onChange={set("name")} placeholder="Supplier name" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} placeholder="+230 …" /></Field>
            <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} placeholder="name@email.com" /></Field>
          </div>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={set("address")} placeholder="Street, town" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="BRN"><input className={inputCls} value={f.brn} onChange={set("brn")} placeholder="Business reg. no." /></Field>
            <Field label="VAT number"><input className={inputCls} value={f.vatNumber} onChange={set("vatNumber")} placeholder="VAT…" /></Field>
          </div>
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={set("notes")} placeholder="Optional" /></Field>
        </div>
      </Modal>
    </div>
  );
}
