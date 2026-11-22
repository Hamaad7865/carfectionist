"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Car, RotateCcw, ScanBarcode, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Kbd } from "@/components/ui/kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/tyrecentre/primitives";
import { TC_MICRO, TC_ROUND } from "@/components/tyrecentre/tc";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";
import { parseMoneyInput } from "@/lib/money";
import { formatTyreSize, type SaleCategory } from "@/lib/tyrecentre/tyre-size";
import type { TyreSaleRef, SaleVehicle } from "@/lib/supabase/queries/tyrecentre-sale";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";
import { OwnerOverrideDialog } from "@/features/documents/OwnerOverrideDialog";
import { PriceProductDialog } from "@/features/counter/CounterSale";
import { counterSaleAction, keepCartAction } from "@/features/counter/actions";
import { getReceiptDataAction } from "@/features/counter/receipt-action";
import {
  EMPTY_BASKET,
  addProduct,
  patchLine as patchLineIn,
  pickCustomer,
  setApprovedMax,
  setCustomerName,
  setOrderDiscount,
  setOrderDiscountReason,
  setQty as setQtyIn,
  settleResolved,
  withSettleFailure,
  type Basket,
  type CartLine,
  type DiscountKind,
} from "@/features/counter/settle";
import { checkoutBillIdAction, getCarHistoryAction, type CarVisit } from "../sale-actions";
import { NO_DISCOUNT, billsBlockReason, billsOf, companyDiscountsPayload, grandTotalCents, type CompanyDiscount } from "./bills";
import {
  ANY_SIZE,
  SORT_LABEL,
  buildCatalogue,
  categoryCounts,
  filterCatalogue,
  isSizeSet,
  lastTyreSize,
  sizeFilterEquals,
  sizeOptions,
  type SizeFilter,
  type SortKey,
} from "./catalogue-model";
import { ProductTile } from "./ProductTile";
import { CartPanel, METHOD_LABEL, type PayMethod, type SplitRow } from "./CartPanel";
import { CustomerPicker } from "./CustomerPicker";
import { PaidPanel, type PaidSale } from "./PaidPanel";

const PAGE = 90;
const CHIPS: { value: SaleCategory | "all"; label: string; dot?: string }[] = [
  { value: "all", label: "All" },
  { value: "tyres", label: "Tyres", dot: "#F5A623" },
  { value: "parts", label: "Parts", dot: "#F7D08A" },
  { value: "services", label: "Services", dot: "#2B8CFF" },
];
const EMPTY_SPLIT: SplitRow[] = [
  { method: "cash", amount: "", tendered: "" },
  { method: "card", amount: "", tendered: "" },
];
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** The tyre-centre New sale (DESIGN-SPEC §6.3). Same money path as the counter: the basket
 *  model in counter/settle.ts and counterSaleAction (save_draft → issue_document →
 *  record_payment). The invoice number exists only after the charge. */
