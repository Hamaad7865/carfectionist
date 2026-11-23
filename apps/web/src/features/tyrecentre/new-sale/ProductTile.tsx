"use client";

import { Wrench, Package, CircleGauge, Scale, Hammer, Disc3 } from "lucide-react";
import { formatMURShelf, shelfCents } from "@/lib/money";
import { formatTyreSize } from "@/lib/tyrecentre/tyre-size";
import type { CatalogueItem } from "./catalogue-model";

const ALIGN = /align/i;
const BALANCE = /balanc/i;
const REPAIR = /puncture|repair|patch/i;

/** The tile's square icon: a service by what it does, a part as a box. */
function ItemIcon({ name, service, part }: { name: string; service: boolean; part: boolean }) {
  const cls = "size-[22px]";
  if (!service) return part ? <Package className={cls} /> : <Disc3 className={cls} />;
  if (ALIGN.test(name)) return <CircleGauge className={cls} />;
  if (BALANCE.test(name)) return <Scale className={cls} />;
  if (REPAIR.test(name)) return <Hammer className={cls} />;
  return <Wrench className={cls} />;
}

/** Tyre glyph: a 52px dark ring around a light hub (spec §6.3). */
function TyreDisc() {
  return (
    <span className="grid size-[52px] shrink-0 place-items-center rounded-full border-[9px] border-[#0f1720] bg-tc-card dark:border-black dark:ring-1 dark:ring-white/15" aria-hidden>
      <span className="size-3.5 rounded-full bg-tc-fainter" />
    </span>
  );
}

function StockLine({ qty, unit }: { qty: number; unit: string }) {
  const n = Math.max(0, qty);
  const tone = n <= 0 ? "text-tc-danger" : n <= 5 ? "text-tc-warning" : "text-tc-success";
  return <span className={`text-[12px] font-medium ${tone}`}>{n <= 0 ? "None in shop" : `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`}</span>;
}

export function ProductTile({
  item,
  qty,
  pricesInclVat,
  vatRegistered,
  disabled,
  canPrice,
  onAdd,
}: {
  item: CatalogueItem;
  qty: number;
  pricesInclVat: boolean;
  vatRegistered: boolean;
  disabled: boolean;
  canPrice: boolean;
  onAdd: () => void;
}) {
  const p = item.product;
  const unpriced = p.priceCents <= 0;
  const inCart = qty > 0;
  const isService = item.category === "services";
  const micro = item.tyre?.brand || (isService ? "Service" : p.category || (item.category === "parts" ? "Parts" : "Tyres"));
  const title = item.tyre?.model ?? p.name;
  const sub = item.tyre ? [formatTyreSize(item.tyre.size), item.tyre.load].filter(Boolean).join(" · ") : null;

  return (
    <button
      type="button"
      disabled={disabled || (unpriced && !canPrice)}
      onClick={onAdd}
      title={unpriced && !canPrice ? "This item has no price — a manager has to set one before it can be sold." : undefined}
      aria-label={`${p.name}${inCart ? `, ${qty} in the sale` : ""}`}
      className={`relative flex min-h-[118px] flex-col rounded-[20px] bg-tc-card p-3.5 text-left shadow-tc-card transition-[box-shadow,transform] hover:-translate-y-px disabled:opacity-50 disabled:hover:translate-y-0 ${
        inCart ? "ring-2 ring-tc-primary" : "ring-1 ring-transparent hover:ring-tc-line-2"
      }`}
    >
      <span className="flex items-start gap-3">
        {item.tyre ? (
          <TyreDisc />
        ) : p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photoUrl} alt="" className="size-[52px] shrink-0 rounded-[14px] object-cover" />
        ) : (
          <span
            className={`grid size-[52px] shrink-0 place-items-center rounded-[14px] ${isService ? "bg-tc-blue-soft text-tc-blue-ink" : "bg-tc-amber-soft text-tc-amber-icon"}`}
            aria-hidden
          >
            <ItemIcon name={p.name} service={isService} part={item.category === "parts"} />
          </span>
        )}
        <span className="min-w-0 flex-1 pr-7">
          <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-tc-faint">{micro}</span>
          <span className="mt-0.5 line-clamp-2 block text-[14.5px] font-bold leading-snug text-tc-ink">{title}</span>
          {sub && <span className="mt-0.5 block text-[12px] text-tc-muted">{sub}</span>}
        </span>
      </span>
      <span className="mt-auto flex items-end justify-between gap-2 pt-2.5">
        {unpriced ? (
          <span className="text-[13px] font-bold text-tc-warning">{canPrice ? "Set a price →" : "No price"}</span>
        ) : (
          <span className="font-display text-[17px] font-semibold text-tc-ink">
            {formatMURShelf(shelfCents(p.priceCents, p.vatRate, pricesInclVat, p.priceIncludesVat))}
          </span>
        )}
        {p.isStocked ? (
          <StockLine qty={p.shopQty} unit="in shop" />
        ) : !vatRegistered ? (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-tc-blue-ink">No VAT</span>
        ) : null}
      </span>
      {inCart && (
        <span className="absolute right-3 top-3 grid h-6 min-w-6 place-items-center rounded-full bg-tc-primary px-1.5 text-[11.5px] font-bold text-tc-on-primary">
          ×{qty % 1 === 0 ? qty : qty.toFixed(1)}
        </span>
      )}
    </button>
  );
}
