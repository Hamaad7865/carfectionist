"use client";

import { useState } from "react";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  FileText,
  KeyRound,
  Minus,
  Pencil,
  Plus,
  ReceiptText,
  Smartphone,
  Split,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowKnob, Segmented } from "@/components/tyrecentre/primitives";
import { knobPill } from "@/components/tyrecentre/tc";
import { TyreGlyph } from "@/components/tyrecentre/TyreMark";
import { initials } from "@/components/tyrecentre/TyreSidebar";
import { computeLineTotals, formatAmount, formatMUR, parseMoneyInput, type Allowance, type DocumentTotals } from "@/lib/money";
import { ENTITY, entityVars } from "@/lib/tyrecentre/entity-colours";
import type { PosRules } from "@/lib/supabase/queries/builder";
import type { SaleCompany, SaleVehicle } from "@/lib/supabase/queries/tyrecentre-sale";
import { lineDiscountLimits, settleMessage, type CartLine, type DiscountKind, type PendingSettle } from "@/features/counter/settle";
import type { SplitMethod } from "@/features/counter/split";
import { carLabel } from "./CustomerPicker";

export type PayMethod = "cash" | "card" | "juice" | "split" | "bank_transfer" | "cheque" | "credit";
export const METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Cash",
  card: "Card",
  juice: "Juice",
  split: "Split",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  credit: "On account",
};
const MORE: PayMethod[] = ["bank_transfer", "cheque", "credit"];
const SPLIT_METHODS: SplitMethod[] = ["cash", "card", "juice", "bank_transfer", "cheque"];

export interface SplitRow {
  method: SplitMethod;
  amount: string;
  tendered: string;
}

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function LineRow({
  line,
  pricesInclVat,
  posRules,
  frozen,
  open,
  onToggle,
  onQty,
  onPatch,
}: {
  line: CartLine;
  pricesInclVat: boolean;
  posRules: PosRules;
  frozen: boolean;
  open: boolean;
  onToggle: () => void;
  onQty: (qty: number) => void;
  onPatch: (patch: Partial<CartLine>) => void;
}) {
  const p = line.product;
  const lt = computeLineTotals({
    qty: line.qty,
    unitCents: p.priceCents,
    discountPct: line.discountPct,
    discountKind: line.discountKind,
    discountAmountCents: line.discountAmountCents,
    vatRatePct: p.vatRate,
    priceInclusive: p.priceIncludesVat,
  });
  const lim = lineDiscountLimits(line, posRules.carwashPct);
  const discounted = (line.discountPct ?? 0) > 0 || (line.discountAmountCents ?? 0) > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2.5 py-1 text-left text-[13px] hover:opacity-80"
      >
        <span className="w-7 shrink-0 font-mono text-[12px] text-tc-faint">{fmtQty(line.qty)}×</span>
        <span className="min-w-0 flex-1 truncate text-tc-body">
          {p.name}
          {discounted && <span className="ml-1.5 text-[11px] font-semibold text-tc-warning">disc.</span>}
        </span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-tc-ink">
          {formatAmount(pricesInclVat ? lt.exclCents + lt.vatCents : lt.exclCents)}
        </span>
      </button>
      {open && (
        <div className="mb-1.5 mt-1 flex flex-wrap items-center gap-2 rounded-[12px] bg-tc-card/80 p-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="One less" disabled={frozen} onClick={() => onQty(line.qty - 1)} className="grid size-8 place-items-center rounded-full bg-tc-sub text-tc-body disabled:opacity-50">
              <Minus className="size-3.5" />
            </button>
            <span className="w-8 text-center font-mono text-[13px] font-bold text-tc-ink">{fmtQty(line.qty)}</span>
            <button type="button" aria-label="One more" disabled={frozen} onClick={() => onQty(line.qty + 1)} className="grid size-8 place-items-center rounded-full bg-tc-sub text-tc-body disabled:opacity-50">
              <Plus className="size-3.5" />
            </button>
          </div>
          <div
            className={`flex h-8 items-center rounded-full bg-tc-sub pl-1 ${lim.disabled ? "opacity-50" : ""}`}
            title={lim.disabled ? "This item is not discounted — ask the owner" : "Line discount (% or Rs off)"}
          >
            <button
              type="button"
              disabled={frozen || lim.disabled}
              onClick={() => onPatch({ discountKind: line.discountKind === "amount" ? "percent" : "amount", discountPct: 0, discountAmountCents: 0 })}
              className="grid h-6 min-w-7 place-items-center rounded-full bg-white px-1 font-mono text-[10.5px] font-bold text-tc-muted"
            >
              {line.discountKind === "amount" ? "Rs" : "%"}
            </button>
            <input
              aria-label="Line discount"
              value={line.discountKind === "amount" ? (line.discountAmountCents ? String(line.discountAmountCents / 100) : "") : line.discountPct || ""}
              readOnly={frozen}
              disabled={lim.disabled}
              inputMode="decimal"
              placeholder="disc"
              onChange={(e) =>
                line.discountKind === "amount"
                  ? onPatch({ discountAmountCents: Math.min(lim.amtMaxCents, Math.max(0, parseMoneyInput(e.target.value) ?? 0)) })
                  : onPatch({ discountPct: Math.min(lim.pctMax, Math.max(0, parseFloat(e.target.value) || 0)) })
              }
              className="h-8 w-14 bg-transparent pr-3 text-right font-mono text-[12px] text-tc-body outline-none placeholder:text-tc-faint"
            />
          </div>
          <button type="button" disabled={frozen} onClick={() => onQty(0)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-tc-danger-ink hover:bg-tc-danger-soft disabled:opacity-50">
            <Trash2 className="size-3.5" /> Remove
          </button>
        </div>
      )}
    </li>
  );
}

