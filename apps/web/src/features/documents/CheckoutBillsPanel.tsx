"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { btn } from "@/components/ui/button";
import { useWhatsApp } from "@/components/shell/ShopFeatures";
import { StatusPill } from "@/components/ui/StatusPill";
import { entityColours } from "@/lib/tyrecentre/entity-colours";
import type { CheckoutBill } from "@/lib/supabase/queries/checkout";
import { recordCheckoutPaymentAction, sendCheckoutBillsAction } from "./actions";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "juice", label: "Juice" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
] as const;
type Method = (typeof METHODS)[number]["value"];

const field = "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

/** A two-company sale (tyre centre) on the page of one of its bills: every company's bill, one
 *  payment for all of them with the owner's pay order for a part payment, and sending them all. */
export function CheckoutBillsPanel({
  currentId,
  bills,
  customerEmail,
  customerPhone,
}: {
  currentId: string;
  bills: CheckoutBill[];
  customerEmail: string | null;
  customerPhone: string | null;
}) {
  const router = useRouter();
  const whatsapp = useWhatsApp();
  const open = bills.filter((b) => b.docType === "invoice" && b.outstandingCents > 0 && (b.status === "issued" || b.status === "partly_paid"));
  const owedCents = open.reduce((s, b) => s + b.outstandingCents, 0);
  const [amount, setAmount] = useState(() => (owedCents / 100).toFixed(2));
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [allocation, setAllocation] = useState("proportional");
  const [busy, setBusy] = useState<"pay" | "email" | "whatsapp" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [payKey, setPayKey] = useState(() => crypto.randomUUID());

  const amountCents = parseMoneyInput(amount) ?? 0;
  const part = amountCents > 0 && amountCents < owedCents;
  const issued = bills.filter((b) => b.number);
  const noun = bills[0]?.docType === "quote" ? "quote" : "bill";

  async function collect() {
    setMsg(null);
    if (amountCents <= 0) return setMsg({ ok: false, text: "Enter the amount received." });
    if (amountCents > owedCents) return setMsg({ ok: false, text: `That is more than the ${formatMUR(owedCents)} owed on this sale.` });
    const tenderedCents = method === "cash" ? parseMoneyInput(tendered) : null;
    if (tenderedCents != null && tenderedCents < amountCents) return setMsg({ ok: false, text: "The cash handed over is less than the amount." });
    setBusy("pay");
    try {
      const r = await recordCheckoutPaymentAction({
        invoiceIds: open.map((b) => b.id),
        method,
        amountCents,
        tenderedCents,
        externalRef: ref || null,
        allocation: part ? allocation : "proportional",
        idempotencyKey: payKey,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setPayKey(crypto.randomUUID());
      const change = tenderedCents != null ? tenderedCents - amountCents : 0;
      setMsg({ ok: true, text: `${formatMUR(amountCents)} recorded across ${open.length} bills${change > 0 ? ` — give ${formatMUR(change)} change` : ""}.` });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendAll(channel: "email" | "whatsapp") {
    const to = channel === "email" ? customerEmail : customerPhone;
    if (!to) return;
    setMsg(null);
    setBusy(channel);
    try {
      const r = await sendCheckoutBillsAction({ documentIds: issued.map((b) => b.id), channel, to });
      setMsg(r.ok ? { ok: true, text: `${r.sent} ${noun}s sent to ${to}.` } : { ok: false, text: `${r.sent ? `${r.sent} sent, then: ` : ""}${r.error}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[15px] border border-line bg-card p-4 text-[13px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">This sale · {bills.length} {noun}s</div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {bills.map((b) => (
          <li key={b.id} className="flex items-center gap-2.5">
            <span className="size-3 shrink-0 rounded-[3px]" style={{ background: entityColours(b.index).accent }} />
            {b.id === currentId ? (
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {b.companyName} · <span className="num">{b.number ?? "draft"}</span> <span className="font-normal text-faint">(this one)</span>
              </span>
            ) : (
              <Link href={`/sales/${b.id}`} className="min-w-0 flex-1 truncate text-link hover:underline">
                {b.companyName} · <span className="num">{b.number ?? "draft"}</span>
              </Link>
            )}
            <StatusPill status={b.status} />
            <span className="num shrink-0 text-ink">{formatMUR(b.totalCents)}</span>
          </li>
        ))}
      </ul>

      {issued.length > 1 && (customerEmail || customerPhone) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="flex-1 text-[12px] text-muted">Send every {noun} of this sale</span>
          {customerEmail && (
            <button type="button" onClick={() => void sendAll("email")} disabled={!!busy} className={btn("ghost", "sm")}>
              {busy === "email" ? "Sending…" : "Email all"}
            </button>
          )}
          {whatsapp && customerPhone && (
            <button type="button" onClick={() => void sendAll("whatsapp")} disabled={!!busy} className={btn("ghost", "sm")}>
              {busy === "whatsapp" ? "Sending…" : "WhatsApp all"}
            </button>
          )}
        </div>
      )}

      {open.length > 1 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-bold text-ink">Collect for the whole sale</span>
            <span className="num text-[12.5px] text-amber-ink">{formatMUR(owedCents)} owed</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              <span className={lbl}>Amount (Rs)</span>
              <input className={`${field} num text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              <span className={lbl}>Method</span>
              <select className={field} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            {method === "cash" ? (
              <label className="col-span-2">
                <span className={lbl}>Cash handed over (optional)</span>
                <input className={`${field} num text-right`} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} />
              </label>
            ) : (
              <label className="col-span-2">
                <span className={lbl}>Reference (optional)</span>
                <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} />
              </label>
            )}
          </div>
          {part && (
            <fieldset className="mt-2.5">
              <legend className={lbl}>Part payment — which bill is paid first</legend>
              <div className="flex flex-wrap gap-1.5">
                {[...open.map((b) => ({ value: b.legalEntityId, label: `${b.companyName} first` })), { value: "proportional", label: "Both, shared" }].map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setAllocation(o.value)}
                    aria-pressed={allocation === o.value}
                    className={`h-8 rounded-full px-3 text-[12px] font-semibold ${allocation === o.value ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button type="button" onClick={() => void collect()} disabled={!!busy} className={`${btn("primary", "md")} mt-3 w-full`}>
            {busy === "pay" ? "Recording…" : `Record ${amountCents > 0 ? formatMUR(amountCents) : "payment"}`}
          </button>
        </div>
      )}

      {msg && <p className={`mt-2.5 text-[12.5px] font-semibold ${msg.ok ? "text-mint" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}
