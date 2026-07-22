"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Minus, Plus, X, Printer, MessageCircle, Download, ArrowRight, ShoppingCart, AlertTriangle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import { grossCents, formatMUR, computeTotals, computeLineTotals, parseMoneyInput } from "@/lib/money";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";
import { counterSaleAction, type CounterResult } from "./actions";
import { setProductPriceAction } from "@/features/products/actions";
import { getReceiptDataAction } from "./receipt-action";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";
import { btn, btnBase } from "@/components/ui/button";
import {
  EMPTY_BASKET,
  addProduct,
  patchLine as patchLineIn,
  pickCustomer as pickCustomerIn,
  setCustomerName,
  setOrderDiscount,
  setQty as setQtyIn,
  settleMessage,
  settleResolved,
  withSettleFailure,
  type Basket,
  type CartLine,
} from "./settle";

const KIND_LABEL: Record<string, string> = { service: "Service", consumable: "Consumable", product: "Product" };
const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "juice", label: "Juice" },
  { key: "bank_transfer", label: "Bank" },
  { key: "credit", label: "Credit" },
] as const;
type Method = (typeof METHODS)[number]["key"];
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function CounterSale({
  products,
  customers,
  canPrice = false,
  pricesInclVat = false,
}: {
  products: CounterProduct[];
  customers: { id: string; name: string }[];
  /** Owner/manager: may put a price on an unpriced product from here. */
  canPrice?: boolean;
  /** The shop quotes VAT-inclusive shelf prices — show what the customer pays, as the tablet does. */
  pricesInclVat?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  // The product someone is trying to sell that has no price yet.
  const [pricing, setPricing] = useState<CounterProduct | null>(null);
  const [cat, setCat] = useState("");
  const [catOpen, setCatOpen] = useState(true); // the vertical category rail
  const [catQuery, setCatQuery] = useState("");
  const [kind, setKind] = useState<"all" | "service" | "product">("all");
  // The cart, its discounts and the customer are one value: everything a settle sends. Once an
  // attempt reaches issue_document they freeze together, so a retry re-sends the same request.
  const [basket, setBasket] = useState<Basket>(EMPTY_BASKET);
  const { lines: cart, orderDiscKind, orderDiscValue, customer, customerId, pending, notice } = basket;
  const frozen = pending !== null;
  const [method, setMethod] = useState<Method>("cash");
  const [tender, setTender] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNeg, setConfirmNeg] = useState<{ name: string; shop: number; warehouse: number; selling: number }[] | null>(null);
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
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.category) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products]);
  // "All" always survives the rail filter, so there is always a way back out.
  const railCats = useMemo(
    () => categories.filter((c) => c.toLowerCase().includes(catQuery.trim().toLowerCase())),
    [categories, catQuery],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (kind === "all" || p.kind === kind) &&
        (!cat || p.category === cat) &&
        (!s || p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s)),
    );
  }, [q, cat, kind, products]);

  // How many of each kind exist, so the chips can show what's behind them.
  const kindCounts = useMemo(() => {
    let service = 0, product = 0;
    for (const p of products) (p.kind === "service" ? service++ : product++);
    return { all: products.length, service, product };
  }, [products]);

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

  const add = (p: CounterProduct) => setBasket((b) => addProduct(b, p));
  const setQty = (id: string, qty: number) => setBasket((b) => setQtyIn(b, id, qty));
  const patchLine = (id: string, patch: Partial<CartLine>) => setBasket((b) => patchLineIn(b, id, patch));

  const tenderCents = parseMoneyInput(tender);
  const changeCents = method === "cash" && tenderCents != null ? tenderCents - totals.totalCents : null;

  async function complete(force = false) {
    setError(null);
    if (cart.length === 0) return setError("Add at least one product.");
    if (method === "credit" && !customerId) return setError("Pick an existing customer for a credit sale — the amount owed is tracked against them.");
    if (method === "cash" && tenderCents != null && tenderCents < totals.totalCents) return setError("Tendered is less than the total.");
    // Soft guard: a stocked line that exceeds on-hand will drive stock negative.
    // Warn (and let them proceed) — sales are never hard-blocked on stock.
    // Skipped while frozen: the invoice already issued, so its stock has already moved.
    if (!force && !frozen) {
      const negatives = cart
        .filter((l) => l.product.isStocked && l.qty > l.product.shopQty)
        .map((l) => ({ name: l.product.name, shop: l.product.shopQty, warehouse: l.product.warehouseQty, selling: l.qty }));
      if (negatives.length > 0) { setConfirmNeg(negatives); return; }
    }
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
    if (r.ok) { setBasket(settleResolved); return setDone(r); }
    setError(r.error);
    // A failure past issue_document pins the basket to whatever the server may hold under saleKey.
    setBasket((b) => withSettleFailure(b, r));
  }

  function reset() {
    setBasket(EMPTY_BASKET); // never carry a cart, a discount or a frozen settle into the next ticket
    setTender(""); setRef(""); setMethod("cash"); setDone(null); setError(null); setQ("");
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
            <button onClick={() => window.open(`/print/receipt/${done.invoiceId}`, "_blank")} className={btn("primary", "lg", "gap-2 text-[14px] px-5")}>
              <Printer size={17} /> Print receipt
            </button>
            <button onClick={shareWhatsApp} className={btn("subtle", "lg", "gap-2")}>
              <MessageCircle size={16} /> SMS / WhatsApp
            </button>
            <a href={`/api/documents/${done.invoiceId}/pdf`} target="_blank" rel="noreferrer" className={btn("subtle", "lg", "gap-2")}>
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
            <button onClick={reset} className={btnBase("lg", "bg-ink font-bold text-white")}>
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
    // minmax(0,1fr) + min-w-0: a grid track's min width defaults to its CONTENT's
    // width, and the 57-category chip strip (shrink-0 nowrap) is ~4000px wide —
    // without these the whole page blows out horizontally and the ticket panel
    // lands off-screen.
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* catalogue: collapsible category rail (left) + search + product grid */}
      <div className="flex min-w-0 rounded-[15px] border border-line bg-card">
        {/* category rail — vertical, searchable, collapsible (owner request; mirrors the tablet) */}
        {categories.length > 0 && (
          catOpen ? (
            <div className="hidden w-[212px] shrink-0 flex-col border-r border-line lg:flex">
              <div className="flex items-center gap-1.5 border-b border-line p-2.5">
                <input
                  className="h-9 w-full min-w-0 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12px] text-ink outline-none placeholder:text-faint focus:border-brand"
                  placeholder="Filter categories…"
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                />
                <button onClick={() => setCatOpen(false)} title="Collapse categories" className="grid size-9 shrink-0 place-items-center rounded-[9px] text-faint hover:bg-sub hover:text-body">
                  <PanelLeftClose size={16} />
                </button>
              </div>
              <div className="flex max-h-[62vh] flex-1 flex-col gap-[2px] overflow-y-auto p-2">
                <button
                  onClick={() => setCat("")}
                  className={`relative flex h-9 shrink-0 items-center rounded-[8px] px-3 text-left text-[12.5px] font-semibold ${cat === "" ? "bg-[rgba(43,140,255,0.10)] text-link" : "text-body hover:bg-sub"}`}
                >
                  {cat === "" && <span className="grad-rail absolute bottom-2 left-0 top-2 w-[3px] rounded-r-[3px]" />}
                  <span className="flex-1">All</span>
                  <span className="num text-[10.5px] text-faint">{products.length}</span>
                </button>
                {railCats.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    title={c}
                    className={`relative flex h-9 shrink-0 items-center gap-2 rounded-[8px] px-3 text-left text-[12px] font-semibold ${cat === c ? "bg-[rgba(43,140,255,0.10)] text-link" : "text-body hover:bg-sub"}`}
                  >
                    {cat === c && <span className="grad-rail absolute bottom-2 left-0 top-2 w-[3px] rounded-r-[3px]" />}
                    <span className="min-w-0 flex-1 truncate">{c}</span>
                    <span className="num text-[10.5px] text-faint">{catCounts.get(c) ?? 0}</span>
                  </button>
                ))}
                {railCats.length === 0 && <div className="px-3 py-4 text-[11.5px] text-faint">No category matches.</div>}
              </div>
            </div>
          ) : (
            <div className="hidden w-11 shrink-0 flex-col items-center gap-2 border-r border-line py-2.5 lg:flex">
              <button onClick={() => setCatOpen(true)} title="Show categories" className="grid size-9 place-items-center rounded-[9px] text-faint hover:bg-sub hover:text-body">
                <PanelLeftOpen size={16} />
              </button>
              {cat && <span title={cat} className="size-2 rounded-full bg-brand" />}
            </div>
          )
        )}

        {/* search + grid */}
        <div className="flex min-w-0 flex-1 flex-col">
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
            {/* Services vs products. The catalogue is ~800 products to ~70 services,
                so without this a service is a needle in a haystack at the till. */}
            <div className="mt-2 flex items-center gap-1.5">
              {([["all", "All"], ["service", "Services"], ["product", "Products"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-bold ${kind === k ? "grad-brand text-white" : "border border-line-2 bg-card text-body hover:border-brand"}`}
                >
                  {label}
                  <span className={`text-[10.5px] font-semibold ${kind === k ? "text-white/70" : "text-faint"}`}>{kindCounts[k]}</span>
                </button>
              ))}
            </div>
            {/* Small screens have no rail — a compact dropdown keeps categories reachable. */}
            {categories.length > 0 && (
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="mt-2 h-9 w-full rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12.5px] font-medium text-body outline-none focus:border-brand lg:hidden"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid max-h-[62vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((p) => {
              // No price in the catalogue = it cannot be sold, because the sale reads its
              // prices from there. Say so on the tile instead of showing a confident
              // "Rs 0.00", and let a manager put the price on it right here.
              const unpriced = p.priceCents <= 0;
              return (
              <button
                key={p.id}
                disabled={frozen || (unpriced && !canPrice)}
                onClick={() => (unpriced ? setPricing(p) : add(p))}
                title={unpriced && !canPrice ? "This product has no price — a manager has to set one before it can be sold." : undefined}
                className={`flex flex-col items-start gap-1 rounded-[12px] border p-3 text-left transition disabled:opacity-50 disabled:hover:border-line ${
                  unpriced
                    ? "border-[rgba(245,166,35,0.4)] bg-[rgba(245,166,35,0.06)] hover:border-amber-ink"
                    : "border-line bg-sub hover:border-brand hover:bg-[rgba(43,140,255,0.05)]"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span className="text-[9px] font-bold uppercase tracking-wide text-faint">{KIND_LABEL[p.kind] ?? p.kind}</span>
                  {/* Shop-floor count, plain number — the tablet's tiles already
                      show it this way. Red at zero; oversold reads 0, not "-1"
                      (same clamp as the tablet). nowrap because the old "0 left"
                      used to stack into two lines on narrow tiles. */}
                  {p.isStocked && (
                    <span
                      className={`num shrink-0 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 text-[9.5px] font-bold ${
                        p.shopQty <= 0 ? "bg-[rgba(214,59,80,0.14)] text-rose" : "bg-[rgba(15,23,32,0.07)] text-muted"
                      }`}
                    >
                      {Math.max(0, p.shopQty)}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-body">{p.name}</span>
                {unpriced ? (
                  <span className="mt-auto text-[11.5px] font-bold text-amber-ink">{canPrice ? "Set a price →" : "No price"}</span>
                ) : (
                  <span className="num mt-auto text-[13px] font-extrabold text-ink">{formatMUR(p.priceCents)}</span>
                )}
              </button>
              );
            })}
            {filtered.length === 0 && <div className="col-span-full py-10 text-center text-[13px] text-faint">No products match “{q}”.</div>}
          </div>
        </div>
      </div>

      {/* ticket */}
      <div className="flex min-w-0 flex-col rounded-[15px] border border-line bg-card">
        <div className="border-b border-line px-4 py-3">
          <input
            className={`h-10 w-full rounded-[10px] border bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand ${method === "credit" && !customerId ? "border-amber-ink" : "border-line-2"}`}
            placeholder={method === "credit" ? "Search & pick the customer (required for credit)" : "Customer name (optional)"}
            value={customer}
            readOnly={frozen}
            onChange={(e) => { const v = e.target.value; setBasket((b) => setCustomerName(b, v)); }}
          />
          {custMatches.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-0.5 rounded-[10px] border border-line bg-card p-1">
              {custMatches.map((cst) => (
                <button
                  key={cst.id}
                  disabled={frozen}
                  onClick={() => setBasket((b) => pickCustomerIn(b, cst.id, cst.name))}
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
                  <div className="num text-[11px] text-faint">{formatMUR(pricesInclVat ? grossCents(l.product.priceCents, l.product.vatRate) : l.product.priceCents)} each</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button disabled={frozen} onClick={() => setQty(l.product.id, l.qty - 1)} className="flex size-7 items-center justify-center rounded-md border border-line-2 bg-sub text-body disabled:opacity-50"><Minus size={13} /></button>
                  <span className="num w-6 text-center text-[13px] font-bold text-ink">{l.qty}</span>
                  <button disabled={frozen} onClick={() => setQty(l.product.id, l.qty + 1)} className="flex size-7 items-center justify-center rounded-md border border-line-2 bg-sub text-body disabled:opacity-50"><Plus size={13} /></button>
                </div>
                <div className="flex items-center rounded-[7px] border border-line-2 bg-sub" title="Line discount (% or Rs off)">
                  <button disabled={frozen} onClick={() => patchLine(l.product.id, { discountKind: l.discountKind === "amount" ? "percent" : "amount", discountPct: 0, discountAmountCents: 0 })} className="grid h-7 w-6 place-items-center text-[10px] font-bold text-faint disabled:opacity-50">{l.discountKind === "amount" ? "Rs" : "%"}</button>
                  <input value={l.discountKind === "amount" ? (l.discountAmountCents ? String(l.discountAmountCents / 100) : "") : (l.discountPct || "")} readOnly={frozen} onChange={(e) => l.discountKind === "amount" ? patchLine(l.product.id, { discountAmountCents: parseMoneyInput(e.target.value) ?? 0 }) : patchLine(l.product.id, { discountPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })} inputMode="decimal" placeholder="disc" className="h-7 w-10 bg-transparent pr-1 text-right text-[11px] text-body outline-none placeholder:text-faint" />
                </div>
                <span className="num w-[84px] text-right text-[13px] font-bold text-ink">{formatMUR(pricesInclVat ? lt.exclCents + lt.vatCents : lt.exclCents)}</span>
                <button disabled={frozen} onClick={() => setQty(l.product.id, 0)} className="text-faint hover:text-rose disabled:opacity-50 disabled:hover:text-faint"><X size={15} /></button>
              </div>
              );
            })
          )}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[12.5px] text-muted">Discount (whole sale)</span>
            <div className="flex items-center rounded-[8px] border border-line-2 bg-sub" title="Order discount (% or Rs off the total)">
              <button disabled={frozen} onClick={() => setBasket((b) => setOrderDiscount(b, (b.orderDiscKind ?? "percent") === "amount" ? "percent" : "amount", 0))} className="grid h-8 w-7 place-items-center text-[11px] font-bold text-faint">{orderDiscKind === "amount" ? "Rs" : "%"}</button>
              <input
                value={orderDiscKind === "amount" ? (orderDiscValue ? String(orderDiscValue / 100) : "") : (orderDiscValue || "")}
                readOnly={frozen}
                onChange={(e) => {
                  const v = e.target.value;
                  setBasket((b) => {
                    if ((b.orderDiscKind ?? "percent") === "amount") {
                      const c = parseMoneyInput(v) ?? 0;
                      return setOrderDiscount(b, c > 0 ? "amount" : null, c);
                    }
                    const pct = Math.min(100, Math.max(0, parseFloat(v) || 0));
                    return setOrderDiscount(b, pct > 0 ? "percent" : null, pct);
                  });
                }}
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
                disabled={frozen}
                className={`inline-flex h-9 items-center justify-center rounded-[9px] text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${method === m.key ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-sub text-body"}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {method === "cash" ? (
            <div className="mt-2">
              <input
                className="h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-right text-[14px] text-ink outline-none focus:border-brand read-only:opacity-60"
                placeholder="Cash tendered (Rs)"
                value={tender}
                onChange={(e) => setTender(e.target.value)}
                readOnly={frozen}
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
              className="mt-2 h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand read-only:opacity-60"
              placeholder="Approval / reference no."
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              readOnly={frozen}
            />
          )}

          {error && <p className="mt-2 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

          {pending && (
            <div className="mt-2 rounded-[10px] border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.08)] px-3 py-2.5">
              <p className="text-[12.5px] font-semibold leading-snug text-amber-ink">{settleMessage(pending)}</p>
              <button onClick={reset} className="mt-2 h-8 rounded-[9px] border border-[rgba(245,166,35,0.45)] px-3 text-[12px] font-bold text-amber-ink hover:bg-[rgba(245,166,35,0.12)]">
                Abandon sale
              </button>
            </div>
          )}
          {notice && <p className="mt-2 text-[11.5px] font-semibold text-amber-ink">{notice}</p>}

          {/* Nothing to charge = nothing to issue. A Rs 0.00 invoice can never be settled,
              and it sits in the collect list forever. */}
          <button
            onClick={() => complete()}
            disabled={busy || cart.length === 0 || totals.totalCents <= 0}
            className="grad-brand shadow-brand mt-3 flex h-12 w-full items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : cart.length > 0 && totals.totalCents <= 0
                ? "Nothing to charge"
                : frozen
                  ? `Charge ${formatMUR(totals.totalCents)} again`
                  : method === "credit"
                    ? `Put ${formatMUR(totals.totalCents)} on account`
                    : `Charge ${formatMUR(totals.totalCents)}`}
          </button>
        </div>
      </div>

      {pricing && (
        <PriceProductDialog
          product={pricing}
          onClose={() => setPricing(null)}
          onPriced={(priceCents) => {
            // Straight into the sale at the price just saved — she was mid-sale, that is
            // why she is pricing it. The catalogue keeps the price for next time.
            add({ ...pricing, priceCents });
            setPricing(null);
            router.refresh();
          }}
        />
      )}

      {confirmNeg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[rgba(15,23,32,0.5)]" onClick={() => setConfirmNeg(null)} />
          <div className="relative w-full max-w-sm rounded-[16px] border border-line bg-card p-6 shadow-[0_20px_60px_-10px_rgba(15,23,32,0.5)]">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(245,166,35,0.16)] text-amber-ink"><AlertTriangle size={18} /></div>
              <div className="font-display text-[16px] font-extrabold text-ink-strong">Shop stock will go negative</div>
            </div>
            <p className="mt-3 text-[13px] text-muted">Selling these takes the shop count below zero:</p>
            <ul className="mt-2.5 space-y-1.5">
              {confirmNeg.map((n, i) => (
                <li key={i} className="rounded-[9px] bg-sub px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-body">{n.name}</span>
                    <span className="num shrink-0 text-[12.5px] font-bold text-amber-ink">shop {fmtQty(n.shop)} → {fmtQty(n.shop - n.selling)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">{n.warehouse > 0 ? `${fmtQty(n.warehouse)} in the warehouse — transfer or continue` : "none in the warehouse either"}</div>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmNeg(null)} className="h-11 flex-1 rounded-[12px] border border-line-2 bg-sub font-bold text-body">Cancel</button>
              <button onClick={() => { setConfirmNeg(null); complete(true); }} className="h-11 flex-1 rounded-[12px] font-bold text-white" style={{ background: "#e0891c" }}>Continue anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Price a product that has none, without leaving the sale. The price goes into the
 * catalogue (that is where the sale reads prices from), so this both finishes the sale
 * and stops the next person hitting the same wall.
 */
function PriceProductDialog({
  product,
  onClose,
  onPriced,
}: {
  product: CounterProduct;
  onClose: () => void;
  onPriced: (priceCents: number) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseMoneyInput(value) ?? 0; // unparseable input reads as nothing entered

  async function save() {
    if (busy || cents <= 0) return;
    setBusy(true);
    setError(null);
    const r = await setProductPriceAction({ id: product.id, sellingPrice: cents / 100 });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onPriced(r.data?.priceCents ?? cents);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(15,23,32,0.5)]" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-[16px] border border-line bg-card p-6 shadow-[0_20px_60px_-10px_rgba(15,23,32,0.5)]">
        <div className="font-display text-[16px] font-extrabold text-ink-strong">Set a price</div>
        <p className="mt-1.5 text-[13px] font-semibold text-body">{product.name}</p>
        <p className="mt-2 text-[12.5px] text-muted">
          This product has no price yet, so it can&apos;t be sold. The price is saved to the catalogue — you only have to do this once.
        </p>

        <label className="mt-4 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Selling price (Rs, excl. VAT)</label>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          placeholder="0.00"
          inputMode="decimal"
          className="num mt-1.5 h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[15px] font-bold text-ink outline-none focus:border-brand"
        />
        {error && <p className="mt-2 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="h-11 flex-1 rounded-[12px] border border-line-2 bg-sub font-bold text-body">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={busy || cents <= 0}
            className="grad-brand shadow-brand h-11 flex-1 rounded-[12px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save & add"}
          </button>
        </div>
      </div>
    </div>
  );
}
