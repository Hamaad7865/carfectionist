"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Minus, Plus, X, Printer, MessageCircle, Download, ArrowRight, ShoppingCart } from "lucide-react";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import { formatMUR, computeTotals, computeLineTotals, parseMoneyInput } from "@/lib/money";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";
import { counterSaleAction, type CounterResult } from "./actions";
import { getReceiptDataAction } from "./receipt-action";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";

const KIND_LABEL: Record<string, string> = { service: "Service", consumable: "Consumable", product: "Product" };
const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "juice", label: "Juice" },
  { key: "bank_transfer", label: "Bank" },
  { key: "credit", label: "Credit" },
] as const;
type Method = (typeof METHODS)[number]["key"];

interface CartLine { product: CounterProduct; qty: number; discountKind?: "percent" | "amount"; discountPct?: number; discountAmountCents?: number }

export function CounterSale({ products, customers }: { products: CounterProduct[]; customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscKind, setOrderDiscKind] = useState<"percent" | "amount" | null>(null);
  const [orderDiscValue, setOrderDiscValue] = useState(0);
  const [customer, setCustomer] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("cash");
  const [tender, setTender] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CounterResult, { ok: true }> | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptError, setReceiptError] = useState(false);
  const [saleKey, setSaleKey] = useState(() => crypto.randomUUID()); // stable per sale, rotates on reset

  // Pull the authoritative receipt for the completed sale so the panel shows
  // exactly what prints. The Print / PDF / share actions work regardless, so a
  // failed preview is non-fatal — just surface it instead of spinning forever.
  useEffect(() => {
    if (!done) { setReceipt(null); setReceiptError(false); return; }
    let live = true;
    getReceiptDataAction(done.invoiceId)
      .then((r) => { if (live) { if (r) setReceipt(r); else setReceiptError(true); } })
      .catch(() => { if (live) setReceiptError(true); });
    return () => { live = false; };
  }, [done]);

  function newKey() {
    setSaleKey(crypto.randomUUID());
  }

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) => (!cat || p.category === cat) && (!s || p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s)),
    );
  }, [q, cat, products]);

  const totals = useMemo(
    () => computeTotals(
      cart.map((l) => ({ qty: l.qty, unitCents: l.product.priceCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.product.vatRate })),
      orderDiscKind ? { kind: orderDiscKind, value: orderDiscValue } : null,
    ),
    [cart, orderDiscKind, orderDiscValue],
  );

  const custMatches = useMemo(() => {
    const s = customer.trim().toLowerCase();
    return s && !customerId ? customers.filter((c) => c.name.toLowerCase().includes(s)).slice(0, 6) : [];
  }, [customer, customerId, customers]);

  function add(p: CounterProduct) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) { const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + 1 }; return next; }
      return [...c, { product: p, qty: 1 }];
    });
  }
  function setQty(id: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))));
  }
  function patchLine(id: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }

  const tenderCents = parseMoneyInput(tender);
  const changeCents = method === "cash" && tenderCents != null ? tenderCents - totals.totalCents : null;

  async function complete() {
    setError(null);
    if (cart.length === 0) return setError("Add at least one product.");
    if (method === "credit" && !customerId) return setError("Pick an existing customer for a credit sale — the amount owed is tracked against them.");
    if (method === "cash" && tenderCents != null && tenderCents < totals.totalCents) return setError("Tendered is less than the total.");
    setBusy(true);
    const r = await counterSaleAction({
      customerId: customerId ?? undefined,
      customerName: customer.trim() || undefined,
      lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty, discountKind: l.discountKind, discountPct: l.discountPct, discountAmountCents: l.discountAmountCents })),
      orderDiscountKind: orderDiscKind,
      orderDiscountValue: orderDiscValue,
      method,
      tenderedCents: method === "cash" ? tenderCents : null,
      externalRef: method === "cash" ? undefined : ref,
      idempotencyKey: saleKey,
    });
    setBusy(false);
    if (r.ok) setDone(r);
    else setError(r.error);
  }

  function reset() {
    setCart([]); setCustomer(""); setCustomerId(null); setTender(""); setRef(""); setMethod("cash"); setDone(null); setError(null); setQ("");
    setOrderDiscKind(null); setOrderDiscValue(0); // never carry a discount into the next ticket
    newKey();
    router.refresh();
  }

  if (done) {
    const custName = customer.trim() || "Walk-in customer";
    const methodName = METHODS.find((m) => m.key === method)?.label ?? method;
    const bigCents = done.onAccount ? done.totalCents : done.changeCents > 0 ? done.changeCents : done.totalCents;
    const bigLabel = done.onAccount ? "On account" : done.changeCents > 0 ? "Change due" : "Paid";
    const subtitle = done.onAccount
      ? `${formatMUR(done.totalCents)} owed by ${custName}`
      : method === "cash"
        ? `Paid in cash by ${custName}${done.changeCents > 0 ? ` · change ${formatMUR(done.changeCents)}` : ""}`
        : `Paid by ${methodName} · ${custName}`;
    const shareWhatsApp = () => {
      const text = [
        `${receipt?.studioName ?? "Carfectionist"} — Receipt ${done.number ?? ""}`.trim(),
        `Total: ${formatMUR(done.totalCents)}`,
        "Thank you for your visit!",
      ].join("\n");
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    };

    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <style>{`@keyframes receiptSlide{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}`}</style>

        {/* Confirmation + actions */}
        <div className="rounded-[18px] border border-line bg-card p-6 sm:p-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">{done.number ?? "Invoice"} · Counter 01</div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[rgba(13,167,124,0.12)] px-3 py-1">
            <span className="size-2 rounded-full bg-mint" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-mint">{done.onAccount ? "Recorded on account" : "Payment confirmed"}</span>
          </div>

          <div className="mt-5 text-[11px] font-bold uppercase tracking-wide text-faint">{bigLabel}</div>
          <div className="num mt-1 text-[46px] font-extrabold leading-none text-ink-strong">{formatMUR(bigCents)}</div>
          <div className="mt-2 text-[13px] text-muted">{subtitle}</div>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <button onClick={() => window.open(`/print/receipt/${done.invoiceId}`, "_blank")} className="grad-brand shadow-brand inline-flex h-11 items-center gap-2 rounded-[12px] px-5 text-[14px] font-bold text-white">
              <Printer size={17} /> Print receipt
            </button>
            <button onClick={shareWhatsApp} className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line-2 bg-sub px-4 text-[13.5px] font-bold text-body hover:border-brand">
              <MessageCircle size={16} /> SMS / WhatsApp
            </button>
            <a href={`/api/documents/${done.invoiceId}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line-2 bg-sub px-4 text-[13.5px] font-bold text-body hover:border-brand">
              <Download size={16} /> PDF
            </a>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-[14px] border border-line bg-sub px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(43,140,255,0.1)] text-link"><ShoppingCart size={17} /></div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-body">New ticket ready</div>
                <div className="truncate text-[11.5px] text-muted">Start the next walk-in sale</div>
              </div>
            </div>
            <button onClick={reset} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] bg-ink px-4 text-[13px] font-bold text-white">
              Start <ArrowRight size={15} />
            </button>
          </div>

          <Link href={`/sales/${done.invoiceId}`} className="mt-4 inline-block text-[12.5px] font-semibold text-link">View invoice →</Link>
        </div>

        {/* Receipt */}
        <div className="flex items-start justify-center rounded-[18px] border border-line p-5" style={{ background: "#ece5d8" }}>
          {receipt ? (
            <div style={{ animation: "receiptSlide .45s cubic-bezier(.2,.8,.2,1)" }}>
              <ReceiptCard r={receipt} />
            </div>
          ) : receiptError ? (
            <div className="py-24 text-center text-[12.5px] text-faint">Receipt preview unavailable.<br />Print / PDF still work.</div>
          ) : (
            <div className="py-24 text-[12.5px] text-faint">Preparing receipt…</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      {/* catalogue */}
      <div className="flex flex-col rounded-[15px] border border-line bg-card">
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className="h-11 w-full rounded-[11px] border border-line-2 bg-sub pl-9 pr-3 text-[14px] text-ink outline-none focus:border-brand"
              placeholder="Search products or scan a barcode…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          {categories.length > 0 && (
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
              <button
                onClick={() => setCat("")}
                className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold ${cat === "" ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-sub text-body"}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold ${cat === c ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-sub text-body"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid max-h-[62vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => add(p)}
              className="flex flex-col items-start gap-1 rounded-[12px] border border-line bg-sub p-3 text-left transition hover:border-brand hover:bg-[rgba(43,140,255,0.05)]"
            >
              <span className="text-[9px] font-bold uppercase tracking-wide text-faint">{KIND_LABEL[p.kind] ?? p.kind}</span>
              <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-body">{p.name}</span>
              <span className="num mt-auto text-[13px] font-extrabold text-ink">{formatMUR(p.priceCents)}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="col-span-full py-10 text-center text-[13px] text-faint">No products match “{q}”.</div>}
        </div>
      </div>

      {/* ticket */}
      <div className="flex flex-col rounded-[15px] border border-line bg-card">
        <div className="border-b border-line px-4 py-3">
          <input
            className={`h-10 w-full rounded-[10px] border bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand ${method === "credit" && !customerId ? "border-amber-ink" : "border-line-2"}`}
            placeholder={method === "credit" ? "Search & pick the customer (required for credit)" : "Customer name (optional)"}
            value={customer}
            onChange={(e) => { setCustomer(e.target.value); setCustomerId(null); }}
          />
          {custMatches.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-0.5 rounded-[10px] border border-line bg-card p-1">
              {custMatches.map((cst) => (
                <button
                  key={cst.id}
                  onClick={() => { setCustomer(cst.name); setCustomerId(cst.id); }}
                  className="rounded-[8px] px-2.5 py-2 text-left text-[13px] font-semibold text-body hover:bg-sub"
                >
                  {cst.name}
                </button>
              ))}
            </div>
          )}
          {method === "credit" && !customerId && (
            <p className="mt-1.5 text-[11px] text-amber-ink">Pick an existing customer so the amount owed is tracked against them.</p>
          )}
          {customerId && <p className="mt-1 text-[11px] font-semibold text-mint">✓ {customer}</p>}
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-2">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-faint">Tap products to build the sale.</div>
          ) : (
            cart.map((l) => {
              const lt = computeLineTotals({ qty: l.qty, unitCents: l.product.priceCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.product.vatRate });
              return (
              <div key={l.product.id} className="flex items-center gap-2 border-b border-line py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-body">{l.product.name}</div>
                  <div className="num text-[11px] text-faint">{formatMUR(l.product.priceCents)} each</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setQty(l.product.id, l.qty - 1)} className="flex size-7 items-center justify-center rounded-md border border-line-2 bg-sub text-body"><Minus size={13} /></button>
                  <span className="num w-6 text-center text-[13px] font-bold text-ink">{l.qty}</span>
                  <button onClick={() => setQty(l.product.id, l.qty + 1)} className="flex size-7 items-center justify-center rounded-md border border-line-2 bg-sub text-body"><Plus size={13} /></button>
                </div>
                <div className="flex items-center rounded-[7px] border border-line-2 bg-sub" title="Line discount (% or Rs off)">
                  <button onClick={() => patchLine(l.product.id, { discountKind: l.discountKind === "amount" ? "percent" : "amount", discountPct: 0, discountAmountCents: 0 })} className="grid h-7 w-6 place-items-center text-[10px] font-bold text-faint">{l.discountKind === "amount" ? "Rs" : "%"}</button>
                  <input value={l.discountKind === "amount" ? (l.discountAmountCents ? String(l.discountAmountCents / 100) : "") : (l.discountPct || "")} onChange={(e) => l.discountKind === "amount" ? patchLine(l.product.id, { discountAmountCents: parseMoneyInput(e.target.value) ?? 0 }) : patchLine(l.product.id, { discountPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })} inputMode="decimal" placeholder="disc" className="h-7 w-10 bg-transparent pr-1 text-right text-[11px] text-body outline-none placeholder:text-faint" />
                </div>
                <span className="num w-[84px] text-right text-[13px] font-bold text-ink">{formatMUR(lt.exclCents)}</span>
                <button onClick={() => setQty(l.product.id, 0)} className="text-faint hover:text-rose"><X size={15} /></button>
              </div>
              );
            })
          )}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[12.5px] text-muted">Discount (whole sale)</span>
            <div className="flex items-center rounded-[8px] border border-line-2 bg-sub" title="Order discount (% or Rs off the total)">
              <button onClick={() => { setOrderDiscKind((orderDiscKind ?? "percent") === "amount" ? "percent" : "amount"); setOrderDiscValue(0); }} className="grid h-8 w-7 place-items-center text-[11px] font-bold text-faint">{orderDiscKind === "amount" ? "Rs" : "%"}</button>
              <input
                value={orderDiscKind === "amount" ? (orderDiscValue ? String(orderDiscValue / 100) : "") : (orderDiscValue || "")}
                onChange={(e) => (orderDiscKind ?? "percent") === "amount" ? (() => { const c = parseMoneyInput(e.target.value) ?? 0; setOrderDiscKind(c > 0 ? "amount" : null); setOrderDiscValue(c); })() : (() => { const pct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)); setOrderDiscKind(pct > 0 ? "percent" : null); setOrderDiscValue(pct); })()}
                inputMode="decimal"
                placeholder="0"
                className="h-8 w-16 bg-transparent px-2 text-right text-[13px] text-body outline-none placeholder:text-faint"
              />
            </div>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted"><span>Subtotal</span><span className="num">{formatMUR(totals.grossSubtotalCents)}</span></div>
          {totals.grossSubtotalCents !== totals.subtotalCents && (
            <div className="flex justify-between text-[12.5px] text-amber-ink"><span>Discount</span><span className="num">−{formatMUR(totals.grossSubtotalCents - totals.subtotalCents)}</span></div>
          )}
          <div className="flex justify-between text-[12.5px] text-muted"><span>VAT</span><span className="num">{formatMUR(totals.vatCents)}</span></div>
          <div className="mt-1 flex justify-between text-[16px] font-extrabold text-ink-strong"><span>Total</span><span className="num">{formatMUR(totals.totalCents)}</span></div>

          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={`inline-flex h-9 items-center justify-center rounded-[9px] text-[12px] font-bold ${method === m.key ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-sub text-body"}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === "cash" ? (
            <div className="mt-2">
              <input
                className="h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-right text-[14px] text-ink outline-none focus:border-brand"
                placeholder="Cash tendered (Rs)"
                value={tender}
                onChange={(e) => setTender(e.target.value)}
                inputMode="decimal"
              />
              {changeCents != null && changeCents >= 0 && (
                <div className="mt-1.5 flex justify-between text-[13px] font-bold"><span className="text-muted">Change</span><span className="num text-mint">{formatMUR(changeCents)}</span></div>
              )}
            </div>
          ) : method === "credit" ? (
            <div className="mt-2 rounded-[10px] border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.08)] px-3 py-2.5 text-[12px] leading-snug text-amber-ink">
              On account — nothing collected now. <b className="num">{formatMUR(totals.totalCents)}</b> is recorded as money this customer owes (shows in Aged Receivables &amp; their Statement).
            </div>
          ) : (
            <input
              className="mt-2 h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
              placeholder="Approval / reference no."
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          )}

          {error && <p className="mt-2 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

          <button
            onClick={complete}
            disabled={busy || cart.length === 0}
            className="grad-brand shadow-brand mt-3 flex h-12 w-full items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Working…" : method === "credit" ? `Put ${formatMUR(totals.totalCents)} on account` : `Charge ${formatMUR(totals.totalCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
