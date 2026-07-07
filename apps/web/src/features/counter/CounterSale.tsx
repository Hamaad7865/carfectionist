"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Minus, Plus, X, Check } from "lucide-react";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import { formatMUR, computeTotals, parseMoneyInput } from "@/lib/money";
import { counterSaleAction, type CounterResult } from "./actions";

const KIND_LABEL: Record<string, string> = { service: "Service", consumable: "Consumable", product: "Product" };
const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "juice", label: "Juice" },
  { key: "bank_transfer", label: "Bank" },
  { key: "credit", label: "Credit" },
] as const;
type Method = (typeof METHODS)[number]["key"];

interface CartLine { product: CounterProduct; qty: number }

export function CounterSale({ products, customers }: { products: CounterProduct[]; customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("cash");
  const [tender, setTender] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CounterResult, { ok: true }> | null>(null);
  const [saleKey, setSaleKey] = useState(() => crypto.randomUUID()); // stable per sale, rotates on reset

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
    () => computeTotals(cart.map((l) => ({ qty: l.qty, unitCents: l.product.priceCents, vatRatePct: l.product.vatRate }))),
    [cart],
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
      lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
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
    setCart([]); setCustomer(""); setCustomerId(null); setTender(""); setRef(""); setMethod("cash"); setDone(null); setError(null); setQ(""); newKey();
    router.refresh();
  }

  if (done) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-line bg-card p-8 text-center shadow-brand">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[rgba(13,167,124,0.14)]">
          <Check size={28} className="text-mint" strokeWidth={2.6} />
        </div>
        <div className="mt-4 font-display text-[20px] font-extrabold text-ink-strong">{done.onAccount ? "Recorded on account" : "Sale complete"}</div>
        <div className="num mt-1 text-[13px] text-muted">{done.number ?? "Invoice"}</div>
        <div className="num mt-5 text-[34px] font-extrabold text-ink-strong">{formatMUR(done.totalCents)}</div>
        {done.onAccount ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-[11px] bg-[rgba(245,166,35,0.12)] px-4 py-2">
            <span className="text-[12px] font-bold uppercase tracking-wide text-amber-ink">On account</span>
            <span className="num text-[16px] font-extrabold text-amber-ink">{formatMUR(done.totalCents)} owed</span>
          </div>
        ) : done.changeCents > 0 ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-[11px] bg-[rgba(245,166,35,0.12)] px-4 py-2">
            <span className="text-[12px] font-bold uppercase tracking-wide text-amber-ink">Change due</span>
            <span className="num text-[16px] font-extrabold text-amber-ink">{formatMUR(done.changeCents)}</span>
          </div>
        ) : null}
        <div className="mt-7 flex gap-2">
          <button onClick={reset} className="grad-brand shadow-brand h-11 flex-1 rounded-[12px] font-bold text-white">New sale</button>
          <Link href={`/sales/${done.invoiceId}`} className="flex h-11 flex-1 items-center justify-center rounded-[12px] border border-line-2 bg-sub font-bold text-body">
            View invoice
          </Link>
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
            cart.map((l) => (
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
                <span className="num w-[84px] text-right text-[13px] font-bold text-ink">{formatMUR(Math.round(l.product.priceCents * l.qty))}</span>
                <button onClick={() => setQty(l.product.id, 0)} className="text-faint hover:text-rose"><X size={15} /></button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="flex justify-between text-[12.5px] text-muted"><span>Subtotal</span><span className="num">{formatMUR(totals.subtotalCents)}</span></div>
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
