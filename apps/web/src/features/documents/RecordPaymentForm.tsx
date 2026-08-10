"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { pointsValueCents } from "@/lib/points";
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

export function RecordPaymentForm({
  invoiceId,
  outstandingCents,
  customerId = null,
  pointsBalance = 0,
  pointValueRupees = 1,
}: {
  invoiceId: string;
  outstandingCents: number;
  /** The Points tender only offers itself on a bill that names a customer — spend_points
   *  refuses outright otherwise ("a points payment needs a customer on the bill", 20260811000040). */
  customerId?: string | null;
  pointsBalance?: number;
  pointValueRupees?: number;
}) {
  const router = useRouter();
  // The most this balance can put against THIS bill: never more than what is actually
  // owed, and never more than the balance is worth.
  const pointsCapCents = customerId ? Math.min(outstandingCents, pointsValueCents(pointsBalance, pointValueRupees)) : 0;
  const methods = customerId ? [...METHODS, { value: "points", label: "Points" } as const] : METHODS;

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
  const isPoints = method === "points";

  // Switching to/from Points resets the amount to a sane default instead of leaving
  // whatever the previous method showed — an outstanding-sized figure is routinely
  // more than the points on offer, and vice versa.
  function chooseMethod(next: string) {
    setMethod(next);
    setAmount(((next === "points" ? pointsCapCents : outstandingCents) / 100).toFixed(2));
  }

  async function submit() {
    setError(null);
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (isCash && tenderedCents != null && tenderedCents < amountCents) return setError("Tendered is less than the amount.");
    if (!isCash && !isPoints && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    // A fast, local fail for "typed more than is on offer" — the server (spend_points)
    // is still the authority and answers with its own "not enough points: N needed, M
    // available" if the balance moved since this page loaded; that message is shown
    // verbatim below, unmodified.
    if (isPoints && amountCents > pointsCapCents) return setError(`Points can cover up to ${formatMUR(pointsCapCents)} of this bill.`);
    setBusy(true);
    const res = await recordPaymentAction({
      invoiceId,
      method: method as "cash" | "card" | "juice" | "bank_transfer" | "points",
      amountCents,
      tenderedCents: isCash ? (tenderedCents ?? amountCents) : null,
      // The ledger row IS the reference for points, same as record_payment's own
      // points branch — an external ref only means something for card, Juice and a
      // bank transfer.
      externalRef: isCash || isPoints ? null : ref.trim(),
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
          <select className={field} value={method} onChange={(e) => chooseMethod(e.target.value)}>
            {methods.map((m) => (
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

        {isPoints ? (
          <div className="col-span-2 flex items-center justify-between rounded-[10px] border border-line-2 bg-sub px-3 py-2 text-[12px] text-body">
            <span>
              Balance <b className="num">{pointsBalance} pts</b>
            </span>
            <span>
              Worth <b className="num">{formatMUR(pointsValueCents(pointsBalance, pointValueRupees))}</b>
            </span>
          </div>
        ) : isCash ? (
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
