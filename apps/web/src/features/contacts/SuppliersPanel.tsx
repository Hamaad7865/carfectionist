"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveSupplierAction } from "./actions";
import type { SupplierRow } from "@/lib/supabase/queries/contacts";

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
        <button onClick={() => launch()} className="grad-brand shadow-brand inline-flex h-10 items-center gap-2 rounded-[11px] px-4 text-[13px] font-bold text-white">
          <Plus size={16} strokeWidth={2.4} /> New supplier
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="grid grid-cols-[1fr_160px_1fr_44px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
          <span>Supplier</span><span>Phone</span><span>Email</span><span />
        </div>
        {suppliers.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">No suppliers yet. Add your first with “New supplier”.</div>
        ) : (
          suppliers.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_160px_1fr_44px] items-center gap-3 border-b border-line px-5 py-3.5 text-[13px]">
              <span className="min-w-0 truncate font-bold text-body" title={s.name}>{s.name}</span>
              <span className="num text-muted">{s.phone ?? "—"}</span>
              <span className="min-w-0 truncate text-muted">{s.email ?? "—"}</span>
              <button onClick={() => launch(s)} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-body"><Pencil size={14} /></button>
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
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={submit} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
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
