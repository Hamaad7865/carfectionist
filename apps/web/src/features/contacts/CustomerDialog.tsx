"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveCustomerAction } from "./actions";
import type { CustomerSummary } from "@/lib/supabase/queries/contacts";
import { btn } from "@/components/ui/button";

type FormState = { name: string; isCompany: boolean; email: string; phone: string; address: string; brn: string; vatNumber: string; notes: string };
const seed = (c?: CustomerSummary): FormState => ({
  name: c?.name ?? "",
  isCompany: c?.isCompany ?? false,
  email: c?.email ?? "",
  phone: c?.phone ?? "",
  address: c?.address ?? "",
  brn: c?.brn ?? "",
  vatNumber: c?.vatNumber ?? "",
  notes: c?.notes ?? "",
});

export function CustomerDialog({ customer }: { customer?: CustomerSummary }) {
  const editing = !!customer;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<FormState>(() => seed(customer));

  function launch() {
    setF(seed(customer));
    setError(null);
    setOpen(true);
  }
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await saveCustomerAction({ id: customer?.id, ...f });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      // land on the new/edited customer
      if (r.data?.id) router.push(`/contacts?c=${r.data.id}`);
      router.refresh();
    } else setError(r.error);
  }

  return (
    <>
      {editing ? (
        <button onClick={launch} className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3.5 text-[12.5px] font-bold text-body hover:border-brand">
          <Pencil size={14} /> Edit
        </button>
      ) : (
        <button onClick={launch} className={btn("primary", "lg", "gap-2")}>
          <Plus size={16} strokeWidth={2.4} /> New customer
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit customer" : "New customer"}
        subtitle={editing ? customer!.name : "Add a customer to the address book"}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={submit} disabled={busy} className={btn("primary", "lg", "px-5")}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create customer"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          {/* Individual vs business entity — a business also carries a BRN + VAT number. */}
          <div className="flex gap-1 rounded-[10px] border border-line-2 bg-sub p-1">
            {([["Individual", false], ["Business", true]] as const).map(([label, val]) => (
              <button
                key={label}
                type="button"
                onClick={() => setF((s) => ({ ...s, isCompany: val }))}
                className={`h-9 flex-1 rounded-[7px] text-[13px] font-bold transition ${f.isCompany === val ? "bg-card text-ink shadow-sm" : "text-muted hover:text-body"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Field label={f.isCompany ? "Company name" : "Name"}>
            <input className={inputCls} value={f.name} onChange={set("name")} placeholder={f.isCompany ? "Registered company name" : "Full name"} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} placeholder="+230 …" /></Field>
            <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} placeholder="name@email.com" /></Field>
          </div>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={set("address")} placeholder="Street, town" /></Field>
          {f.isCompany && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="BRN"><input className={inputCls} value={f.brn} onChange={set("brn")} placeholder="Business reg. no." /></Field>
              <Field label="VAT number"><input className={inputCls} value={f.vatNumber} onChange={set("vatNumber")} placeholder="VAT…" /></Field>
            </div>
          )}
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={set("notes")} placeholder="Optional" /></Field>
        </div>
      </Modal>
    </>
  );
}
