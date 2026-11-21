"use client";

import Link from "next/link";
import { Check, MessageCircle, Plus, Printer } from "lucide-react";
import { knobPill } from "@/components/tyrecentre/tc";
import { formatAmount, formatMUR } from "@/lib/money";
import { entityColours } from "@/lib/tyrecentre/entity-colours";

export interface PaidSale {
  invoiceId: string;
  number: string | null;
  totalCents: number;
  changeCents: number;
  tenderedCents: number | null;
  onAccount: boolean;
  methodLabel: string;
  companyName: string;
  customerName: string;
}

/** After the charge (DESIGN-SPEC §6.5, web): what was paid, the change to give, and the
 *  invoice numbers issue_document drew — shown only now, never before charging. */
export function PaidPanel({ sale, onNewSale }: { sale: PaidSale; onNewSale: () => void }) {
  const shareWhatsApp = () => {
    const text = [`${sale.companyName} — Receipt ${sale.number ?? ""}`.trim(), `Total: ${formatMUR(sale.totalCents)}`, "Thank you · drive safe"].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  return (
    <aside className="flex min-h-0 flex-col rounded-[26px] bg-tc-card p-6 shadow-tc-cart xl:h-full" aria-label="Paid">
      <span className="grid size-16 place-items-center rounded-full bg-tc-highlight text-tc-primary">
        <Check className="size-7" strokeWidth={2.4} />
      </span>
      <div className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-tc-faint" role="status">
        {sale.onAccount ? "On account" : `Paid · ${sale.methodLabel}`} · 1 receipt
      </div>
      <div className="mt-0.5 font-display text-[36px] font-medium tracking-[-1px] text-tc-ink">{formatMUR(sale.totalCents)}</div>
      <div className="text-[13px] text-tc-muted">{sale.customerName}</div>

      {sale.changeCents > 0 && (
        <div className="mt-5 rounded-[20px] bg-[#0f1720] p-5 dark:ring-1 dark:ring-white/10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-white/60">Give change</div>
          <div className="mt-1 font-display text-[44px] font-semibold leading-none tracking-[-1.5px] text-tc-highlight">{formatMUR(sale.changeCents)}</div>
          {sale.tenderedCents != null && <div className="mt-2 text-[13px] text-white/70">Tendered {formatMUR(sale.tenderedCents)}</div>}
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-2">
        <li className="flex items-center gap-2.5 text-[13.5px]">
          <span className="size-3 rounded-[3px]" style={{ background: entityColours(0).accent }} />
          <span className="min-w-0 flex-1 truncate text-tc-body">
            {sale.companyName} · <b className="font-mono font-bold text-tc-ink">{sale.number ?? "—"}</b>
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-tc-ink">{formatAmount(sale.totalCents)}</span>
        </li>
      </ul>
      <Link href={`/sales/${sale.invoiceId}`} className="mt-2 text-[12.5px] font-medium text-tc-muted hover:text-tc-ink hover:underline">
        View invoice →
      </Link>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
        <button
          type="button"
          onClick={() => window.open(`/print/receipt/${sale.invoiceId}`, "_blank")}
          className="inline-flex h-[54px] items-center justify-center gap-2 rounded-[16px] bg-tc-sub text-[14px] font-semibold text-tc-ink hover:bg-tc-track"
        >
          <Printer className="size-[18px]" /> Print
        </button>
        <button
          type="button"
          onClick={shareWhatsApp}
          className="inline-flex h-[54px] items-center justify-center gap-2 rounded-[16px] bg-tc-sub text-[14px] font-semibold text-tc-ink hover:bg-tc-track"
        >
          <MessageCircle className="size-[18px] text-tc-success" /> WhatsApp
        </button>
      </div>
      <button type="button" onClick={onNewSale} className={`${knobPill(52)} mt-2`} autoFocus>
        New sale
        <span className="grid size-7 place-items-center rounded-full bg-tc-highlight text-tc-primary">
          <Plus className="size-4" strokeWidth={2.4} />
        </span>
      </button>
    </aside>
  );
}
