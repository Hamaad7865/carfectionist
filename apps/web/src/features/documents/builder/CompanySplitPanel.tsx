"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { combinedTotalCents, type CompanyDiscount, type CompanyPart } from "@/lib/documents/company-split";
import { entityVars, ENTITY } from "@/lib/tyrecentre/entity-colours";
import type { BuilderCompany } from "@/lib/supabase/queries/builder";

export interface SplitLine {
  key: string;
  title: string;
  qty: number;
  vatRatePct: number;
}

/** One company's quote of a split, as the panel draws it. */
export type SplitPart = CompanyPart<SplitLine, BuilderCompany> & { blockReason: string | null };

/** Small company chip — the line's company, coloured by its place in the shop's company order. */
export function CompanyChip({ name, index }: { name: string; index: number }) {
  return (
    <span
      style={entityVars(index)}
      title={`Sold by ${name}`}
      className={`inline-flex h-6 max-w-[150px] items-center truncate rounded-full px-2.5 text-[11px] font-bold ${ENTITY.soft} ${ENTITY.ink}`}
    >
      {name}
    </span>
  );
}

/**
 * A draft whose lines are sold by two companies (tyre centre): the quotes it becomes, side by
 * side, before anything is numbered. Each company's card has its own letterhead line, lines,
 * subtotal, VAT (or "VAT exempt"), total and its own discount; the strip below adds them up.
 * The numbers come later, from each company's own series, when the draft is issued or sent.
 */
