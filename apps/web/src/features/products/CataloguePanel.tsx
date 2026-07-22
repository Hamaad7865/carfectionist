"use client";

import { grossCents } from "@/lib/money";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Barcode, Search, TriangleAlert } from "lucide-react";
import { formatMUR } from "@/lib/money";
import { ProductFormModal } from "./ProductFormModal";
import type { InventoryRow } from "@/lib/supabase/queries/inventory";
import type { StockLocation } from "@/lib/supabase/locations";
import { btn } from "@/components/ui/button";

const qty = (n: number | null | undefined) => (n == null ? "—" : String(n));
const field = "h-9 rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";

// One stock column per location, so a third location has somewhere to land.
// Tailwind can't build a class name at runtime, so the track list is a style.
const gridCols = (locationCount: number) => ({
  gridTemplateColumns: `minmax(0,1fr) 160px 90px 90px 70px ${"100px ".repeat(locationCount).trim()}`,
});

// Services and goods share one catalogue — a job is billed from the same list a
// counter sale is. But the studio sells ~570 products and ~70 services, so
// without this switch the services are unfindable, which is exactly how it felt.
type KindFilter = "all" | "service" | "product";
const isService = (p: InventoryRow) => p.kind === "service";

/** LOW and OUT are different jobs, so they don't share a badge: LOW is in the
 *  warehouse and needs moving, OUT has to be bought. Lumping them together is
 *  what made the bell say 11 while the catalogue flagged 36. */
/** A small square avatar so a similarly-named item can be told apart at a glance;
 *  blank tile when there's no photo rather than reflowing the row around it. */