export function NewSale({ data, canPrice, shopLabel }: { data: TyreSaleRef; canPrice: boolean; shopLabel: string }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  // The shop's companies. Two or more (tyre centre: VAT tyres + non-VAT services) → one bill per
  // company, each with its own discount, one payment; one → the single-invoice sale as before.
  const several = data.companies.length > 1;
  const mainCompany = data.companies.find((c) => c.isDefault) ?? data.companies[0] ?? { id: "", name: shopLabel, vatRegistered: true, vatRate: 15, isDefault: true };
  const companyOf = (p: TyreSaleRef["products"][number]) => data.companies.find((c) => c.id === p.legalEntityId) ?? mainCompany;

  // ── catalogue ─────────────────────────────────────────────────────────────
  const catalogue = useMemo(() => buildCatalogue(data.products, data.soldQty), [data.products, data.soldQty]);
  const options = useMemo(() => sizeOptions(catalogue), [catalogue]);
  const counts = useMemo(() => categoryCounts(catalogue), [catalogue]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<SaleCategory | "all">("all");
  const [size, setSize] = useState<SizeFilter>(ANY_SIZE);
  const [sort, setSort] = useState<SortKey>("best");
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => filterCatalogue(catalogue, { q, category, size, sort }), [catalogue, q, category, size, sort]);

  // ── the sale ──────────────────────────────────────────────────────────────
  const [basket, setBasket] = useState<Basket>(EMPTY_BASKET);
  const frozen = basket.pending !== null;
  const [vehicle, setVehicle] = useState<SaleVehicle | null>(null);
  const [method, setMethod] = useState<PayMethod>("cash");
  const [tender, setTender] = useState("");
  const [payRef, setPayRef] = useState("");
  const [split, setSplit] = useState<SplitRow[]>(EMPTY_SPLIT);
  const [busy, setBusy] = useState(false);
  const [keeping, setKeeping] = useState<"quote" | "job" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNeg, setConfirmNeg] = useState<{ name: string; shop: number; warehouse: number; selling: number }[] | null>(null);
  const [paid, setPaid] = useState<PaidSale | null>(null);
  const [receipts, setReceipts] = useState<(ReceiptData | "error")[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The bill an owner's approval is being asked for: its company and the id it will carry.
  const [overrideFor, setOverrideFor] = useState<{ companyId: string; billId: string } | null>(null);
  const [coDisc, setCoDisc] = useState<Record<string, CompanyDiscount>>({});
  const [allocation, setAllocation] = useState("proportional");
  const [pricing, setPricing] = useState<TyreSaleRef["products"][number] | null>(null);
  const [history, setHistory] = useState<CarVisit[]>([]);
  // This sale's identity — the idempotency key and the id its invoice is drafted under.
  // Rotated together whenever a ticket ends (see CounterSale for why the draft id is named up front).
  const [saleIds, setSaleIds] = useState(() => ({ key: crypto.randomUUID(), draft: crypto.randomUUID() }));
  const rotateSaleIds = () => setSaleIds({ key: crypto.randomUUID(), draft: crypto.randomUUID() });

  const bills = useMemo(() => billsOf(basket, data.companies, coDisc, data.posRules.carwashPct), [basket, data.companies, coDisc, data.posRules.carwashPct]);
  const grandCents = grandTotalCents(bills);
  const blockReason = billsBlockReason(bills);

  // A bill's discount: its company's own when the shop has several, the whole sale's when one.
  const patchCo = (companyId: string, patch: Partial<CompanyDiscount>) => {
    if (frozen) return;
    setCoDisc((m) => ({ ...m, [companyId]: { ...(m[companyId] ?? NO_DISCOUNT), ...patch } }));
  };
  const onBillDiscount = (companyId: string, kind: DiscountKind | null, value: number) =>
    several ? patchCo(companyId, { kind, value }) : setBasket((b) => setOrderDiscount(b, kind, value));
  const onBillDiscountReason = (companyId: string, reason: string) =>
    several ? patchCo(companyId, { reason }) : setBasket((b) => setOrderDiscountReason(b, reason));
  async function askOwner(companyId: string) {
    const at = bills.findIndex((b) => b.company.id === companyId);
    const billId = several ? await checkoutBillIdAction(saleIds.draft, companyId, at === 0) : saleIds.draft;
    setOverrideFor({ companyId, billId });
  }
  const overrideBill = overrideFor ? bills.find((b) => b.company.id === overrideFor.companyId) : undefined;
  const qtyById = useMemo(() => new Map(basket.lines.map((l) => [l.product.id, l.qty])), [basket.lines]);

  // The car's last bills — and from them, its tyre size.
  useEffect(() => {
    if (!vehicle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no car, no history
      setHistory([]);
      return;
    }
    let live = true;
    getCarHistoryAction(vehicle.id)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [vehicle]);
  const carSize = useMemo(() => lastTyreSize(history), [history]);

  // The receipts that printed — the same ReceiptCard the print route renders, one per company.
  useEffect(() => {
    if (!paid) return;
    let live = true;
    const ids = paid.bills.length ? paid.bills.map((b) => b.id) : [paid.invoiceId];
    Promise.all(ids.map((id) => getReceiptDataAction(id).then((r) => r ?? ("error" as const)).catch(() => "error" as const)))
      .then((rs) => live && setReceipts(rs));
    return () => {
      live = false;
    };
  }, [paid]);

  // "/" jumps to the search, as the pill's hint says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const add = useCallback(
    (p: TyreSaleRef["products"][number]) => {
      if (p.priceCents <= 0) {
        if (canPrice) setPricing(p);
        return;
      }
      setBasket((b) => addProduct(b, p));
    },
    [canPrice],
  );
  const setQty = (id: string, qty: number) => {
    const next = setQtyIn(basket, id, qty);
    if (next.generation !== basket.generation) {
      rotateSaleIds();
      setCoDisc({}); // an emptied ticket drops its discounts, every company's
    }
    setBasket(next);
  };
  const patchLine = (id: string, patch: Partial<CartLine>) => setBasket((b) => patchLineIn(b, id, patch));

  function resetSale() {
    setBasket(EMPTY_BASKET);
    setVehicle(null);
    setMethod("cash");
    setTender("");
    setPayRef("");
    setSplit(EMPTY_SPLIT);
    setCoDisc({});
    setAllocation("proportional");
    setError(null);
    setPaid(null);
    setReceipts(null);
    setQ("");
    rotateSaleIds();
    router.refresh();
  }

  async function charge(force = false) {
    setError(null);
    const lines = basket.lines;
    if (lines.length === 0) return setError("Add at least one item.");
    if (method === "credit" && !basket.customerId) return setError("Pick a customer on file — the amount owed is tracked against them.");
    const tenderCents = parseMoneyInput(tender);
    if (method === "cash" && tenderCents != null && tenderCents < grandCents) return setError("The cash handed over is less than the total.");
    if (blockReason) return setError(blockReason);
    // Sales are never hard-blocked on stock; going below zero on the shop floor is confirmed.
    if (!force && !frozen) {
      const negatives = lines
        .filter((l) => l.product.isStocked && l.qty > l.product.shopQty)
        .map((l) => ({ name: l.product.name, shop: l.product.shopQty, warehouse: l.product.warehouseQty, selling: l.qty }));
      if (negatives.length > 0) return setConfirmNeg(negatives);
    }
    setBusy(true);
    const r = await counterSaleAction({
      customerId: basket.customerId ?? undefined,
      customerName: basket.customer.trim() || undefined,
      vehicleId: basket.customerId && vehicle ? vehicle.id : undefined,
      lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, discountKind: l.discountKind, discountPct: l.discountPct, discountAmountCents: l.discountAmountCents })),
      // Several companies: no whole-sale discount, each company's bill its own (owner rule).
      ...(several
        ? { companyDiscounts: companyDiscountsPayload(bills), allocation: method === "split" ? allocation : undefined }
        : { orderDiscountKind: basket.orderDiscKind, orderDiscountValue: basket.orderDiscValue, orderDiscountReason: basket.orderDiscReason }),
      method,
      tenderedCents: method === "cash" ? tenderCents : null,
      externalRef: method === "cash" || method === "split" ? undefined : payRef,
      split:
        method === "split"
          ? split.map((s) => ({
              method: s.method,
              amountCents: parseMoneyInput(s.amount) ?? 0,
              tenderedCents: s.method === "cash" ? parseMoneyInput(s.tendered) : null,
            }))
          : undefined,
      idempotencyKey: saleIds.key,
      draftId: saleIds.draft,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setBasket((b) => withSettleFailure(b, r));
      return;
    }
    setBasket(settleResolved);
    const splitCash = split.find((s) => s.method === "cash");
    setPaid({
      invoiceId: r.invoiceId,
      number: r.number,
      bills: r.invoices.map((inv) => {
        const at = data.companies.findIndex((c) => c.id === inv.legalEntityId);
        const co = at >= 0 ? data.companies[at] : mainCompany;
        return { id: inv.id, number: inv.number, totalCents: inv.totalCents, companyName: co.name, index: Math.max(0, at) };
      }),
      totalCents: r.totalCents,
      changeCents: r.changeCents,
      tenderedCents: method === "cash" ? tenderCents : method === "split" && splitCash ? parseMoneyInput(splitCash.tendered) : null,
      onAccount: r.onAccount,
      methodLabel: METHOD_LABEL[method],
      companyName: mainCompany.name,
      customerName: basket.customer.trim() || "Walk-in customer",
    });
  }

  async function keep(as: "quote" | "job") {
    setError(null);
    if (!basket.customerId) {
      setError(as === "job" ? "Pick the customer and their car first." : "Pick the customer first — a quote is addressed to someone.");
      setPickerOpen(true);
      return;
    }
    if (as === "job" && !vehicle) {
      setError("A job needs a car — pick one of the customer's cars.");
      setPickerOpen(true);
      return;
    }
    setKeeping(as);
    const r = await keepCartAction({
      as,
      customerId: basket.customerId,
      vehicleId: vehicle?.id,
      lines: basket.lines.map((l) => ({ productId: l.product.id, qty: l.qty, discountKind: l.discountKind, discountPct: l.discountPct, discountAmountCents: l.discountAmountCents })),
      orderDiscountKind: basket.orderDiscKind,
      orderDiscountValue: basket.orderDiscValue,
      orderDiscountReason: basket.orderDiscReason,
    });
    setKeeping(null);
    if (!r.ok) {
      setError(r.error);
      if (r.quoteId) toast.message("The cart was kept as a draft quote.", { action: { label: "Open", onClick: () => router.push(`/sales/${r.quoteId}/edit`) } });
      return;
    }
    resetSale();
    if (r.jobId) {
      toast.success("Job saved — the car is on the board.", { action: { label: "Open job", onClick: () => router.push(`/jobs/${r.jobId}`) } });
    } else {
      router.push(`/sales/${r.quoteId}/edit`);
    }
  }

  const visible = filtered.slice(0, shown);

  return (
    <div className="flex min-h-full flex-col gap-3.5 p-3.5 xl:h-full xl:flex-row xl:overflow-hidden">
      {/* Catalogue — or, once paid, the printed receipt */}
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 px-1.5 py-1.5 sm:px-2.5 xl:overflow-y-auto">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.6px] text-tc-ink">New sale</h1>
          </div>
          {!paid && (
            <div className="flex items-center gap-2">
              <label className="flex h-11 w-[min(340px,70vw)] items-center gap-2.5 rounded-full bg-white px-4 shadow-tc-card focus-within:ring-2 focus-within:ring-tc-primary">
                <Search className="size-4 shrink-0 text-tc-faint" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setShown(PAGE);
                  }}
                  onKeyDown={(e) => {
                    // A barcode scanner types the code and presses Enter.
                    if (e.key !== "Enter") return;
                    const code = q.trim();
                    const hit = data.products.find((p) => p.barcode && p.barcode === code);
                    if (hit && !frozen) {
                      add(hit);
                      setQ("");
                    }
                  }}
                  placeholder="Search size, brand or service"
                  aria-label="Search the catalogue"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-tc-ink outline-none placeholder:text-tc-faint"
                />
                <Kbd variant="flat" size="sm" className="font-mono">/</Kbd>
              </label>
              <button type="button" aria-label="Scan a barcode" title="Scan a barcode" onClick={() => searchRef.current?.focus()} className={`${TC_ROUND} size-11`}>
                <ScanBarcode className="size-[18px]" />
              </button>
            </div>
          )}
        </div>

        {paid ? (
          <TcCard className={`flex flex-1 flex-col items-center gap-4 p-6`} aria-label="Printed receipt">
            <div className="flex w-full items-center justify-between">
              <h2 className="text-[15px] font-bold text-tc-ink">Printed receipt</h2>
              <span className={TC_MICRO}>One per company</span>
            </div>
            {receipts ? (
              <div className="flex w-full flex-wrap items-start justify-center gap-4">
                {receipts.map((r, i) =>
                  r === "error" ? (
                    <p key={i} className="py-20 text-[13px] text-tc-faint">Receipt preview unavailable — Print still works.</p>
                  ) : (
                    <ReceiptCard key={i} r={r} />
                  ),
                )}
              </div>
            ) : (
              <p className="py-20 text-[13px] text-tc-faint">{paid.bills.length > 1 ? "Preparing the receipts…" : "Preparing the receipt…"}</p>
            )}
          </TcCard>
        ) : (
          <>
            {/* Tyre size */}
            {options.width.length > 0 && (
              <TcCard className={`flex flex-wrap items-center gap-2.5 px-5 py-4`} aria-label="Tyre size">
                <span className={`${TC_MICRO} mr-1`}>Tyre size</span>
                {(["width", "profile", "rim"] as const).map((k, i) => (
                  <div key={k} className="flex items-center gap-2.5">
                    {i === 1 && <span className="text-tc-fainter">/</span>}
                    <Select
                      value={size[k] == null ? "any" : String(size[k])}
                      onValueChange={(v) => {
                        setSize((s) => ({ ...s, [k]: v === "any" ? null : Number(v) }));
                        setShown(PAGE);
                      }}
                    >
                      <SelectTrigger aria-label={k} className="h-10 min-w-[104px] gap-2 rounded-[12px] border-0 bg-tc-sub px-3 text-[12.5px] text-tc-muted shadow-none">
                        <span className="capitalize">{k}</span>
                        <span className="font-mono text-[14px] font-bold text-tc-ink">
                          <SelectValue />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        {options[k].map((v) => (
                          <SelectItem key={v} value={String(v)}>
                            {k === "rim" ? `R${v}` : v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {isSizeSet(size) && (
                  <button type="button" onClick={() => setSize(ANY_SIZE)} className="text-[12.5px] font-medium text-tc-muted hover:text-tc-ink">
                    Any size
                  </button>
                )}
                {vehicle && carSize && !sizeFilterEquals(size, carSize) && (
                  <button
                    type="button"
                    onClick={() => setSize({ width: carSize.width, profile: carSize.profile, rim: carSize.rim })}
                    title={`${vehicle.plate} last had ${formatTyreSize(carSize)}`}
                    className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-tc-highlight px-3.5 text-[13px] font-semibold text-tc-on-highlight"
                  >
                    <Car className="size-4" /> From {vehicle.plate}
                  </button>
                )}
              </TcCard>
            )}

            {/* Chips */}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Category"
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  setShown(PAGE);
                }}
                className="!bg-transparent !p-0 !shadow-none flex-wrap gap-2"
                itemClassName="h-10 gap-2 bg-white px-4 shadow-tc-card data-pressed:!bg-tc-primary data-pressed:text-tc-on-primary"
                options={CHIPS.map((c) => ({
                  value: c.value,
                  label: (
                    <>
                      {c.dot && <span className="size-2 rounded-[3px]" style={{ background: c.dot }} />}
                      {c.label}
                      {c.value !== "all" && <span className="font-normal opacity-60">{counts[c.value]}</span>}
                    </>
                  ),
                }))}
              />
              <DropdownMenu>
                <DropdownMenuTrigger className={`${TC_MICRO} ml-auto rounded-full px-2 py-1 hover:text-tc-ink`}>
                  Sort · {SORT_LABEL[sort]}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-[12px]">
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                    <DropdownMenuItem key={k} onSelect={() => setSort(k)}>
                      {SORT_LABEL[k]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Grid */}
            {visible.length === 0 ? (
              <TcCard className="py-14 text-center text-[13px] text-tc-faint">Nothing matches{q ? ` “${q}”` : ""}.</TcCard>
            ) : (
              <div className="@container">
                <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
                  {visible.map((item) => (
                    <ProductTile
                      key={item.product.id}
                      item={item}
                      qty={qtyById.get(item.product.id) ?? 0}
                      pricesInclVat={data.pricesInclVat}
                      vatRegistered={companyOf(item.product).vatRegistered}
                      disabled={frozen}
                      canPrice={canPrice}
                      onAdd={() => add(item.product)}
                    />
                  ))}
                </div>
              </div>
            )}
            {filtered.length > shown && (
              <button type="button" onClick={() => setShown((s) => s + PAGE)} className="mx-auto h-10 rounded-full bg-white px-5 text-[13px] font-semibold text-tc-ink shadow-tc-card">
                Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown}
              </button>
            )}

            {/* Car history */}
            {vehicle && (
              <TcCard className={`p-5`} aria-label="Last visits">
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-bold text-tc-ink">
                    {vehicle.plate} · last visits
                  </h2>
                  {basket.customerId && (
                    <Link href={`/contacts?c=${basket.customerId}`} className="inline-flex items-center gap-1 text-[13px] text-tc-muted hover:text-tc-ink">
                      Full history <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="pt-4 text-[13px] text-tc-faint">No bills on this car yet.</p>
                ) : (
                  <ul className="mt-2">
                    {history.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-tc-line py-2.5 last:border-0">
                        <span className="w-[92px] font-mono text-[11px] uppercase text-tc-faint">{v.date}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-tc-body">{v.summary || v.number}</span>
                        <button
                          type="button"
                          disabled={frozen || v.lines.length === 0}
                          onClick={() => {
                            let next = basket;
                            let added = 0;
                            for (const l of v.lines) {
                              const p = data.products.find((x) => x.id === l.productId && x.priceCents > 0);
                              if (!p) continue;
                              added += 1;
                              const have = next.lines.find((x) => x.product.id === p.id);
                              next = have ? setQtyIn(next, p.id, have.qty + l.qty) : setQtyIn(addProduct(next, p), p.id, l.qty);
                            }
                            if (added === 0) toast.message("Nothing on that bill is still in the catalogue.");
                            else setBasket(next);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-tc-line-2 px-3 text-[12.5px] font-semibold text-tc-ink hover:bg-tc-sub disabled:opacity-40"
                        >
                          <RotateCcw className="size-3.5" /> Add again
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </TcCard>
            )}
          </>
        )}
      </div>

      {/* Cart */}
      <div className="w-full shrink-0 xl:w-[420px]">
        {paid ? (
          <PaidPanel sale={paid} onNewSale={resetSale} />
        ) : (
          <CartPanel
            customerName={basket.customer}
            customerKnown={!!basket.customerId}
            vehicle={vehicle}
            onEditCustomer={() => setPickerOpen(true)}
            bills={bills}
            grandCents={grandCents}
            lines={basket.lines}
            pricesInclVat={data.pricesInclVat}
            posRules={data.posRules}
            blockReason={blockReason}
            onBillDiscount={onBillDiscount}
            onBillDiscountReason={onBillDiscountReason}
            onAskOwner={(id) => void askOwner(id)}
            allocation={allocation}
            onAllocation={setAllocation}
            onQty={setQty}
            onPatchLine={patchLine}
            method={method}
            onMethod={setMethod}
            tender={tender}
            onTender={setTender}
            payRef={payRef}
            onPayRef={setPayRef}
            split={split}
            onSplit={setSplit}
            busy={busy}
            keeping={keeping}
            error={error}
            pending={basket.pending}
            notice={basket.notice}
            onCharge={() => void charge()}
            onAbandon={resetSale}
            onSaveJob={() => void keep("job")}
            onQuote={() => void keep("quote")}
            onClear={() => {
              // Emptying ends the ticket: the reducers drop the discount and bump the generation.
              let next = basket;
              for (const l of basket.lines) next = setQtyIn(next, l.product.id, 0);
              if (next.generation !== basket.generation) {
                rotateSaleIds();
                setCoDisc({});
              }
              setBasket(next);
              setError(null);
            }}
          />
        )}
      </div>

      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        customers={data.customers}
        onPick={(pick) => {
          if (pick.customer) {
            setBasket((b) => pickCustomer(b, pick.customer!.id, pick.customer!.name));
            setVehicle(pick.vehicle);
          } else {
            setBasket((b) => setCustomerName(b, pick.walkInName ?? ""));
            setVehicle(null);
          }
          setError(null);
        }}
      />

      {overrideFor && overrideBill && (
        <OwnerOverrideDialog
          documentId={overrideFor.billId}
          docType="invoice"
          requestedCents={overrideBill.allowance.actualCents}
          onClose={() => setOverrideFor(null)}
          onApproved={(cents) => {
            if (several) patchCo(overrideFor.companyId, { approvedMaxCents: cents });
            else setBasket((b) => setApprovedMax(b, cents));
            setOverrideFor(null);
          }}
        />
      )}

      {pricing && (
        <PriceProductDialog
          product={pricing}
          onClose={() => setPricing(null)}
          onPriced={(priceCents) => {
            setBasket((b) => addProduct(b, { ...pricing, priceCents }));
            setPricing(null);
            router.refresh();
          }}
        />
      )}

      <Dialog open={!!confirmNeg} onOpenChange={(o) => !o && setConfirmNeg(null)}>
        <DialogContent className="rounded-[22px] sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-[16px]">
              <span className="grid size-9 place-items-center rounded-full bg-tc-amber-soft text-tc-warning">
                <AlertTriangle className="size-[18px]" />
              </span>
              Shop stock will go below zero
            </DialogTitle>
            <DialogDescription>Selling these takes the shop count below zero:</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {(confirmNeg ?? []).map((n) => (
              <li key={n.name} className="rounded-[12px] bg-tc-sub px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-semibold text-tc-body">{n.name}</span>
                  <span className="shrink-0 font-mono font-bold text-tc-warning">
                    shop {fmtQty(n.shop)} → {fmtQty(n.shop - n.selling)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-tc-faint">{n.warehouse > 0 ? `${fmtQty(n.warehouse)} in the warehouse — transfer or continue` : "None in the warehouse either"}</div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirmNeg(null)} className="h-11 flex-1 rounded-full bg-tc-sub text-[14px] font-semibold text-tc-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmNeg(null);
                void charge(true);
              }}
              className="h-11 flex-1 rounded-full bg-tc-primary text-[14px] font-semibold text-tc-on-primary"
            >
              Continue anyway
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