export function CompanySplitPanel({
  parts,
  docType,
  readOnly,
  onDiscount,
}: {
  parts: SplitPart[];
  docType: "quote" | "invoice";
  readOnly: boolean;
  onDiscount: (companyId: string, d: CompanyDiscount | null) => void;
}) {
  const noun = docType === "quote" ? "quotes" : "invoices";
  const one = docType === "quote" ? "quote" : "invoice";
  return (
    <section aria-label="Split preview" className="@container flex flex-col gap-4 rounded-[18px] border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-muted">PREVIEW</span>
        <span className="text-[16px] font-extrabold text-ink-strong">
          Issued as {parts.length} {noun}, one per company
        </span>
      </div>

      {/* Side by side once the column is wide enough (preview hidden); stacked beside the A4. */}
      <div className="grid gap-3.5 @[620px]:grid-cols-2">
        {parts.map((p) => (
          <CompanyCard key={p.company.id} part={p} one={one} readOnly={readOnly} onDiscount={onDiscount} />
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          {parts.map((p) => (
            <div key={p.company.id} style={entityVars(p.index)} className="flex flex-col gap-1 rounded-[14px] border border-line bg-sub px-3.5 py-3">
              <span className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{p.company.name}</span>
              <span className={`num font-display text-[18px] font-semibold ${ENTITY.ink}`}>{formatMUR(p.totals.totalCents)}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1 rounded-[14px] border border-[rgba(43,140,255,0.35)] bg-[linear-gradient(135deg,rgba(43,140,255,0.18),rgba(79,116,255,0.12))] px-3.5 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-body">Customer pays in all</span>
            <span className="num font-display text-[22px] font-semibold text-ink-strong">{formatMUR(combinedTotalCents(parts))}</span>
          </div>
      </div>
      <span className="text-[12px] text-muted">
        Each {one} gets its own number from its own company&rsquo;s series when you issue or send. Until then it stays one draft you can keep editing.
      </span>
    </section>
  );
}

function CompanyCard({
  part,
  one,
  readOnly,
  onDiscount,
}: {
  part: SplitPart;
  one: string;
  readOnly: boolean;
  onDiscount: (companyId: string, d: CompanyDiscount | null) => void;
}) {
  const { company, totals } = part;
  const [open, setOpen] = useState(part.discount != null);
  const discountShown = totals.grossSubtotalCents - totals.subtotalCents;
  // "VAT 15%" when every taxed line shares one rate; plain "VAT" otherwise.
  const rates = new Set(part.lines.filter((_, i) => (totals.lines[i]?.vatCents ?? 0) > 0).map((l) => l.vatRatePct));
  const vatPct = rates.size === 1 ? ` ${[...rates][0]}%` : "";
  const fiscal = [
    company.business.brn ? `BRN ${company.business.brn}` : null,
    company.vatRegistered ? (company.business.vatNo ? `VAT ${company.business.vatNo}` : "VAT registered") : "not VAT registered",
  ].filter(Boolean).join(" · ");

  return (
    <article style={entityVars(part.index)} className={`flex min-w-0 flex-col gap-3 rounded-[16px] border p-4 ${ENTITY.tint} ${ENTITY.border}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] font-display text-[16px] font-bold ${ENTITY.soft} ${ENTITY.ink}`}>
          {company.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14px] font-extrabold text-ink-strong">{company.business.legalName || company.name}</span>
          <span className="truncate font-mono text-[10.5px] text-muted">{fiscal}</span>
        </div>
        <span
          title={`Numbered in ${company.name}'s own series when issued`}
          className={`inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 font-mono text-[11px] font-semibold ${ENTITY.dash} ${ENTITY.ink}`}
        >
          {company.quotePrefix ? `${company.quotePrefix}…` : "New"}
        </span>
      </div>

      <div className={`flex flex-col border-t border-dashed pt-2 ${ENTITY.dash}`}>
        {part.lines.map((l, i) => (
          <div key={l.key} className="flex gap-2 py-1.5 text-[12.5px] text-body">
            <span className="min-w-0 flex-1 truncate">{l.title || "—"}</span>
            <span className="num w-8 text-right text-muted">{l.qty}</span>
            <span className="num w-[92px] text-right font-semibold text-ink">{formatMUR(totals.lines[i]?.exclCents ?? 0).replace(/^Rs\s?/, "")}</span>
          </div>
        ))}
      </div>

      {!readOnly && (open ? (
        <DiscountEditor
          value={part.discount}
          onChange={(d) => onDiscount(company.id, d)}
          onClose={() => {
            onDiscount(company.id, null);
            setOpen(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`h-8 rounded-[10px] border border-dashed bg-transparent px-2.5 text-left text-[12px] font-semibold ${ENTITY.dash} ${ENTITY.ink}`}
        >
          + Discount on this {one}
        </button>
      ))}
      {part.blockReason && <span className="text-[11.5px] font-semibold text-rose">{part.blockReason}</span>}

      <div className={`flex flex-col gap-1.5 border-t border-dashed pt-2.5 ${ENTITY.dash}`}>
        <Row label="Subtotal" value={formatMUR(totals.grossSubtotalCents)} />
        {discountShown > 0 && <Row label={`Discount${part.discount?.kind === "percent" ? ` ${part.discount.value}%` : ""}`} value={`− ${formatMUR(discountShown)}`} />}
        {company.vatRegistered ? (
          <Row label={`VAT${vatPct}`} value={formatMUR(totals.vatCents)} />
        ) : (
          <div className="flex items-center text-[12.5px] text-muted">
            <span className="flex-1">VAT</span>
            <span className="inline-flex h-5 items-center rounded-full bg-shade/[0.06] px-2 text-[11px] font-bold text-body">VAT exempt</span>
          </div>
        )}
        <div className="mt-1 flex items-baseline">
          <span className="flex-1 text-[13px] font-bold text-ink">Total</span>
          <span className="num font-display text-[22px] font-semibold tracking-[-0.4px] text-ink-strong">{formatMUR(totals.totalCents)}</span>
        </div>
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex text-[12.5px] text-muted">
      <span className="flex-1">{label}</span>
      <span className="num text-body">{value}</span>
    </div>
  );
}

/** % or Rs off this company's quote (VAT-inclusive, like the bill discount), and why. */
function DiscountEditor({
  value,
  onChange,
  onClose,
}: {
  value: CompanyDiscount | null;
  onChange: (d: CompanyDiscount | null) => void;
  onClose: () => void;
}) {
  const kind = value?.kind ?? "percent";
  const [text, setText] = useState(value ? String(kind === "amount" ? value.value / 100 : value.value) : "");
  const [reason, setReason] = useState(value?.reason ?? "");
  const commit = (k: "percent" | "amount", t: string, r: string) => {
    const n = k === "amount" ? Math.max(0, parseMoneyInput(t) ?? 0) : Math.min(100, Math.max(0, Number(t) || 0));
    onChange(n > 0 ? { kind: k, value: n, reason: r.trim() || null } : null);
  };
  // Remember the kind even before a value is typed, so the toggle does not snap back.
  const [k, setK] = useState<"percent" | "amount">(kind);
  return (
    <div className={`flex flex-col gap-2 rounded-[10px] border border-dashed p-2 ${ENTITY.dash}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center rounded-[8px] border border-line-2 bg-sub">
          <button
            type="button"
            onClick={() => {
              const next = k === "amount" ? "percent" : "amount";
              setK(next);
              setText("");
              onChange(null);
            }}
            title="Switch between % and Rs off"
            className="grid h-8 w-8 place-items-center text-[11px] font-bold text-faint"
          >
            {k === "amount" ? "Rs" : "%"}
          </button>
          <input
            value={text}
            inputMode="decimal"
            placeholder={k === "amount" ? "Rs off (incl. VAT)" : "% off"}
            aria-label="Discount on this quote"
            onChange={(e) => {
              setText(e.target.value);
              commit(k, e.target.value, reason);
            }}
            className="num h-8 w-full min-w-0 bg-transparent pr-2 text-[12.5px] font-semibold text-ink outline-none placeholder:text-faint"
          />
        </div>
        <button type="button" onClick={onClose} aria-label="Remove this discount" className="grid h-8 w-8 place-items-center rounded-[8px] text-faint hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <input
        value={reason}
        placeholder="Reason (optional)"
        aria-label="Reason for the discount"
        onChange={(e) => {
          setReason(e.target.value);
          commit(k, text, e.target.value);
        }}
        className="h-8 rounded-[8px] border border-line-2 bg-sub px-2.5 text-[12px] text-ink outline-none placeholder:text-faint focus:border-brand"
      />
    </div>
  );
}
