"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { pointsValueCents } from "@/lib/points";
import { muDate } from "@/lib/mu-date";
import { settleAccountAction } from "./actions";
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

export interface SettleableInvoiceView {
  id: string;
  number: string | null;
  issueDate: string | null;
  outstandingCents: number;
}

/** Settle several open invoices in one action — the multi-invoice sibling of
 *  RecordPaymentForm, sharing its points-then-method building blocks. Mounted
 *  on both the Contacts customer page and the Reports statement page. */
export function SettleAccountPanel({
  customerId,
  invoices,
  pointsEnabled = true,
  pointsBalance = 0,
  pointValueRupees = 1,
}: {
  customerId: string;
  invoices: SettleableInvoiceView[];
  pointsEnabled?: boolean;
  pointsBalance?: number;
  pointValueRupees?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<string>("cash");
  const [pointsApplied, setPointsApplied] = useState(false);
  const [pointsText, setPointsText] = useState("");
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = invoices.filter((inv) => checked[inv.id]);
  const totalDueCents = selected.reduce((s, inv) => s + inv.outstandingCents, 0);
  const pointsCapCents = pointsEnabled ? Math.min(totalDueCents, pointsValueCents(pointsBalance, pointValueRupees)) : 0;
  const typedPointsCents = parseMoneyInput(pointsText) ?? 0;
  const pointsAppliedCents = pointsApplied ? Math.min(Math.max(typedPointsCents, 0), pointsCapCents) : 0;
  const methodDueCents = Math.max(totalDueCents - pointsAppliedCents, 0);
  const isCash = method === "cash";
  const tenderedCents = parseMoneyInput(tendered);
  const changeCents = isCash && tenderedCents != null ? tenderedCents - methodDueCents : null;

  function toggleInvoice(id: string) {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
    setError(null);
    setSuccess(null);
  }
  function selectAll() {
    setChecked(Object.fromEntries(invoices.map((inv) => [inv.id, true])));
    setError(null);
    setSuccess(null);
  }
  function togglePoints() {
    const next = !pointsApplied;
    setPointsApplied(next);
    if (next) setPointsText((pointsCapCents / 100).toFixed(2));
    setTendered("");
    setError(null);
  }
  function changePoints(next: string) {
    setPointsText(next);
    setTendered("");
    setError(null);
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (selected.length === 0) return setError("Select at least one invoice.");
    if (isCash && tenderedCents != null && tenderedCents < methodDueCents) return setError("Tendered is less than the amount due.");
    if (methodDueCents > 0 && !isCash && !ref.trim()) return setError("A card / Juice / bank payment needs a reference.");
    setBusy(true);

    const result = await settleAccountAction({
      customerId,
      invoiceIds: selected.map((inv) => inv.id),
      pointsAppliedCents,
      method: method as "cash" | "card" | "juice" | "bank_transfer",
      tenderedCents: isCash ? (tenderedCents ?? methodDueCents) : null,
      externalRef: isCash ? null : ref.trim(),
      settleKey: crypto.randomUUID(),
    });

    setBusy(false);
    if (result.ok) {
      setSuccess(`Settled ${result.settledCount} invoice${result.settledCount === 1 ? "" : "s"} for ${formatMUR(result.settledCents)}.`);
      setChecked({});
      setPointsApplied(false);
      setPointsText("");
      setTendered("");
      setRef("");
    } else {
      setError(result.error);
    }
    router.refresh(); // whatever DID settle should drop off the list either way
  }

  if (invoices.length === 0) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btn("ghost", "md")}>
        Settle account
      </button>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-bold text-ink">Settle account</p>
        <button onClick={() => setOpen(false)} className="text-[12px] font-semibold text-muted">✕</button>
      </div>

      <div className="mb-3 overflow-hidden rounded-[10px] border border-line-2">
        <div className="flex items-center justify-between border-b border-line-2 bg-sub px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-faint">
            {invoices.length} open invoice{invoices.length === 1 ? "" : "s"}
          </span>
          <button onClick={selectAll} className="text-[11.5px] font-semibold text-link hover:underline">Select all</button>
        </div>
        {invoices.map((inv) => (
          <label key={inv.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line-2 px-3 py-2 last:border-b-0 hover:bg-sub">
            <input type="checkbox" checked={!!checked[inv.id]} onChange={() => toggleInvoice(inv.id)} className="size-4" />
            <span className="num flex-1 text-[12px] font-semibold text-link">{inv.number ?? "—"}</span>
            <span className="num text-[11.5px] text-muted">{inv.issueDate ? muDate(`${inv.issueDate}T00:00:00+04:00`) : "—"}</span>
            <span className="num w-24 text-right text-[12.5px] font-bold text-ink">{formatMUR(inv.outstandingCents)}</span>
          </label>
        ))}
      </div>

      {selected.length > 0 && (
        <>
          <div className="mb-3 flex justify-between text-[13px]">
            <span className="font-semibold text-muted">Total due</span>
            <span className="num font-extrabold text-ink">{formatMUR(totalDueCents)}</span>
          </div>

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
                    ? `${formatMUR(pointsAppliedCents)} in points off this settlement`
                    : `${pointsBalance} pts available — worth ${formatMUR(pointsValueCents(pointsBalance, pointValueRupees))}`}
                </span>
                <span className="block text-[11.5px] text-muted">
                  {pointsApplied ? `${formatMUR(methodDueCents)} left to pay — click to undo` : "Click to choose how much of it to use"}
                </span>
              </span>
              <span className="text-[11px] font-bold tracking-[0.06em] text-link">{pointsApplied ? "APPLIED" : "APPLY"}</span>
            </button>
          )}

          {pointsApplied && (
            <div className="mb-3 rounded-[10px] border border-line-2 bg-sub p-3">
              <div className="flex items-end gap-2">
                <label className="block flex-1">
                  <span className={lbl}>Points to use (Rs)</span>
                  <input className={`${field} num text-right`} value={pointsText} onChange={(e) => changePoints(e.target.value)} inputMode="decimal" />
                </label>
                <button type="button" onClick={() => changePoints((pointsCapCents / 100).toFixed(2))} className={btn("ghost", "md")}>
                  Use all
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={lbl}>Method</span>
              <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <div className="block">
              <span className={lbl}>Amount due</span>
              <div className={`${field} num flex items-center justify-end text-body`}>{formatMUR(methodDueCents)}</div>
            </div>

            {isCash ? (
              <>
                <label className="block">
                  <span className={lbl}>Tendered (Rs)</span>
                  <input className={`${field} num text-right`} value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" placeholder={(methodDueCents / 100).toFixed(2)} />
                </label>
                <div className="block">
                  <span className={lbl}>Change</span>
                  <div className={`${field} num flex items-center justify-end ${changeCents != null && changeCents < 0 ? "text-rose" : "text-body"}`}>
                    {changeCents != null ? formatMUR(changeCents) : "—"}
                  </div>
                </div>
              </>
            ) : methodDueCents > 0 ? (
              <label className="col-span-2 block">
                <span className={lbl}>External reference</span>
                <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Terminal / transaction ref" />
              </label>
            ) : null}
          </div>

          {error && <p className="mt-3 text-[12px] text-rose">{error}</p>}
          {success && <p className="mt-3 text-[12px] font-semibold text-mint">{success}</p>}

          <button onClick={submit} disabled={busy || selected.length === 0} className={btn("primary", "md", "mt-4 w-full")}>
            {busy
              ? "Settling…"
              : pointsAppliedCents > 0 && methodDueCents > 0
                ? `Settle ${formatMUR(methodDueCents)} + ${formatMUR(pointsAppliedCents)} in points`
                : pointsAppliedCents > 0
                  ? `Settle ${formatMUR(pointsAppliedCents)} in points`
                  : `Settle ${formatMUR(totalDueCents)}`}
          </button>
        </>
      )}
    </div>
  );
}
