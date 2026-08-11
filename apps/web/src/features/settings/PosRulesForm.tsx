"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Percent, RotateCcw, Boxes } from "lucide-react";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { btn } from "@/components/ui/button";
import { savePosRulesAction } from "./pos-rules-actions";
import type { PosRulesSettings } from "@/lib/supabase/queries/pos-rules";

type RForm = {
  carwashPct: string;
  defaultPolicyService: "none" | "carwash" | "free";
  defaultPolicyGoods: "none" | "carwash" | "free";
  defaultOpeningFloat: string;
  allowNegativeStock: boolean;
  reversalRequiresOwner: boolean;
};

const seed = (r: PosRulesSettings): RForm => ({
  carwashPct: String(r.carwashPct),
  defaultPolicyService: r.defaultPolicyService,
  defaultPolicyGoods: r.defaultPolicyGoods,
  defaultOpeningFloat: String(r.defaultOpeningFloat),
  allowNegativeStock: r.allowNegativeStock,
  reversalRequiresOwner: r.reversalRequiresOwner,
});

// Module scope, not declared during render — a component TYPE created inside the
// form remounts its whole subtree every pass (react-hooks/static-components). Same
// pattern as BusinessProfileForm's Section.
const Section = ({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) => (
  <div className="rounded-[15px] border border-line bg-card p-5">
    <div className="mb-1 flex items-center gap-2 font-display text-[14px] font-bold text-ink-strong">{icon}{title}</div>
    <div className="mb-4 text-[11.5px] text-faint">{hint}</div>
    <div className="flex flex-col gap-3">{children}</div>
  </div>
);

const POLICY_OPTIONS = [
  { value: "none", label: "No discount" },
  { value: "carwash", label: "Carwash — up to the cap, with a reason" },
  { value: "free", label: "No limit" },
] as const;

function Toggle({ on, onToggle, label, onText, offText }: { on: boolean; onToggle: () => void; label: string; onText: string; offText: string }) {
  return (
    <div className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3">
      <div>
        <div className="text-[12.5px] font-semibold text-body">{label}</div>
        <div className="text-[11px] text-faint">{on ? onText : offText}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-mint" : "bg-line-2"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function PosRulesForm({ rules }: { rules: PosRulesSettings }) {
  const router = useRouter();
  const [f, setF] = useState<RForm>(() => seed(rules));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof RForm>(k: K, v: RForm[K]) => { setF((s) => ({ ...s, [k]: v })); setSaved(false); };

  async function save() {
    setError(null);
    setBusy(true);
    const r = await savePosRulesAction(f);
    setBusy(false);
    if (r.ok) {
      // Show what was actually persisted: an out-of-range cap or float snaps server-side,
      // and the box must not keep displaying the rejected input beside "Saved".
      setF({
        carwashPct: String(r.saved.carwashPct),
        defaultPolicyService: r.saved.defaultPolicyService,
        defaultPolicyGoods: r.saved.defaultPolicyGoods,
        defaultOpeningFloat: String(r.saved.defaultOpeningFloat),
        allowNegativeStock: r.saved.allowNegativeStock,
        reversalRequiresOwner: r.saved.reversalRequiresOwner,
      });
      setSaved(true);
      router.refresh();
    } else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError error={error} />

      <Section icon={<Percent size={15} />} title="Discounts" hint="What each kind of line may be discounted, and how far a carwash may go.">
        <Field label="Carwash cap %" hint="The most a carwash line may be discounted, with a reason">
          <input className={inputCls} value={f.carwashPct} onChange={(e) => set("carwashPct", e.target.value)} inputMode="decimal" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default for services" hint="When a service has no policy of its own">
            <select className={inputCls} value={f.defaultPolicyService} onChange={(e) => set("defaultPolicyService", e.target.value as RForm["defaultPolicyService"])}>
              {POLICY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Default for products" hint="When a product has no policy of its own">
            <select className={inputCls} value={f.defaultPolicyGoods} onChange={(e) => set("defaultPolicyGoods", e.target.value as RForm["defaultPolicyGoods"])}>
              {POLICY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-faint">A single item can always override its default — set that on the product itself under Products.</p>
      </Section>

      <Section icon={<Boxes size={15} />} title="Till & stock" hint="Defaults the tablet till reads when a cashier opens a drawer or sells a low item.">
        <Field label="Default opening float (Rs)" hint="Prefilled when a cashier opens the till">
          <input className={inputCls} value={f.defaultOpeningFloat} onChange={(e) => set("defaultOpeningFloat", e.target.value)} inputMode="decimal" />
        </Field>
        <Toggle
          on={f.allowNegativeStock}
          onToggle={() => set("allowNegativeStock", !f.allowNegativeStock)}
          label="Sell into negative stock"
          onText="A low item can still be sold, after a confirm"
          offText="A sale is blocked once an item hits zero on hand"
        />
      </Section>

      <Section icon={<RotateCcw size={15} />} title="Reversals" hint="Who may put money back in a customer's hand.">
        <Toggle
          on={f.reversalRequiresOwner}
          onToggle={() => set("reversalRequiresOwner", !f.reversalRequiresOwner)}
          label="Only an owner may reverse"
          onText="A manager cannot reverse, even with an owner's PIN"
          offText="A manager may reverse with an owner's PIN override"
        />
      </Section>

      <div className="flex items-center justify-between rounded-[13px] border border-line bg-sub px-5 py-3">
        <div className="text-[12px] text-muted">Loyalty points and the default VAT rate live under <span className="font-semibold text-body">Business profile</span>.</div>
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
