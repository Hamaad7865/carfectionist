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
  // The most this balance can put against THIS bill: never more than what is actually
  // owed, and never more than the balance is worth.
  const pointsCapCents = customerId ? Math.min(outstandingCents, pointsValueCents(pointsBalance, pointValueRupees)) : 0;

  const [method, setMethod] = useState<string>("cash");
  const [pointsApplied, setPointsApplied] = useState(false);
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payKey, setPayKey] = useState(() => crypto.randomUUID()); // per-payment; rotates after each success

  /**
   * POINTS ARE NOT A MEANS OF PAYMENT. They used to sit in this dropdown beside Cash
   * and Card, which made them a rival to those methods: to spend Rs 5.00 against a
   * Rs 1,282.49 bill you picked Points, took Rs 5.00, then came back round for the
   * rest. Nobody thinks about a balance that way — a voucher comes off the total and
   * you pay whatever is left, however you like.
   *
   * Underneath they are still a TENDER, not a discount: the bill total and its VAT
   * never move, and spend_points debits the ledger server-side. Applying here only
   * arms them; nothing is taken until Record.
   */
  const pointsAppliedCents = pointsApplied ? pointsCapCents : 0;
  const dueAfterPointsCents = Math.max(outstandingCents - pointsAppliedCents, 0);

  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const amountCents = parseMoneyInput(amount) ?? 0;
  const tenderedCents = parseMoneyInput(tendered);
  const changeCents = method === "cash" && tenderedCents != null ? tenderedCents - amountCents : null;
  const isCash = method === "cash";

  // Applying or removing points changes what this method has to cover, so the typed
  // figure is reset rather than left showing the old one while the button takes a
  // different number.
  function togglePoints() {
    const next = !pointsApplied;
    setPointsApplied(next);
    setAmount((Math.max(outstandingCents - (next ? pointsCapCents : 0), 0) / 100).toFixed(2));
    setTendered("");
    setError(null);
  }

  async function submit() {
    setError(null);
    if (amountCents <= 0 && pointsAppliedCents <= 0) return setError("Enter an amount greater than zero.");
    if (isCash && tenderedCents != null && tenderedCents < amountCents) return setError("Tendered is less than the amount.");
    if (amountCents > 0 && !isCash && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    setBusy(true);

    // Points lead. Debiting the ledger before the rest of the money lands means a
    // half-finished settle can never leave cash taken against points that were not —
    // and if the balance moved since this page loaded, spend_points refuses with its
    // own "not enough points: N needed, M available", shown below unmodified.
    if (pointsAppliedCents > 0) {
      const p = await recordPaymentAction({
        invoiceId,
        method: "points",
        amountCents: pointsAppliedCents,
        tenderedCents: null,
        // The ledger row IS the reference for points, same as record_payment's own
        // points branch — an external ref only means something for card/Juice/bank.
        externalRef: null,
        idempotencyKey: `${payKey}-points`,
      });
      if (!p.ok) {
        setBusy(false);
        return setError(p.error);
      }
    }

    // Whatever the chosen method still has to cover. Zero when the points settled the
    // bill outright, in which case there is nothing left to record.
    if (amountCents > 0) {
      const res = await recordPaymentAction({
        invoiceId,
        method: method as "cash" | "card" | "juice" | "bank_transfer",
        amountCents,
        tenderedCents: isCash ? (tenderedCents ?? amountCents) : null,
        externalRef: isCash ? null : ref.trim(),
        idempotencyKey: `${payKey}-rest`,
      });
      if (!res.ok) {
        setBusy(false);
        // Say plainly that the points DID go through, so nobody re-applies them
        // believing nothing happened and spends the balance twice.
        return setError(
          pointsAppliedCents > 0
            ? `${formatMUR(pointsAppliedCents)} in points was taken, but the rest failed: ${res.error}`
            : res.error,
        );
      }
    }

    setBusy(false);
    setTendered("");
    setRef("");
    setPointsApplied(false);
    setPayKey(crypto.randomUUID()); // fresh key for the next (split) payment
    router.refresh();
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <p className="mb-3 text-[13px] font-bold text-ink">Record payment</p>

      {/* Points come off the total; the method below settles what is left. Shown only
          when a named customer actually has some and the bill has something to put
          them against. Tapping arms them — nothing is taken until Record. */}
      {pointsCapCents > 0 && (
        <button
          type="button"
          onClick={togglePoints}
          className={`mb-3 flex w-full items-center justify-between rounded-[10px] border px-3 py-2.5 text-left ${
            pointsApplied ? "border-link bg-[rgba(43,140,255,0.08)]" : "border-line-2 bg-sub"
          }`}
        >
          <span>
            <span className="block text-[12.5px] font-bold text-ink">
              {pointsApplied
                ? `${formatMUR(pointsAppliedCents)} in points off this bill`
                : `${pointsBalance} pts available — worth ${formatMUR(pointsValueCents(pointsBalance, pointValueRupees))}`}
            </span>
            <span className="block text-[11.5px] text-muted">
              {pointsApplied
                ? `${formatMUR(dueAfterPointsCents)} left to pay — click to undo`
                : `Click to take ${formatMUR(pointsCapCents)} off, then pay the rest`}
            </span>
          </span>
          <span className="text-[11px] font-bold tracking-[0.06em] text-link">{pointsApplied ? "APPLIED" : "APPLY"}</span>
        </button>
      )}

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
        {busy
          ? "Recording…"
          : pointsAppliedCents > 0 && amountCents > 0
            ? `Record ${formatMUR(amountCents)} + ${formatMUR(pointsAppliedCents)} in points`
            : pointsAppliedCents > 0
              ? `Record ${formatMUR(pointsAppliedCents)} in points`
              : `Record ${formatMUR(amountCents)}`}
      </button>
    </div>
  );
}