function Thumb({ url, size = 28 }: { url: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-sub"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}

function StockBadge({ state, floor }: { state: InventoryRow["state"]; floor: string }) {
  if (state === "ok") return null;
  const low = state === "low";
  return (
    <span
      title={low ? `Under the threshold at ${floor} — move some over from the warehouse` : "None anywhere — this one has to be ordered"}
      className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${low ? "bg-[rgba(245,166,35,0.14)] text-amber-ink" : "bg-[rgba(214,59,80,0.12)] text-rose"}`}
    >
      {low ? "LOW" : "OUT"}
    </span>
  );
}

export function CataloguePanel({ products, locations, showArchived, vatDefault, pricesInclVat, lowOnly = false, tenantId }: { products: InventoryRow[]; locations: StockLocation[]; showArchived: boolean; vatDefault: number; pricesInclVat: boolean; lowOnly?: boolean; tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  // Starts on when the bell sent you here (/products?low=1) — that alert's whole
  // job is to hand you the list, not a search box.
  const [low, setLow] = useState(lowOnly);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const floorName = locations.find((l) => l.isSalesFloor)?.name ?? "the shop";

  // Text + category first, so each switch can be labelled with what it would
  // actually show you right now rather than a catalogue-wide total.
  const matched = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!cat || p.category === cat) &&
        (!s ||
          p.name.toLowerCase().includes(s) ||
          (p.barcode ?? "").toLowerCase().includes(s) ||
          (p.sku ?? "").toLowerCase().includes(s) ||
          (p.category ?? "").toLowerCase().includes(s)),
    );
  }, [products, q, cat]);

  const counts = useMemo(() => {
    const service = matched.filter(isService).length;
    return { all: matched.length, service, product: matched.length - service };
  }, [matched]);

  // Counted over the WHOLE catalogue, not the current search — this number has
  // to match the bell's, and the bell doesn't know what you typed.
  const lowTotal = useMemo(() => products.filter((p) => p.low).length, [products]);

  const filtered = useMemo(() => {
    const byKind = kind === "all" ? matched : matched.filter((p) => (kind === "service" ? isService(p) : !isService(p)));
    return low ? byKind.filter((p) => p.low) : byKind;
  }, [matched, kind, low]);

  // Render a WINDOW of the matches, not all of them. The whole catalogue still
  // lives in memory (so search stays instant and offline-quick), but drawing all
  // ~800 rows — each one a mobile card AND a desktop row — produced 1.7MB of HTML
  // on every visit. Sixty is more than a screenful; "Show more" reveals the rest.
  const PAGE = 60;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [q, cat, kind, low]); // a new filter starts at the top again
  const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const hidden = filtered.length - shown.length;

  // When the business prices VAT-inclusive, show the gross sell price (what the
  // customer pays) rather than the ex-VAT figure we store.
  // grossCents, not the inline formula it replaced: net * (1 + r/100) rounds a cent differently
  // from the ledger's add-its-own-rounded-VAT, so this column disagreed with the counter, the
  // receipt and the invoice on 7 live products.
  const sellOf = (r: InventoryRow) => (pricesInclVat ? grossCents(r.sellCents, r.vatRatePct ?? vatDefault) : r.sellCents);

  function newProduct() { setEditing(null); setOpen(true); }
  function edit(p: InventoryRow) { setEditing(p); setOpen(true); }

  const KINDS: { key: KindFilter; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "service", label: "Services", n: counts.service },
    { key: "product", label: "Products", n: counts.product },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={`${field} w-full pl-9 sm:w-[240px]`} placeholder="Search products, barcode, SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-[10px] border border-line-2 bg-sub p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-bold ${kind === k.key ? "bg-card text-ink shadow-[0_1px_3px_rgba(15,23,32,0.12)]" : "text-muted hover:text-body"}`}
            >
              {k.label}
              <span className="num text-[10.5px] font-semibold opacity-60">{k.n}</span>
            </button>
          ))}
        </div>
        <select className={field} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {lowTotal > 0 && (
          <button
            onClick={() => setLow((v) => !v)}
            title={`Stocked, but under the threshold at ${floorName} — move some over from the warehouse`}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12.5px] font-bold ${low ? "border-amber-ink bg-[rgba(245,166,35,0.14)] text-amber-ink" : "border-line-2 bg-card text-body hover:border-brand"}`}
          >
            <TriangleAlert size={14} /> Low at {floorName}
            <span className="num opacity-70">{lowTotal}</span>
          </button>
        )}
        <span className="text-[12.5px] text-muted">
          {filtered.length}
          {filtered.length !== products.length ? ` of ${products.length}` : ""} item{filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <Link
          href={showArchived ? "/products" : "/products?archived=1"}
          className={btn()}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
        <button onClick={newProduct} className={btn("primary")}>
          <Plus size={15} strokeWidth={2.4} /> {kind === "service" ? "New service" : "New product"}
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="hidden gap-2.5 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-th md:grid" style={gridCols(locations.length)}>
          <span>Product</span>
          <span>Category</span>
          <span className="text-right">Cost</span>
          <span className="text-right">{pricesInclVat ? "Sell inc VAT" : "Sell"}</span>
          <span className="text-right">Margin</span>
          {locations.map((l) => (
            <span key={l.id} className="truncate text-right" title={l.name}>
              {l.name}
            </span>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">
            {products.length === 0
              ? "Nothing in the catalogue yet. Add your first with “New product”."
              : `No ${kind === "service" ? "services" : kind === "product" ? "products" : "items"} match your filter.`}
          </div>
        ) : (
          shown.map((r) => (
            <button key={r.id} onClick={() => edit(r)} className={`block w-full border-b border-line text-left hover:bg-sub ${r.isActive ? "" : "opacity-55"}`}>
              {/* Mobile card */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
                <Thumb url={r.photoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-body">{r.name}</span>
                    {kind === "all" && isService(r) && <span className="shrink-0 rounded-[5px] bg-[rgba(124,92,232,0.14)] px-1.5 py-0.5 text-[9px] font-bold text-[#5b45b0]">SERVICE</span>}
                    {r.barcode && <Barcode size={12} className="shrink-0 text-faint" />}
                    <StockBadge state={r.state} floor={floorName} />
                    {!r.isActive && <span className="shrink-0 rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9px] font-bold text-faint">ARCHIVED</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    {r.category && <span className="rounded-[6px] bg-[rgba(43,140,255,0.08)] px-2 py-0.5 font-semibold text-link">{r.category}</span>}
                    {r.stock && <span>{locations.map((l) => `${l.name} ${qty(r.stock![l.id])}`).join(" · ")}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[14px] font-bold text-ink-strong">{formatMUR(sellOf(r))}</div>
                  <div className="num text-[10.5px] font-semibold text-mint">{r.marginPct}%</div>
                </div>
              </div>
              {/* Desktop grid — min-w-0 everywhere a 1fr cell truncates: a grid
                  track's min width is its CONTENT width, and the imported names
                  are long enough to shove the money columns into each other. */}
              <div className="hidden items-center gap-2.5 px-5 py-3 md:grid" style={gridCols(locations.length)}>
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-body">
                  <Thumb url={r.photoUrl} size={24} />
                  <span className="min-w-0 truncate" title={r.name}>{r.name}</span>
                  {/* Purple = workshop work, the same colour the dashboard uses
                      to split workshop revenue from counter revenue. */}
                  {kind === "all" && isService(r) && <span className="shrink-0 rounded-[5px] bg-[rgba(124,92,232,0.14)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-[#5b45b0]">SERVICE</span>}
                  {r.barcode && <Barcode size={13} className="shrink-0 text-faint" />}
                  <StockBadge state={r.state} floor={floorName} />
                  {!r.isActive && <span className="shrink-0 rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-faint">ARCHIVED</span>}
                </span>
                <span className="min-w-0 truncate">
                  {r.category ? <span className="rounded-[6px] bg-[rgba(43,140,255,0.08)] px-2 py-0.5 text-[10.5px] font-semibold text-link" title={r.category}>{r.category}</span> : <span className="text-[11px] text-faint">—</span>}
                </span>
                <span className="num text-right text-[12px] text-muted">{formatMUR(r.costCents)}</span>
                <span className="num text-right text-[12px] font-semibold text-body">{formatMUR(sellOf(r))}</span>
                <span className="num text-right text-[12px] font-semibold text-mint">{r.marginPct}%</span>
                {/* The selling floor is the number that decides whether a
                    customer goes home happy, so it carries the weight and the
                    low-stock colour; the stores are context. */}
                {locations.map((l) => {
                  const n = r.stock ? r.stock[l.id] : null;
                  const isFloor = l.isSalesFloor;
                  return (
                    <span
                      key={l.id}
                      className={`num text-right ${isFloor ? "text-[14px] font-extrabold" : "text-[12px] text-muted"}`}
                      style={isFloor ? { color: r.low ? "#b07c14" : n == null ? "#8c96a1" : "#172130" } : undefined}
                    >
                      {qty(n)}
                    </span>
                  );
                })}
              </div>
            </button>
          ))
        )}

        {hidden > 0 && (
          <div className="flex items-center justify-center gap-3 bg-band px-5 py-3">
            <span className="text-[12px] text-muted">
              Showing {shown.length} of {filtered.length}
            </span>
            <button
              onClick={() => setLimit((l) => l + PAGE)}
              className={btn("ghost", "sm")}
            >
              Show {Math.min(hidden, PAGE)} more
            </button>
            {hidden > PAGE && (
              <button onClick={() => setLimit(filtered.length)} className="text-[12px] font-semibold text-link hover:underline">
                Show all {filtered.length}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Creating from the Services view starts the form as a service — the
          thing you asked for is the thing you get. */}
      <ProductFormModal
        open={open}
        onClose={() => setOpen(false)}
        product={editing}
        defaultKind={kind === "service" ? "service" : undefined}
        vatDefault={vatDefault}
        pricesInclVat={pricesInclVat}
        categories={categories}
        tenantId={tenantId}
      />
    </>
  );
}