export interface CartPanelProps {
  customerName: string;
  customerKnown: boolean;
  vehicle: SaleVehicle | null;
  onEditCustomer: () => void;
  companies: SaleCompany[];
  lines: CartLine[];
  pricesInclVat: boolean;
  posRules: PosRules;
  totals: DocumentTotals;
  allowance: Allowance;
  blockReason: string | null;
  orderDiscKind: DiscountKind | null;
  orderDiscValue: number;
  orderDiscReason: string;
  onOrderDiscount: (kind: DiscountKind | null, value: number) => void;
  onOrderDiscountReason: (r: string) => void;
  onAskOwner: () => void;
  onQty: (productId: string, qty: number) => void;
  onPatchLine: (productId: string, patch: Partial<CartLine>) => void;
  method: PayMethod;
  onMethod: (m: PayMethod) => void;
  tender: string;
  onTender: (v: string) => void;
  payRef: string;
  onPayRef: (v: string) => void;
  split: SplitRow[];
  onSplit: (rows: SplitRow[]) => void;
  busy: boolean;
  keeping: "quote" | "job" | null;
  error: string | null;
  pending: PendingSettle | null;
  notice: string | null;
  onCharge: () => void;
  onAbandon: () => void;
  onSaveJob: () => void;
  onQuote: () => void;
  onClear: () => void;
}

