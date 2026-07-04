"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { recordPaymentAction } from "./actions";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "juice", label: "Juice" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

const field =
  "h-9 w-full rounded-md border border-graphite-700 bg-graphite-850 px-2.5 text-[13px] text-graphite-100 outline-none focus:border-teal";

export function RecordPaymentForm({ invoiceId, outstandingCents }: { invoiceId: string; outstandingCents: number }) {
  const router = useRouter();
  const [method, setMethod] = useState<string>("cash");
  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountCents = parseMoneyInput(amount) ?? 0;
  const tenderedCents = parseMoneyInput(tendered);
  const changeCents = method === "cash" && tenderedCents != null ? tenderedCents - amountCents : null;
  const isCash = method === "cash";

  async function submit() {
    setError(null);
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (!isCash && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    setBusy(true);
    const res = await recordPaymentAction({
      invoiceId,
      method: method as "cash" | "card" | "juice" | "bank_transfer",
      amountCents,
      tenderedCents: isCash ? (tenderedCents ?? amountCents) : null,
      externalRef: isCash ? null : ref.trim(),
    });
    setBusy(false);
    if (res.ok) {
      setTendered("");
      setRef("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="rounded-lg border border-graphite-700 bg-graphite-900 p-4">
      <p className="mb-3 text-[13px] font-medium text-graphite-100">Record payment</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-graphite-500">Method</span>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-graphite-500">Amount (Rs)</span>
          <input className={`${field} num text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>

        {isCash ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-graphite-500">Tendered (Rs)</span>
              <input
                className={`${field} num text-right`}
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                inputMode="decimal"
                placeholder={(amountCents / 100).toFixed(2)}
              />
            </label>
            <div className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-graphite-500">Change</span>
              <div className={`${field} num flex items-center justify-end ${changeCents != null && changeCents < 0 ? "text-danger" : "text-graphite-300"}`}>
                {changeCents != null ? formatMUR(changeCents) : "—"}
              </div>
            </div>
          </>
        ) : (
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-graphite-500">External reference</span>
            <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Terminal / transaction ref" />
          </label>
        )}
      </div>

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="mt-4 h-9 w-full rounded-md bg-teal text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright disabled:opacity-60"
      >
        {busy ? "Recording…" : `Record ${formatMUR(amountCents)}`}
      </button>
    </div>
  );
}
