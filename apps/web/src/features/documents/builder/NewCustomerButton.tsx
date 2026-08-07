"use client";

import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveCustomerAction } from "@/features/contacts/actions";
import { btn } from "@/components/ui/button";
import type { BuilderCustomer } from "@/lib/supabase/queries/builder";

type FormState = { name: string; isCompany: boolean; phone: string; email: string; address: string; brn: string; vatNumber: string };
const blank = (name: string): FormState => ({ name, isCompany: false, phone: "", email: "", address: "", brn: "", vatNumber: "" });

/**
 * Create a customer without leaving the document builder. Unlike CustomerDialog
 * (which lands you on /contacts), this hands the freshly-saved customer back so
 * the builder can slot it into "Bill to" and the live preview at once — the row
 * the owner asked for beside the customer search.
 */
export function NewCustomerButton({
  defaultName,
  onCreated,
}: {
  defaultName: string;
  onCreated: (c: BuilderCustomer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<FormState>(() => blank(defaultName));

  function launch() {
    // Seed the name with whatever was already typed into the search box.
    setF(blank(defaultName.trim()));
    setError(null);
    setOpen(true);
  }
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await saveCustomerAction({
      name: f.name,
      isCompany: f.isCompany,
      phone: f.phone,
      email: f.email,
      address: f.address,
      brn: f.isCompany ? f.brn : undefined,
      vatNumber: f.isCompany ? f.vatNumber : undefined,
    });
    setBusy(false);
    if (!r.ok || !r.data?.id) return setError(r.ok ? "Could not create customer." : r.error);
    setOpen(false);
    onCreated({
      id: r.data.id,
      name: f.name.trim(),
      country: "Mauritius",
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      // A business gets its BRN/VAT straight onto the preview's "Bill to"; an individual carries neither.
      brn: f.isCompany ? f.brn.trim() || null : null,
      vatNo: f.isCompany ? f.vatNumber.trim() || null : null,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={launch}
        title="Create a new customer"
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-[11px] border border-line-2 bg-card px-3.5 text-[13px] font-bold text-body hover:border-brand"
      >
        <UserPlus size={16} strokeWidth={2.2} /> New
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New customer"
        subtitle="Add a customer and bill this document to them"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={submit} disabled={busy || !f.name.trim()} className={btn("primary", "lg", "px-5")}>
              {busy ? "Saving…" : "Create & bill to"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
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
            <input
              className={inputCls}
              value={f.name}
              onChange={set("name")}
              placeholder={f.isCompany ? "Registered company name" : "Full name"}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && f.name.trim() && !busy) submit(); }}
            />
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
        </div>
      </Modal>
    </>
  );
}