export function CartPanel(props: CartPanelProps) {
  const { lines, totals, companies, method, pending } = props;
  const frozen = pending !== null;
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const company = companies[0] ?? { name: "", vatRegistered: true, vatRate: 15 };
  const bills = lines.length > 0 ? 1 : 0;
  const col = entityVars(0);
  const tenderCents = parseMoneyInput(props.tender);
  const changeCents = method === "cash" && tenderCents != null ? tenderCents - totals.totalCents : null;
  const splitSum = props.split.reduce((s, r) => s + (parseMoneyInput(r.amount) ?? 0), 0);
  const splitLeft = totals.totalCents - splitSum;
  const setRow = (i: number, patch: Partial<SplitRow>) => props.onSplit(props.split.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const discounted = totals.discountCents > 0;
  // What the bill actually charges decides its VAT lines — a product can carry VAT even where the
  // company has no VAT number on file, and hiding them would make the total look wrong.
  const showVat = company.vatRegistered || totals.vatCents > 0;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[26px] bg-white shadow-tc-cart xl:h-full" aria-label="Sale">
      {/* Customer */}
      <div className="flex items-center gap-3 border-b border-tc-line px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-linear-135 from-[#2b8cff] to-[#6a5cff] text-[13px] font-bold text-white">
          {props.customerKnown ? initials(props.customerName) : <UserRound className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-tc-ink">{props.customerName || "Walk-in customer"}</div>
          <div className="truncate font-mono text-[11px] uppercase tracking-[0.04em] text-tc-muted">
            {props.vehicle ? [props.vehicle.plate, carLabel(props.vehicle)].filter(Boolean).join(" · ") : props.customerKnown ? "No car picked" : "Pick a customer for a car's history"}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onEditCustomer}
          disabled={frozen}
          aria-label="Change customer or car"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-tc-line-2 text-tc-body hover:bg-tc-sub disabled:opacity-50"
        >
          <Pencil className="size-4" />
        </button>
      </div>

      {/* Bills */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {lines.length === 0 ? (
          <div className="grid h-full min-h-[160px] place-items-center text-center text-[13px] text-tc-faint">
            Tap a tile to start the sale.
          </div>
        ) : (
          <section className={`rounded-[18px] border p-3.5 ${ENTITY.tint} ${ENTITY.border}`} style={col} aria-label={`Bill — ${company.name}`}>
            <header className="flex items-center gap-2.5">
              <span className={`grid size-8 place-items-center rounded-[9px] ${ENTITY.soft} ${ENTITY.icon}`}>
                <TyreGlyph size={17} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-bold text-tc-ink">{company.name}</div>
                <div className={`font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${ENTITY.ink}`}>
                  Invoice 1 of {bills} · {showVat ? `VAT ${company.vatRate}%` : "Not VAT-registered"}
                </div>
              </div>
            </header>
            <ul className="mt-2.5">
              {lines.map((l) => (
                <LineRow
                  key={l.product.id}
                  line={l}
                  pricesInclVat={props.pricesInclVat}
                  posRules={props.posRules}
                  frozen={frozen}
                  open={openLine === l.product.id}
                  onToggle={() => setOpenLine((o) => (o === l.product.id ? null : l.product.id))}
                  onQty={(q) => props.onQty(l.product.id, q)}
                  onPatch={(patch) => props.onPatchLine(l.product.id, patch)}
                />
              ))}
            </ul>
            <div className={`mt-2 border-t border-dashed pt-2 text-[12.5px] ${ENTITY.dash}`}>
              {discounted && (
                <div className="flex justify-between py-0.5 text-tc-warning">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">−{formatAmount(totals.discountCents)}</span>
                </div>
              )}
              {showVat && (
                <>
                  <div className="flex justify-between py-0.5 text-tc-muted">
                    <span>Subtotal excl. VAT</span>
                    <span className="font-mono tabular-nums">{formatAmount(totals.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 text-tc-muted">
                    <span>VAT {company.vatRate}%</span>
                    <span className="font-mono tabular-nums">{formatAmount(totals.vatCents)}</span>
                  </div>
                </>
              )}
              <div className="mt-1 flex items-baseline justify-between text-[14px] font-bold text-tc-ink">
                <span>Total</span>
                <span className="font-mono tabular-nums">{formatMUR(totals.totalCents)}</span>
              </div>
            </div>
          </section>
        )}

        {lines.length > 0 && (discountOpen || props.orderDiscKind) && (
          <div className="mt-3 rounded-[16px] bg-tc-sub p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[12.5px] font-semibold text-tc-body">Discount on the whole sale</span>
              <div className="flex h-8 items-center rounded-full bg-white pl-1">
                <button
                  type="button"
                  disabled={frozen}
                  onClick={() => props.onOrderDiscount((props.orderDiscKind ?? "percent") === "amount" ? "percent" : "amount", 0)}
                  className="grid h-6 min-w-7 place-items-center rounded-full bg-tc-sub px-1 font-mono text-[10.5px] font-bold text-tc-muted"
                >
                  {props.orderDiscKind === "amount" ? "Rs" : "%"}
                </button>
                <input
                  aria-label="Discount on the whole sale"
                  value={props.orderDiscKind === "amount" ? (props.orderDiscValue ? String(props.orderDiscValue / 100) : "") : props.orderDiscValue || ""}
                  readOnly={frozen}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(e) => {
                    const v = e.target.value;
                    if ((props.orderDiscKind ?? "percent") === "amount") {
                      const c = parseMoneyInput(v) ?? 0;
                      props.onOrderDiscount(c > 0 ? "amount" : null, c);
                    } else {
                      const pct = Math.min(100, Math.max(0, parseFloat(v) || 0));
                      props.onOrderDiscount(pct > 0 ? "percent" : null, pct);
                    }
                  }}
                  className="h-8 w-16 bg-transparent pr-3 text-right font-mono text-[12.5px] text-tc-body outline-none"
                />
              </div>
            </div>
            {props.allowance.actualCents > 0 && (
              <p className="mt-1.5 text-[11.5px] text-tc-faint">Up to {formatMUR(props.allowance.ceilingCents)} may be discounted on this sale.</p>
            )}
            {props.allowance.reasonRequired && (
              <input
                value={props.orderDiscReason}
                onChange={(e) => props.onOrderDiscountReason(e.target.value)}
                readOnly={frozen}
                placeholder="Why — e.g. regular customer"
                className="mt-2 h-9 w-full rounded-full bg-white px-3.5 text-[12.5px] text-tc-ink outline-none placeholder:text-tc-faint"
              />
            )}
            {props.allowance.overCeiling && !frozen && (
              <button type="button" onClick={props.onAskOwner} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[12.5px] font-semibold text-tc-ink">
                <KeyRound className="size-3.5" /> Ask the owner
              </button>
            )}
          </div>
        )}

        {companies.length > 1 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-[14px] bg-tc-sub p-3 text-[12px] text-tc-body">
            <ReceiptText className="mt-0.5 size-4 shrink-0" />
            <p>
              One payment, <b>{companies.length} receipts</b>. Each company&apos;s invoice number is given when you charge.
            </p>
          </div>
        )}
      </div>

      {/* Pay */}
      <div className="border-t border-tc-line px-5 pb-4 pt-3.5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-tc-faint">
          To pay · {bills} invoice{bills === 1 ? "" : "s"}
        </div>
        <div className="mt-0.5 font-display text-[32px] font-medium tracking-[-1px] text-tc-ink">{formatMUR(totals.totalCents)}</div>

        <div className="mt-2.5 flex items-center gap-1.5">
          <Segmented
            label="Payment method"
            tone="sub"
            className="min-w-0 flex-1"
            itemClassName="min-w-0 max-sm:px-1.5 max-sm:[&_svg]:hidden"
            disabled={frozen}
            value={method}
            onChange={props.onMethod}
            options={[
              { value: "cash", label: <><Banknote /> Cash</> },
              { value: "card", label: <><CreditCard /> Card</> },
              { value: "juice", label: <><Smartphone /> Juice</> },
              { value: "split", label: <><Split /> Split</> },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={frozen}
              className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-[14px] px-3 text-[13px] ${MORE.includes(method) ? "bg-tc-primary font-semibold text-tc-on-primary" : "bg-tc-sub text-tc-muted"}`}
            >
              {MORE.includes(method) ? METHOD_LABEL[method] : "More"} <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-[12px]">
              {MORE.map((m) => (
                <DropdownMenuItem key={m} onSelect={() => props.onMethod(m)}>
                  {METHOD_LABEL[m]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {method === "cash" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={props.tender}
              onChange={(e) => props.onTender(e.target.value)}
              readOnly={frozen}
              inputMode="decimal"
              placeholder="Cash handed over (Rs)"
              className="h-10 flex-1 rounded-full bg-tc-sub px-4 text-right font-mono text-[13px] text-tc-ink outline-none placeholder:font-sans placeholder:text-tc-faint"
            />
            {changeCents != null && changeCents >= 0 && (
              <span className="whitespace-nowrap text-[13px] font-semibold text-tc-success">Change {formatMUR(changeCents)}</span>
            )}
          </div>
        )}
        {(method === "card" || method === "juice" || method === "bank_transfer" || method === "cheque") && (
          <input
            value={props.payRef}
            onChange={(e) => props.onPayRef(e.target.value)}
            readOnly={frozen}
            placeholder={method === "cheque" ? "Cheque no. (optional)" : "Approval / reference no. (optional)"}
            className="mt-2 h-10 w-full rounded-full bg-tc-sub px-4 text-[13px] text-tc-ink outline-none placeholder:text-tc-faint"
          />
        )}
        {method === "credit" && (
          <p className="mt-2 rounded-[12px] bg-tc-amber-soft px-3 py-2 text-[12px] text-tc-amber-ink">
            Nothing collected now — <b>{formatMUR(totals.totalCents)}</b> goes on this customer&apos;s account.
          </p>
        )}
        {method === "split" && (
          <div className="mt-2 flex flex-col gap-1.5">
            {props.split.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Select value={r.method} onValueChange={(v) => setRow(i, { method: v as SplitMethod })} disabled={frozen}>
                  <SelectTrigger aria-label={`Part ${i + 1} method`} className="h-9 w-[118px] rounded-full border-0 bg-tc-sub text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPLIT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  aria-label={`Part ${i + 1} amount`}
                  value={r.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                  readOnly={frozen}
                  inputMode="decimal"
                  placeholder="Rs"
                  className="h-9 min-w-0 flex-1 rounded-full bg-tc-sub px-3 text-right font-mono text-[12.5px] text-tc-ink outline-none"
                />
                {splitLeft > 0 && !frozen && (
                  <button
                    type="button"
                    onClick={() => setRow(i, { amount: String(((parseMoneyInput(r.amount) ?? 0) + splitLeft) / 100) })}
                    className="h-9 shrink-0 rounded-full px-2 text-[11.5px] font-semibold text-tc-ink hover:bg-tc-sub"
                  >
                    + rest
                  </button>
                )}
                {props.split.length > 2 && !frozen && (
                  <button type="button" aria-label={`Remove part ${i + 1}`} onClick={() => props.onSplit(props.split.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-full text-tc-faint hover:text-tc-danger">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
            {props.split.some((r) => r.method === "cash") && (
              <input
                value={props.split.find((r) => r.method === "cash")?.tendered ?? ""}
                onChange={(e) => props.onSplit(props.split.map((r) => (r.method === "cash" ? { ...r, tendered: e.target.value } : r)))}
                readOnly={frozen}
                inputMode="decimal"
                placeholder="Cash handed over for the cash part (optional)"
                className="h-9 rounded-full bg-tc-sub px-3 text-right font-mono text-[12px] text-tc-ink outline-none placeholder:font-sans placeholder:text-tc-faint"
              />
            )}
            <div className="flex items-center justify-between text-[12px]">
              {!frozen && (
                <button
                  type="button"
                  onClick={() => props.onSplit([...props.split, { method: "card", amount: "", tendered: "" }])}
                  className="font-semibold text-tc-ink hover:underline"
                >
                  + Add a part
                </button>
              )}
              <span className={`ml-auto font-mono ${splitLeft === 0 ? "text-tc-success" : "text-tc-warning"}`}>
                {splitLeft === 0 ? "Covers the total" : splitLeft > 0 ? `${formatMUR(splitLeft)} left` : `${formatMUR(-splitLeft)} over`}
              </span>
            </div>
          </div>
        )}

        {props.blockReason && <p className="mt-2 text-[12px] font-semibold text-tc-danger-ink">{props.blockReason}</p>}
        {props.error && <p className="mt-2 rounded-[12px] bg-tc-danger-soft px-3 py-2 text-[12.5px] text-tc-danger-ink">{props.error}</p>}
        {pending && (
          <div className="mt-2 rounded-[12px] bg-tc-amber-soft px-3 py-2.5">
            <p className="text-[12.5px] font-semibold text-tc-amber-ink">{settleMessage(pending)}</p>
            <button type="button" onClick={props.onAbandon} className="mt-2 h-8 rounded-full border border-tc-amber-border bg-tc-card px-3 text-[12px] font-bold text-tc-amber-ink">
              Abandon sale
            </button>
          </div>
        )}
        {props.notice && <p className="mt-2 text-[12px] font-semibold text-tc-warning">{props.notice}</p>}

        <button
          type="button"
          onClick={props.onCharge}
          disabled={props.busy || lines.length === 0 || totals.totalCents <= 0 || !!props.blockReason || (method === "split" && splitLeft !== 0)}
          className={`${knobPill(52)} mt-3`}
        >
          <span>
            {props.busy
              ? "Working…"
              : lines.length > 0 && totals.totalCents <= 0
                ? "Nothing to charge"
                : frozen
                  ? `Charge ${formatMUR(totals.totalCents)} again`
                  : method === "credit"
                    ? `Put ${formatMUR(totals.totalCents)} on account`
                    : `Charge ${formatMUR(totals.totalCents)}`}
          </span>
          {!props.busy && <ArrowKnob />}
        </button>

        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-tc-muted">
          <button type="button" onClick={props.onSaveJob} disabled={frozen || lines.length === 0 || !!props.keeping} className="hover:text-tc-ink disabled:opacity-40">
            {props.keeping === "job" ? "Saving…" : "Save as job"}
          </button>
          <button type="button" onClick={props.onQuote} disabled={frozen || lines.length === 0 || !!props.keeping} className="inline-flex items-center gap-1 hover:text-tc-ink disabled:opacity-40">
            <FileText className="size-3.5" />
            {props.keeping === "quote" ? "Saving…" : "Make a quote"}
          </button>
          {!discountOpen && !props.orderDiscKind && (
            <button type="button" onClick={() => setDiscountOpen(true)} disabled={frozen || lines.length === 0} className="hover:text-tc-ink disabled:opacity-40">
              Discount
            </button>
          )}
          <button type="button" onClick={props.onClear} disabled={frozen || lines.length === 0} className="hover:text-tc-ink disabled:opacity-40">
            Clear
          </button>
        </div>
      </div>
    </aside>
  );
}
