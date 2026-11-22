"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Lock, Pencil, Plus, Power } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { btn as btnCls } from "@/components/ui/button";
import type { CompanyAdminRow } from "@/lib/supabase/queries/companies";
import { saveCompanyAction, type CompanyInput } from "./company-actions";

const companyName = (c: { tradingName: string | null; legalName: string }) => c.tradingName?.trim() || c.legalName;

// Settings → Companies. One shop can bill under several companies — the tyre centre's
// VAT-registered tyre company and its non-VAT service company. Each company prints its own
// identity on its receipts and invoices and draws its own number series. The main company IS
// the business profile; the others are added and edited here.

function Badge({ tone, children }: { tone: "brand" | "mint" | "faint" | "amber"; children: React.ReactNode }) {
  const cls = {
    brand: "bg-[rgba(43,140,255,0.12)] text-link",
    mint: "bg-[rgba(13,167,124,0.14)] text-mint",
    amber: "bg-[rgba(245,166,35,0.16)] text-amber-ink",
    faint: "bg-shade/[0.08] text-faint",
  }[tone];
  return <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${cls}`}>{children}</span>;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const btn = btnCls("ghost", "sm");

type Form = {
  id: string | null;
  legal_name: string;
  trading_name: string;
  brn: string;
  vat_registered: boolean;
  vat_number: string;
  address: string;
  phone: string;
  email: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_name: string;
  receipt_header_text: string;
  receipt_footer_text: string;
  quote_prefix: string;
  invoice_prefix: string;
  credit_note_prefix: string;
  quote_next_number: string;
  invoice_next_number: string;
  credit_note_next_number: string;
};

const BLANK: Form = {
  id: null, legal_name: "", trading_name: "", brn: "", vat_registered: false, vat_number: "",
  address: "", phone: "", email: "", bank_account_name: "", bank_account_number: "", bank_name: "",
  receipt_header_text: "", receipt_footer_text: "",
  quote_prefix: "", invoice_prefix: "", credit_note_prefix: "",
  quote_next_number: "1", invoice_next_number: "1", credit_note_next_number: "1",
};

const fromRow = (c: CompanyAdminRow): Form => ({
  id: c.id, legal_name: c.legalName, trading_name: c.tradingName ?? "", brn: c.brn ?? "",
  vat_registered: c.vatRegistered, vat_number: c.vatNumber ?? "",
  address: c.address ?? "", phone: c.phone ?? "", email: c.email ?? "",
  bank_account_name: c.bankAccountName ?? "", bank_account_number: c.bankAccountNumber ?? "", bank_name: c.bankName ?? "",
  receipt_header_text: c.receiptHeaderText ?? "", receipt_footer_text: c.receiptFooterText ?? "",
  quote_prefix: c.quotePrefix, invoice_prefix: c.invoicePrefix, credit_note_prefix: c.creditNotePrefix,
  quote_next_number: String(c.quoteNextNumber), invoice_next_number: String(c.invoiceNextNumber),
  credit_note_next_number: String(c.creditNoteNextNumber),
});

function toInput(f: Form, isActive?: boolean): CompanyInput {
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const t = (s: string) => s.trim() || null;
  return {
    id: f.id, legal_name: f.legal_name, trading_name: t(f.trading_name), brn: t(f.brn),
    vat_registered: f.vat_registered, vat_number: f.vat_registered ? t(f.vat_number) : null,
    address: t(f.address), phone: t(f.phone), email: t(f.email),
    bank_account_name: t(f.bank_account_name), bank_account_number: t(f.bank_account_number), bank_name: t(f.bank_name),
    receipt_header_text: t(f.receipt_header_text), receipt_footer_text: t(f.receipt_footer_text),
    quote_prefix: f.quote_prefix.trim(), invoice_prefix: f.invoice_prefix.trim(), credit_note_prefix: f.credit_note_prefix.trim(),
    quote_next_number: n(f.quote_next_number), invoice_next_number: n(f.invoice_next_number),
    credit_note_next_number: n(f.credit_note_next_number),
    ...(isActive === undefined ? {} : { is_active: isActive }),
  };
}

export function CompaniesPanel({ companies, canManage }: { companies: CompanyAdminRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const editing = form?.id ? companies.find((c) => c.id === form.id) ?? null : null;
  const locked = editing?.hasIssued ?? false;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(input: CompanyInput) {
    setBusy(true);
    setError(null);
    const r = await saveCompanyAction(input);
    setBusy(false);
    if (r.ok) {
      setForm(null);
      router.refresh();
    } else setError(r.error);
  }

  return (
    <>
      {!form && <FormError error={error} />}

      <div className="flex flex-col gap-2.5">
        {companies.map((c) => {
          const offReason = c.isDefault
            ? "The main company is the business itself — it can't be switched off."
            : c.isActive && c.products > 0
              ? `${c.products} product${c.products === 1 ? " is" : "s are"} sold by it — move them to another company first.`
              : null;
          return (
            <div key={c.id} className={`rounded-[13px] border border-line bg-card p-4 ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] ${c.isDefault ? "bg-[rgba(43,140,255,0.12)] text-link" : "bg-sub text-muted"}`}>
                  <Building2 size={16} />
                </span>
                <span className="text-[14px] font-bold text-ink-strong">{companyName(c)}</span>
                {c.isDefault && <Badge tone="brand">MAIN</Badge>}
                {c.vatRegistered ? <Badge tone="mint">VAT {c.vatRate}%</Badge> : <Badge tone="amber">NOT VAT-REGISTERED</Badge>}
                {!c.isActive && <Badge tone="faint">SWITCHED OFF</Badge>}
                <div className="flex-1" />
                <span className="num text-[12px] text-muted">{c.products} product{c.products === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] text-muted sm:grid-cols-2">
                <span>{c.legalName}{c.brn ? ` · BRN ${c.brn}` : " · no BRN yet"}</span>
                <span>{c.vatRegistered ? (c.vatNumber ? `VAT ${c.vatNumber}` : "VAT number missing") : "Charges no VAT"}</span>
                <span className="num">
                  Next: {c.invoicePrefix}{pad(c.invoiceNextNumber, c.invoiceNumberPadding)} · {c.quotePrefix}{pad(c.quoteNextNumber, c.quoteNumberPadding)} · {c.creditNotePrefix}{pad(c.creditNoteNextNumber, c.creditNoteNumberPadding)}
                </span>
                <span>{c.hasIssued ? "Numbering fixed — it has issued documents" : "Nothing issued yet"}</span>
              </div>

              {canManage && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {c.isDefault ? (
                    <Link href="/settings" className={btn}>
                      <Pencil size={13} /> Edit in Business profile
                    </Link>
                  ) : (
                    <>
                      <button onClick={() => { setError(null); setForm(fromRow(c)); }} className={btn} disabled={busy}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        onClick={() => save(toInput(fromRow(c), !c.isActive))}
                        className={btn}
                        disabled={busy || (c.isActive && offReason !== null)}
                        title={c.isActive ? (offReason ?? "Stop billing under this company") : "Bill under this company again"}
                      >
                        <Power size={13} /> {c.isActive ? "Switch off" : "Switch on"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {canManage && !c.isDefault && c.isActive && offReason && <p className="mt-2 text-[11.5px] text-faint">{offReason}</p>}
            </div>
          );
        })}
      </div>

      {canManage && (
        <button onClick={() => { setError(null); setForm({ ...BLANK }); }} className={btnCls("primary", "lg", "mt-4")}>
          <Plus size={15} strokeWidth={2.4} /> Add a company
        </button>
      )}

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? "Edit company" : "Add a company"}
        subtitle={form?.id ? (editing ? companyName(editing) : undefined) : "Another company the shop bills under — its own name, BRN, VAT status and numbers"}
        footer={
          <div className="flex items-center gap-2">
            <button onClick={() => setForm(null)} className={btnCls("quiet", "lg")}>Cancel</button>
            <button
              onClick={() => form && save(toInput(form))}
              disabled={busy || !form || form.legal_name.trim() === ""}
              className={btnCls("primary", "lg", "px-5")}
            >
              {busy ? "Saving…" : form?.id ? "Save company" : "Add company"}
            </button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            <FormError error={error} />

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Legal name" hint="As registered — printed on its invoices">
                <input className={inputCls} value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} autoFocus />
              </Field>
              <Field label="Trading name" hint="The name customers know (optional)">
                <input className={inputCls} value={form.trading_name} onChange={(e) => set("trading_name", e.target.value)} />
              </Field>
              <Field label="BRN">
                <input className={inputCls} value={form.brn} onChange={(e) => set("brn", e.target.value)} />
              </Field>
              <Field label="VAT" hint={locked ? "Fixed — it has issued documents" : "A company not registered charges no VAT"}>
                <div className="flex h-10 items-center gap-2">
                  {([true, false] as const).map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      disabled={locked}
                      onClick={() => set("vat_registered", v)}
                      className={`h-9 rounded-[10px] px-3 text-[12.5px] font-bold ${form.vat_registered === v ? "grad-brand text-white" : "border border-line-2 bg-card text-body"} disabled:opacity-60`}
                    >
                      {v ? "VAT-registered" : "Not registered"}
                    </button>
                  ))}
                </div>
              </Field>
              {form.vat_registered && (
                <Field label="VAT number">
                  <input className={inputCls} value={form.vat_number} onChange={(e) => set("vat_number", e.target.value)} />
                </Field>
              )}
            </section>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Address" hint="Blank = the shop's address">
                <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Phone" hint="Blank = the shop's phone">
                <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Email" hint="Blank = the shop's email">
                <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Bank name" hint="Its own account — never the other company's">
                <input className={inputCls} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
              </Field>
              <Field label="Account name">
                <input className={inputCls} value={form.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} />
              </Field>
              <Field label="Account number">
                <input className={inputCls} value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} />
              </Field>
              <Field label="Receipt header" hint="Optional line above its receipts">
                <input className={inputCls} value={form.receipt_header_text} onChange={(e) => set("receipt_header_text", e.target.value)} />
              </Field>
              <Field label="Receipt footer" hint="Blank = the shop's footer">
                <input className={inputCls} value={form.receipt_footer_text} onChange={(e) => set("receipt_footer_text", e.target.value)} />
              </Field>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-ink-strong">
                {locked && <Lock size={12} />} Numbering
                <span className="font-medium text-faint">
                  {locked ? "— fixed: it has issued documents, and a series never restarts" : "— its own series; set the next number to continue a paper book"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {([
                  ["invoice", "Invoices", "e.g. WS-"],
                  ["quote", "Quotes", "e.g. WQ-"],
                  ["credit_note", "Credit notes", "e.g. WCN-"],
                ] as const).map(([k, label, ph]) => (
                  <div key={k} className="grid grid-cols-[1fr_88px] gap-2">
                    <Field label={`${label} prefix`}>
                      <input className={inputCls} value={form[`${k}_prefix`]} disabled={locked} placeholder={ph}
                        onChange={(e) => set(`${k}_prefix`, e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Next no.">
                      <input className={inputCls} inputMode="numeric" value={form[`${k}_next_number`]} disabled={locked}
                        onChange={(e) => set(`${k}_next_number`, e.target.value.replace(/\D/g, ""))} />
                    </Field>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
