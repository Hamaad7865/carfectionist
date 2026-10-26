"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, SlidersHorizontal } from "lucide-react";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { recordAdjustmentAction } from "./actions";
import type { InventoryOpsData } from "@/lib/supabase/queries/movements";
import { pickSalesFloor } from "@/lib/supabase/locations";
import { onHandAt, roundQty } from "@/lib/stock/balance";
import { btn } from "@/components/ui/button";

/** The shop's stock-movement vocabulary. Mirror of the tablet's STOCK_REASONS
 *  (android .../feature/stock/StockViewModel.kt) — keep the two in step so the
 *  movement ledger reads the same whichever app filed the adjustment. */
const STOCK_REASONS = ["Received stock", "Used in job", "Return to supplier", "Damaged", "Correction"] as const;

const REF_STYLE: Record<string, { label: string; cls: string }> = {
  adjustment: { label: "Adjustment", cls: "bg-[rgba(140,150,161,0.16)] text-muted" },
  invoice: { label: "Sale", cls: "bg-[rgba(43,140,255,0.12)] text-link" },
  credit_note: { label: "Credit note", cls: "bg-[rgba(255,84,104,0.12)] text-pink" },
  job_card: { label: "Job", cls: "bg-[rgba(106,92,255,0.12)] text-[#6a5cff]" },
  purchase_order: { label: "Purchase", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  transfer: { label: "Transfer", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink" },
};
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

export function InventoryPanel({ data }: { data: InventoryOpsData }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // The shop floor, by flag — locations now come default (warehouse) first, and
  // counts on the floor are what this form is mostly used for.
  const [locationId, setLocationId] = useState(pickSalesFloor(data.locations)?.id ?? data.locations[0]?.id ?? "");
  const [dir, setDir] = useState<1 | -1>(1);
  const [qtyStr, setQtyStr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending until the refreshed counts have landed, so the old number never
  // sits there looking confirmed.
  const [refreshing, startRefresh] = useTransition();

  const unit = data.products.find((p) => p.id === productId)?.unit ?? "";
  // The tablet's adjust dialog reads "on hand N … → new on-hand N"; same here.
  const typed = parseFloat(qtyStr);
  const locName = data.locations.find((l) => l.id === locationId)?.name ?? "";
  const after = productId && locationId && typed > 0 ? roundQty(onHandAt(data.onHand, productId, locationId) + dir * typed) : null;
  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return data.products.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 8);
  }, [query, data.products]);

  async function submit() {
    setError(null);
    const mag = parseFloat(qtyStr);
    if (!(mag > 0)) return setError("Enter a quantity greater than zero.");
    if (!productId || !locationId) return setError("Pick a product and a location.");
    if (!note.trim()) return setError("A reason is required — the owner reads it straight off the stock ledger.");
    setBusy(true);
    const r = await recordAdjustmentAction({ productId, locationId, qty: dir * mag, note });
    setBusy(false);
    if (r.ok) {
      setQtyStr("");
      setNote("");
      startRefresh(() => router.refresh());
    } else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* adjustment */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Manual stock adjustment</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto_120px_1fr_auto] md:items-end">
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">Product</span>
            <div className="relative">
              <input
                className={`${inputCls} ${productId ? "pr-8" : ""}`}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setProductId(""); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder="Search product…"
                role="combobox"
                aria-expanded={open}
              />
              {productId && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-mint">✓</span>}
              {open && matches.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-line bg-card p-1 shadow-lg">
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setProductId(p.id); setQuery(p.name); setOpen(false); }}
                      className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left hover:bg-sub"
                    >
                      <span className="min-w-0 truncate text-[13px] font-semibold text-body">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {data.locations.map((l, i) => (
                          <span key={l.id}>
                            {i > 0 && " · "}
                            {l.name} <span className="num font-semibold text-body">{num(onHandAt(data.onHand, p.id, l.id))}</span>
                          </span>
                        ))}
                        {p.unit && <span className="ml-1.5">{p.unit}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {open && query.trim() && matches.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-[10px] border border-line bg-card px-3 py-2.5 text-[12.5px] text-faint shadow-lg">No product matches “{query.trim()}”.</div>
              )}
            </div>
          </div>
          <Field label="Location">
            <select className={inputCls} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">Direction</span>
            <div className="flex gap-1">
              <button onClick={() => setDir(1)} className={`inline-flex h-10 w-10 items-center justify-center rounded-[10px] border ${dir === 1 ? "border-mint bg-[rgba(13,167,124,0.12)] text-mint" : "border-line-2 bg-sub text-muted"}`}><Plus size={16} /></button>
              <button onClick={() => setDir(-1)} className={`inline-flex h-10 w-10 items-center justify-center rounded-[10px] border ${dir === -1 ? "border-rose bg-[rgba(214,59,80,0.1)] text-rose" : "border-line-2 bg-sub text-muted"}`}><Minus size={16} /></button>
            </div>
          </div>
          <Field label={`Qty${unit ? ` (${unit})` : ""}`}>
            <input className={`${inputCls} text-right`} value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Reason / note *" hint="Required — explains this movement on the shared stock ledger.">
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. stock count correction"
              list="stock-reasons"
              required
              aria-required="true"
            />
            {/* The same quick reasons the tablet offers as chips (STOCK_REASONS), so the
                two apps file movements under matching wording instead of free-text drift.
                Still a plain input — anything else can be typed. */}
            <datalist id="stock-reasons">
              {STOCK_REASONS.map((r) => <option key={r} value={r} />)}
            </datalist>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {STOCK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNote(r)}
                  className={`h-7 rounded-full border px-2.5 text-[11.5px] font-semibold ${
                    note === r ? "border-brand bg-[rgba(43,140,255,0.1)] text-brand" : "border-line-2 bg-sub text-muted hover:text-body"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          <button onClick={submit} disabled={busy} className={btn("primary", "lg")}>
            {busy ? "Saving…" : "Record"}
          </button>
        </div>
        {productId && (
          <div
            aria-live="polite"
            aria-busy={refreshing}
            className={`mt-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-sub px-3 py-2 transition-opacity motion-reduce:transition-none ${refreshing ? "opacity-60" : ""}`}
          >
            <span className="text-[11px] font-bold uppercase tracking-wide text-faint">On hand</span>
            {/* One chip per location; tapping one picks it, same as the Location select. */}
            {data.locations.map((l) => {
              const n = onHandAt(data.onHand, productId, l.id);
              const on = l.id === locationId;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLocationId(l.id)}
                  aria-pressed={on}
                  title={`Adjust stock at ${l.name}`}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] border bg-card px-2.5 ${on ? "border-brand" : "border-line-2 hover:border-brand"}`}
                >
                  <span className="text-[12px] font-semibold text-muted">{l.name}</span>
                  <span className={`num text-[15px] font-extrabold ${n < 0 ? "text-rose" : "text-ink"}`}>{num(n)}</span>
                </button>
              );
            })}
            {after != null && (
              <span className="text-[12.5px] text-muted">
                → new on-hand at {locName}{" "}
                <span className={`num text-[15px] font-extrabold ${after < 0 ? "text-rose" : "text-ink"}`}>{num(after)}</span>
              </span>
            )}
            {refreshing && <span className="text-[11.5px] text-faint">Updating…</span>}
          </div>
        )}
        <div className="mt-3"><FormError error={error} /></div>
      </div>

      {/* ledger */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="hidden grid-cols-[110px_1fr_120px_110px_90px_90px_1fr] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th md:grid">
          <span>Date</span><span>Product</span><span>Location</span><span>Type</span><span className="text-right">Qty</span>
          <span className="text-right" title="On hand at that location right after this movement">Stock after</span>
          <span>Note</span>
        </div>
        {data.movements.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">No stock movements yet.</div>
        ) : (
          data.movements.map((m) => {
            const st = REF_STYLE[m.refType] ?? { label: m.refType, cls: "bg-sub text-muted" };
            const balCls = m.balanceAfter < 0 ? "text-rose" : "text-body";
            return (
              // Tint the product being adjusted, so its recent history reads at a glance.
              <div key={m.id} className={`border-b border-line ${productId && m.productId === productId ? "bg-brand/[0.06]" : ""}`}>
                {/* Mobile card */}
                <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-body">{m.productName}</span>
                      <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-1 truncate text-[12px] text-muted">{m.locationName}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-faint">
                      <span className="num">{m.movedAt.slice(0, 10)}</span>
                      {m.note ? ` · ${m.note}` : m.by ? ` · by ${m.by}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`num text-[14px] font-bold ${m.qty < 0 ? "text-rose" : "text-mint"}`}>{m.qty > 0 ? "+" : ""}{num(m.qty)}</div>
                    <div className="text-[11px] text-faint" title="On hand at that location right after this movement">
                      → <span className={`num font-semibold ${balCls}`}>{num(m.balanceAfter)}</span>
                    </div>
                  </div>
                </div>
                {/* Desktop grid */}
                <div className="hidden grid-cols-[110px_1fr_120px_110px_90px_90px_1fr] items-center gap-3 px-5 py-2.5 text-[12.5px] md:grid">
                  <span className="num text-muted">{m.movedAt.slice(0, 10)}</span>
                  <span className="truncate font-semibold text-body">{m.productName}</span>
                  <span className="text-muted">{m.locationName}</span>
                  <span><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span></span>
                  <span className={`num text-right font-bold ${m.qty < 0 ? "text-rose" : "text-mint"}`}>{m.qty > 0 ? "+" : ""}{num(m.qty)}</span>
                  <span className={`num text-right font-semibold ${balCls}`}>{num(m.balanceAfter)}</span>
                  <span className="truncate text-faint">{m.note ?? (m.by ? `by ${m.by}` : "—")}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
