"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Barcode, Search } from "lucide-react";
import { formatMUR } from "@/lib/money";
import { ProductFormModal } from "./ProductFormModal";
import type { InventoryRow } from "@/lib/supabase/queries/inventory";

const COLS = "grid-cols-[1fr_160px_90px_90px_70px_80px_80px_80px]";
const qty = (n: number | null) => (n == null ? "—" : String(n));
const field = "h-9 rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";

export function CataloguePanel({ products, showArchived, vatDefault }: { products: InventoryRow[]; showArchived: boolean; vatDefault: number }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const filtered = useMemo(() => {
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

  function newProduct() { setEditing(null); setOpen(true); }
  function edit(p: InventoryRow) { setEditing(p); setOpen(true); }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={`${field} w-[240px] pl-9`} placeholder="Search products, barcode, SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={field} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-[12.5px] text-muted">
          {filtered.length}
          {filtered.length !== products.length ? ` of ${products.length}` : ""} item{filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <Link
          href={showArchived ? "/products" : "/products?archived=1"}
          className="inline-flex h-9 items-center rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-body hover:border-brand"
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
        <button onClick={newProduct} className="grad-brand shadow-brand inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-bold text-white">
          <Plus size={15} strokeWidth={2.4} /> New product
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-[14px] border border-line bg-card">
        <div className={`grid ${COLS} gap-2.5 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-faint`}>
          <span>Product</span>
          <span>Category</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Sell</span>
          <span className="text-right">Margin</span>
          <span className="text-right">Store</span>
          <span className="text-right">Floor</span>
          <span className="text-right">On-hand</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">
            {products.length === 0 ? "No products. Add your first with “New product”." : "No products match your filter."}
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => edit(r)}
              className={`grid ${COLS} w-full items-center gap-2.5 border-b border-line px-5 py-3 text-left hover:bg-sub ${r.isActive ? "" : "opacity-55"}`}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-body">
                <span className="truncate">{r.name}</span>
                {r.barcode && <Barcode size={13} className="shrink-0 text-faint" />}
                {r.low && <span className="rounded-[5px] bg-[rgba(245,166,35,0.14)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-ink">LOW</span>}
                {!r.isActive && <span className="rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-faint">ARCHIVED</span>}
              </span>
              <span className="truncate">
                {r.category ? (
                  <span className="rounded-[6px] bg-[rgba(43,140,255,0.08)] px-2 py-0.5 text-[10.5px] font-semibold text-link">{r.category}</span>
                ) : (
                  <span className="text-[11px] text-faint">—</span>
                )}
              </span>
              <span className="num text-right text-[12px] text-muted">{formatMUR(r.costCents)}</span>
              <span className="num text-right text-[12px] font-semibold text-body">{formatMUR(r.sellCents)}</span>
              <span className="num text-right text-[12px] font-semibold text-mint">{r.marginPct}%</span>
              <span className="num text-right text-[12px] text-muted">{qty(r.store)}</span>
              <span className="num text-right text-[12px] text-muted">{qty(r.floor)}</span>
              <span className="num text-right text-[14px] font-extrabold" style={{ color: r.low ? "#b07c14" : r.onHand == null ? "#8c96a1" : "#172130" }}>
                {qty(r.onHand)}
              </span>
            </button>
          ))
        )}
      </div>

      <ProductFormModal open={open} onClose={() => setOpen(false)} product={editing} vatDefault={vatDefault} categories={categories} />
    </>
  );
}
