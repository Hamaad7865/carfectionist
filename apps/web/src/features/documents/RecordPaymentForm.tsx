"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { recordPaymentAction } from "./actions";
import { btn } from "@/components/ui/button";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "juice", label: "Juice" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

const field =
  "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

export function RecordPaymentForm({ invoiceId, outstandingCents }: { invoiceId: string; outstandingCents: number }) {
  const router = useRouter();
  const [method, setMethod] = useState<string>("cash");
  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payKey, setPayKey] = useState(() => crypto.randomUUID()); // per-payment; rotates after each success

  const amountCents = parseMoneyInput(amount) ?? 0;
  const tenderedCents = parseMoneyInput(tendered);
  const changeCents = method === "cash" && tenderedCents != null ? tenderedCents - amountCents : null;
  const isCash = method === "cash";

  async function submit() {
    setError(null);
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (isCash && tenderedCents != null && tenderedCents < amountCents) return setError("Tendered is less than the amount.");
    if (!isCash && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    setBusy(true);
    const res = await recordPaymentAction({
      invoiceId,
      method: method as "cash" | "card" | "juice" | "bank_transfer",
      amountCents,
      tenderedCents: isCash ? (tenderedCents ?? amountCents) : null,
      externalRef: isCash ? null : ref.trim(),
      idempotencyKey: payKey,
    });
    setBusy(false);
    if (res.ok) {
      setTendered("");
      setRef("");
      setPayKey(crypto.randomUUID()); // fresh key for the next (split) payment
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <p className="mb-3 text-[13px] font-bold text-ink">Record payment</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={lbl}>Method</span>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Amount (Rs)</span>
          <input className={`${field} num text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>

        {isCash ? (
          <>
            <label className="block">
              <span className={lbl}>Tendered (Rs)</span>
              <input className={`${field} num text-right`} value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" placeholder={(amountCents / 100).toFixed(2)} />
            </label>
            <div className="block">
              <span className={lbl}>Change</span>
              <div className={`${field} num flex items-center justify-end ${changeCents != null && changeCents < 0 ? "text-rose" : "text-body"}`}>
                {changeCents != null ? formatMUR(changeCents) : "—"}
              </div>
            </div>
          </>
        ) : (
          <label className="col-span-2 block">
            <span className={lbl}>External reference</span>
            <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Terminal / transaction ref" />
          </label>
        )}
      </div>

      {error && <p className="mt-3 text-[12px] text-rose">{error}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className={btn("primary", "md", "mt-4 w-full")}
      >
        {busy ? "Recording…" : `Record ${formatMUR(amountCents)}`}
      </button>
    </div>
  );
}
