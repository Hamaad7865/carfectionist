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
] as const;
type Method = (typeof METHODS)[number]["key"];

interface CartLine { product: CounterProduct; qty: number }

export function CounterSale({ products }: { products: CounterProduct[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [tender, setTender] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CounterResult, { ok: true }> | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s));
  }, [q, products]);

  const totals = useMemo(
    () => computeTotals(cart.map((l) => ({ qty: l.qty, unitCents: l.product.priceCents, vatRatePct: l.product.vatRate }))),
    [cart],
  );

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
    if (method === "cash" && tenderCents != null && tenderCents < totals.totalCents) return setError("Tendered is less than the total.");
    setBusy(true);
    const r = await counterSaleAction({
      customerName: customer.trim() || undefined,
      lines: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
      method,
      tenderedCents: method === "cash" ? tenderCents : null,
      externalRef: method === "cash" ? undefined : ref,
    });
    setBusy(false);
    if (r.ok) setDone(r);
    else setError(r.error);
  }

  function reset() {
    setCart([]); setCustomer(""); setTender(""); setRef(""); setMethod("cash"); setDone(null); setError(null); setQ("");
    router.refresh();
  }

  if (done) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-line bg-card p-8 text-center shadow-brand">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[rgba(13,167,124,0.14)]">
          <Check size={28} className="text-mint" strokeWidth={2.6} />
        </div>
        <div className="mt-4 font-display text-[20px] font-extrabold text-ink-strong">Sale complete</div>
        <div className="num mt-1 text-[13px] text-muted">{done.number ?? "Invoice"}</div>
        <div className="num mt-5 text-[34px] font-extrabold text-ink-strong">{formatMUR(done.totalCents)}</div>
        {done.changeCents > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-[11px] bg-[rgba(245,166,35,0.12)] px-4 py-2">
            <span className="text-[12px] font-bold uppercase tracking-wide text-amber-ink">Change due</span>
            <span className="num text-[16px] font-extrabold text-amber-ink">{formatMUR(done.changeCents)}</span>
          </div>
        )}
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
            className="h-10 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
            placeholder="Customer name (optional)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
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

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={`h-9 rounded-[9px] text-[12px] font-bold ${method === m.key ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-sub text-body"}`}
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
            className="grad-brand shadow-brand mt-3 h-12 w-full rounded-[12px] text-[15px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Charging…" : `Charge ${formatMUR(totals.totalCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
