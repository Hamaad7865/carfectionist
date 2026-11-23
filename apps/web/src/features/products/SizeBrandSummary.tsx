"use client";

import { X } from "lucide-react";
import {
  brandsForSize,
  formatSizeQuery,
  sizesForBrand,
  type AttrItem,
  type SizeQuery,
} from "@/lib/products/tyre-size";

const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The answer to "which brands do I have in 205/55?" (a size typed) or "which sizes does
 * Michelin come in?" (a brand picked). Each row narrows the list below it when clicked.
 * Stock is everything on hand across every location.
 */
export function SizeBrandSummary({
  items,
  size,
  brandKey,
  brandLabel,
  onPickBrand,
  onPickSize,
  onClear,
}: {
  items: AttrItem[];
  size: SizeQuery | null;
  brandKey: string;
  brandLabel: string;
  onPickBrand: (key: string) => void;
  onPickSize: (label: string) => void;
  onClear: () => void;
}) {
  // A size typed wins: the brand list is the question asked most at the counter.
  if (size) {
    const rows = brandsForSize(items, size);
    const total = rows.reduce((s, r) => s + r.products, 0);
    return (
      <Panel title={`In ${formatSizeQuery(size)}`} sub={total === 0 ? "No tyres in this size" : `${rows.length} brand${rows.length === 1 ? "" : "s"} · ${total} product${total === 1 ? "" : "s"}`} onClear={onClear}>
        {rows.map((r) => (
          <Row
            key={r.key || "-"}
            label={r.brand || "No brand recorded"}
            muted={!r.key}
            active={!!r.key && r.key === brandKey}
            products={r.products}
            qty={r.qty}
            onClick={r.key ? () => onPickBrand(r.key === brandKey ? "" : r.key) : undefined}
          />
        ))}
      </Panel>
    );
  }
  if (brandKey) {
    const rows = sizesForBrand(items, brandKey);
    return (
      <Panel title={`${brandLabel} sizes`} sub={rows.length === 0 ? "No tyre sizes recorded for this brand" : `${rows.length} size${rows.length === 1 ? "" : "s"}`} onClear={onClear}>
        {rows.map((r) => (
          <Row key={r.label} label={r.label} products={r.products} qty={r.qty} onClick={() => onPickSize(r.label)} />
        ))}
      </Panel>
    );
  }
  return null;
}

function Panel({ title, sub, onClear, children }: { title: string; sub: string; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-[14px] border border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-ink">{title}</span>
        <span className="text-[12px] text-muted">{sub}</span>
        <div className="flex-1" />
        <button onClick={onClear} title="Clear brand and size" aria-label="Clear brand and size" className="flex h-7 w-7 items-center justify-center rounded-[7px] text-faint hover:bg-sub hover:text-body">
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Row({ label, products, qty, onClick, active = false, muted = false }: { label: string; products: number; qty: number; onClick?: () => void; active?: boolean; muted?: boolean }) {
  const body = (
    <>
      <span className={`text-[12.5px] font-bold ${muted ? "text-muted" : "text-body"}`}>{label}</span>
      <span className="num text-[11.5px] text-muted">
        {products} product{products === 1 ? "" : "s"} · <span className={qty > 0 ? "font-semibold text-ink" : "text-rose"}>{qtyText(qty)} in stock</span>
      </span>
    </>
  );
  const cls = `inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 ${active ? "border-brand bg-[rgba(43,140,255,0.08)]" : "border-line-2 bg-sub"}`;
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:border-brand`}>{body}</button>
  ) : (
    <span className={cls}>{body}</span>
  );
}
