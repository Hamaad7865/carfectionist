"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveBusinessProfileAction } from "./business-actions";
import type { BusinessProfile } from "@/lib/supabase/queries/settings";
import { btn } from "@/components/ui/button";

type BForm = {
  legalName: string; tradingName: string; brn: string; vatNumber: string;
  email: string; phone: string; address: string;
  bankAccountName: string; bankAccountNumber: string; bankName: string; vatRate: string;
};
const seed = (b: BusinessProfile): BForm => ({
  legalName: b.legalName ?? "",
  tradingName: b.tradingName ?? "",
  brn: b.brn ?? "",
  vatNumber: b.vatNumber ?? "",
  email: b.email ?? "",
  phone: b.phone ?? "",
  address: b.address ?? "",
  bankAccountName: b.bankAccountName ?? "",
  bankAccountNumber: b.bankAccountNumber ?? "",
  bankName: b.bankName ?? "",
  vatRate: String(b.vatRate),
});

export function BusinessProfileForm({ profile }: { profile: BusinessProfile }) {
  const router = useRouter();
  const [f, setF] = useState<BForm>(() => seed(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof BForm) => (e: React.ChangeEvent<HTMLInputElement>) => { setF((s) => ({ ...s, [k]: e.target.value })); setSaved(false); };

  async function save() {
    setError(null);
    setBusy(true);
    const r = await saveBusinessProfileAction(f);
    setBusy(false);
    if (r.ok) { setSaved(true); router.refresh(); } else setError(r.error);
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-[15px] border border-line bg-card p-5">
      <div className="mb-4 font-display text-[14px] font-bold text-ink-strong">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <FormError error={error} />

      <Section title="Identity">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Legal name"><input className={inputCls} value={f.legalName} onChange={set("legalName")} /></Field>
          <Field label="Trading name"><input className={inputCls} value={f.tradingName} onChange={set("tradingName")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="BRN"><input className={inputCls} value={f.brn} onChange={set("brn")} /></Field>
          <Field label="VAT number"><input className={inputCls} value={f.vatNumber} onChange={set("vatNumber")} /></Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={set("address")} /></Field>
      </Section>

      <Section title="Bank details (shown on documents)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account name"><input className={inputCls} value={f.bankAccountName} onChange={set("bankAccountName")} /></Field>
          <Field label="Account number"><input className={inputCls} value={f.bankAccountNumber} onChange={set("bankAccountNumber")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank"><input className={inputCls} value={f.bankName} onChange={set("bankName")} /></Field>
          <Field label="VAT rate %" hint="Default tax rate on lines"><input className={inputCls} value={f.vatRate} onChange={set("vatRate")} inputMode="decimal" /></Field>
        </div>
      </Section>

      <div className="flex items-center justify-between rounded-[13px] border border-line bg-sub px-5 py-3">
        <div className="text-[12px] text-muted">
          Numbering: <span className="num font-semibold text-body">{profile.quoteSeries}</span> · <span className="num font-semibold text-body">{profile.invoiceSeries}</span>
          <span className="ml-2 text-faint">(managed automatically)</span>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-[12px] font-semibold text-mint">Saved</span>}
          <button onClick={save} disabled={busy} className={btn("primary", "lg", "px-5")}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
