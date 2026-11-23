"use client";

import { grossCents } from "@/lib/money";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveProductAction } from "./actions";
import { ProductPhotoField } from "./ProductPhotoField";
import type { InventoryRow } from "@/lib/supabase/queries/inventory";
import { btn } from "@/components/ui/button";
import { formatTyreSize, formatTyreSpec, parseSizeQuery, parseTyreSpec, showsTyreFields } from "@/lib/products/tyre-size";
import { isTyreShop } from "@/lib/auth/roles";

const KINDS = ["service", "product", "consumable"] as const;
const UNITS = ["piece", "ml", "l", "g", "kg", "m2", "service"] as const;
type ProductDiscountPolicy = "inherit" | "carwash" | "none" | "free";

type PForm = {
  name: string; sku: string; description: string;
  kind: (typeof KINDS)[number]; category: string; unit: (typeof UNITS)[number];
  discountPolicy: ProductDiscountPolicy;
  sellingPrice: string; costPrice: string; vatRate: string; barcode: string;
  isStocked: boolean; threshold: string; isActive: boolean; photoPath: string;
  legalEntityId: string;
  brand: string; tyreSize: string; tyreLoadIndex: string; tyreSpeedRating: string;
};

/** A company the shop bills under — offered as "Sold by" only when there are several. */
export interface SoldByOption { id: string; name: string; isDefault: boolean; vatRegistered: boolean }
// Via grossCents in CENTS — the old rupee-float formula gave a third, different shelf price for
// the same product (the catalogue and the invoice each had their own), off on 20 of 305 products.
const grossPrice = (p: InventoryRow, vatDefault: number) =>
  (grossCents(Math.round(p.sellingPrice * 100), p.vatRatePct ?? vatDefault) / 100).toFixed(2);
const seed = (p: InventoryRow | undefined, inclVat: boolean, vatDefault: number, tyreShop: boolean, defaultKind?: PForm["kind"], defaultCompany = ""): PForm => ({
  name: p?.name ?? "",
  sku: p?.sku ?? "",
  description: p?.description ?? "",
  kind: (p?.kind as PForm["kind"]) ?? defaultKind ?? "consumable",
  category: p?.category ?? "",
  unit: (p?.unit as PForm["unit"]) ?? "piece",
  // A new product hasn't earned an exception yet — the owner ticks one on later.
  discountPolicy: tyreShop && p?.discountPolicy === "carwash"
    ? "none"
    : (p?.discountPolicy as PForm["discountPolicy"]) ?? "inherit",
  // A flagged product's selling_price IS the gross — show it as stored. A net product
  // shown on a gross form is grossed up; otherwise it is the net.
  sellingPrice: p ? (p.priceIncludesVat ? String(p.sellingPrice) : inclVat ? grossPrice(p, vatDefault) : String(p.sellingPrice)) : "",
  costPrice: p ? String(p.costPrice) : "",
  vatRate: p?.vatRatePct != null ? String(p.vatRatePct) : "",
  barcode: p?.barcode ?? "",
  isStocked: p?.isStocked ?? false,
  threshold: p?.threshold != null ? String(p.threshold) : "",
  isActive: p?.isActive ?? true,
  photoPath: p?.photoPath ?? "",
  legalEntityId: p?.legalEntityId ?? defaultCompany,
  brand: p?.brand ?? "",
  tyreSize: p?.tyreSize ? formatTyreSize(p.tyreSize) : "",
  tyreLoadIndex: p?.tyreLoadIndex ?? "",
  tyreSpeedRating: p?.tyreSpeedRating ?? "",
});

export function ProductFormModal({ open, onClose, product, vatDefault, pricesInclVat = false, categories = [], brands = [], defaultKind, tenantId, companies = [] }: { open: boolean; onClose: () => void; product: InventoryRow | null; vatDefault: number; pricesInclVat?: boolean; categories?: string[]; brands?: string[]; defaultKind?: (typeof KINDS)[number]; tenantId: string; companies?: SoldByOption[] }) {
  // "Sold by" exists only for a shop that bills under more than one company.
  const multiCompany = companies.length > 1;
  const tyreShop = isTyreShop(tenantId);
  const mainCompany = companies.find((c) => c.isDefault)?.id ?? companies[0]?.id ?? "";
  const router = useRouter();
  const editing = !!product;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceInclVat, setPriceInclVat] = useState((product?.priceIncludesVat ?? false) || pricesInclVat);
  const [f, setF] = useState<PForm>(() => seed(product ?? undefined, (product?.priceIncludesVat ?? false) || pricesInclVat, vatDefault, tyreShop, defaultKind, mainCompany));

  // Re-seed whenever the modal opens for a (different) product.
  const [seededFor, setSeededFor] = useState<string | null | undefined>(undefined);
  if (open && seededFor !== (product?.id ?? null)) {
    setF(seed(product ?? undefined, (product?.priceIncludesVat ?? false) || pricesInclVat, vatDefault, tyreShop, defaultKind, mainCompany));
    setSeededFor(product?.id ?? null);
    setPriceInclVat((product?.priceIncludesVat ?? false) || pricesInclVat);
    setError(null);
  }
  if (!open && seededFor !== undefined) setSeededFor(undefined);

  const set = <K extends keyof PForm>(k: K, v: PForm[K]) => setF((s) => ({ ...s, [k]: v }));
  // A company that is not VAT-registered sells at 0% — the product carries 0 so the shelf price,
  // the till and the sheet all agree (the database enforces the same on save).
  const noVatCompany = multiCompany && companies.find((c) => c.id === f.legalEntityId)?.vatRegistered === false;
  const pickCompany = (id: string) => setF((s) => {
    const toNoVat = companies.find((c) => c.id === id)?.vatRegistered === false;
    const fromNoVat = companies.find((c) => c.id === s.legalEntityId)?.vatRegistered === false;
    return { ...s, legalEntityId: id, vatRate: toNoVat ? "0" : fromNoVat ? "" : s.vatRate };
  });
  const isService = f.kind === "service";
  // Call the thing what it is — a service is not a "product" to the person
  // typing it in, even though they share one table.
  const noun = isService ? "service" : "product";

  // Tyre size: shown for goods under a tyre-like category, and always once a size is set.
  const tyreFields = showsTyreFields({ kind: f.kind, category: f.category, hasSize: f.tyreSize.trim() !== "" || !!product?.tyreSize });
  const sizeRead = f.tyreSize.trim() ? parseSizeQuery(f.tyreSize) : null;
  const sizeFull = sizeRead && sizeRead.width != null && sizeRead.profile != null && sizeRead.rim != null ? sizeRead : null;
  const fromName = tyreFields && !f.tyreSize.trim() ? parseTyreSpec(f.name) : null;
  const useFromName = () => {
    if (!fromName) return;
    setF((s) => ({
      ...s,
      tyreSize: formatTyreSize(fromName.size),
      tyreLoadIndex: s.tyreLoadIndex || (fromName.loadIndex ?? ""),
      tyreSpeedRating: s.tyreSpeedRating || (fromName.speedRating ?? ""),
    }));
  };

  // Effective VAT rate (product override else business default) and the net
  // price we'll store when the entered sell price is VAT-inclusive. Prices may
  // carry thousands separators, so strip them before parsing.
  const money = (v: string) => parseFloat(v.replace(/[,\s]/g, ""));
  const effVat = f.vatRate.trim() !== "" ? money(f.vatRate) : vatDefault;
  const vatValid = Number.isFinite(effVat) && effVat >= 0;
  const enteredSell = money(f.sellingPrice);
  // The VAT BACKED OUT of a typed gross — what the receipt shows and the ledger stores.
  // The price is kept exactly as typed (price_includes_vat), so a typed 9,900 stays 9,900.
  const vatExtracted = priceInclVat && vatValid && enteredSell > 0 ? enteredSell * effVat / (100 + effVat) : null;

  function toggleInclVat(on: boolean) {
    setPriceInclVat(on);
    // Blank the field so a prefilled NET price can't be re-read as gross.
    if (on) set("sellingPrice", "");
  }

  async function submit() {
    setError(null);
    if (priceInclVat && !vatValid) return setError("Enter a valid VAT rate to store a VAT-inclusive price.");
    setBusy(true);
    const r = await saveProductAction({
      id: product?.id,
      name: f.name,
      sku: f.sku,
      description: f.description,
      kind: f.kind,
      category: f.category,
      unit: f.unit,
      discountPolicy: f.discountPolicy,
      // Store the price EXACTLY as typed. When it is a VAT-inclusive figure the flag
      // rides with it and the ledger extracts the VAT, so 9,900 stays 9,900 (no more
      // divide-to-net then re-gross-a-cent-high). Otherwise it is the net, as before.
      sellingPrice: f.sellingPrice,
      priceIncludesVat: priceInclVat,
      costPrice: f.costPrice,
      vatRate: f.vatRate,
      barcode: f.barcode,
      isStocked: isService ? false : f.isStocked,
      threshold: f.threshold,
      isActive: f.isActive,
      photoPath: f.photoPath,
      brand: f.brand,
      // Hidden fields send nothing, so a product moved out of "Tyres" keeps no stray size.
      tyreSize: tyreFields ? f.tyreSize : "",
      tyreLoadIndex: tyreFields ? f.tyreLoadIndex : "",
      tyreSpeedRating: tyreFields ? f.tyreSpeedRating : "",
      ...(multiCompany && f.legalEntityId ? { legalEntityId: f.legalEntityId } : {}),
    });
    setBusy(false);
    if (r.ok) {
      onClose();
      router.refresh();
    } else setError(r.error);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Edit ${noun}` : `New ${noun}`}
      subtitle={editing ? product!.name : "Add a service, product or consumable"}
      footer={
        <div className="flex items-center gap-2">
          {editing && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-body">
              <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[#2b8cff]" />
              Active
            </label>
          )}
          <button onClick={onClose} className={btn("quiet", "lg")}>Cancel</button>
          <button onClick={submit} disabled={busy} className={btn("primary", "lg", "px-5")}>
            {busy ? "Saving…" : editing ? "Save changes" : `Create ${noun}`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={multiCompany ? "e.g. Michelin Primacy 4 205/55 R16" : "e.g. Ceramic Coating 9H"} autoFocus /></Field>
        <Field label="Photo">
          <ProductPhotoField
            tenantId={tenantId}
            path={f.photoPath}
            previewUrl={product?.photoUrl ?? null}
            onChange={(path) => set("photoPath", path)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" hint="Groups it in the catalogue">
            <input className={inputCls} value={f.category} onChange={(e) => set("category", e.target.value)} placeholder={multiCompany ? "e.g. Tyres" : "e.g. Car Accessories"} list="product-categories" />
            <datalist id="product-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Brand" hint="Who makes it">
            <input className={inputCls} value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder={multiCompany ? "e.g. Michelin" : "e.g. Meguiar's"} list="product-brands" />
            <datalist id="product-brands">
              {brands.map((b) => <option key={b} value={b} />)}
            </datalist>
          </Field>
        </div>
        {tyreFields && (
          <div className="rounded-[12px] border border-line bg-sub p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_110px_110px] [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1">
              <Field label="Tyre size" hint={sizeFull ? `Reads as ${formatTyreSpec({ width: sizeFull.width!, profile: sizeFull.profile!, rim: sizeFull.rim! }, f.tyreLoadIndex.trim() || null, f.tyreSpeedRating.trim().toUpperCase() || null)}` : f.tyreSize.trim() ? "Write it like 205/55 R16" : "Width / profile R rim"}>
                <input className={inputCls} value={f.tyreSize} onChange={(e) => set("tyreSize", e.target.value)} placeholder="205/55 R16" />
              </Field>
              <Field label="Load index"><input className={inputCls} value={f.tyreLoadIndex} onChange={(e) => set("tyreLoadIndex", e.target.value)} placeholder="91" inputMode="numeric" /></Field>
              <Field label="Speed rating"><input className={inputCls} value={f.tyreSpeedRating} onChange={(e) => set("tyreSpeedRating", e.target.value.toUpperCase())} placeholder="V" maxLength={1} /></Field>
            </div>
            {fromName && (
              <button type="button" onClick={useFromName} className="mt-2 text-[12px] font-semibold text-brand hover:underline">
                Use {formatTyreSpec(fromName.size, fromName.loadIndex, fromName.speedRating)} from the name
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={f.kind} onChange={(e) => set("kind", e.target.value as PForm["kind"])}>
              {KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Unit">
            <select className={inputCls} value={f.unit} onChange={(e) => set("unit", e.target.value as PForm["unit"])}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        {multiCompany && (
          <Field
            label="Sold by"
            hint={companies.find((c) => c.id === f.legalEntityId)?.vatRegistered === false
              ? "Not VAT-registered — sold at 0% VAT, on that company's own invoice"
              : "The company whose invoice carries it"}
          >
            <select className={inputCls} value={f.legalEntityId} onChange={(e) => pickCompany(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.vatRegistered ? "" : " (no VAT)"}</option>)}
            </select>
          </Field>
        )}
        <Field label="Discount">
          <select className={inputCls} value={f.discountPolicy} onChange={(e) => set("discountPolicy", e.target.value as PForm["discountPolicy"])}>
            <option value="inherit">Follow the kind — a service gives nothing away</option>
            {!tyreShop && <option value="carwash">Carwash — up to 5%, with a reason</option>}
            <option value="none">Never discounted</option>
            <option value="free">No limit</option>
          </select>
        </Field>
        {/* Phones: the sell price on its own row, cost and VAT side by side under it. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1">
          <Field label={priceInclVat ? "Sell price (incl. VAT)" : "Sell price (excl. VAT)"} hint="Rupees"><input className={inputCls} value={f.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
          <Field label="Cost price" hint="Rupees"><input className={inputCls} value={f.costPrice} onChange={(e) => set("costPrice", e.target.value)} inputMode="decimal" placeholder="0.0000" /></Field>
          <Field label="VAT rate %" hint={noVatCompany ? "No VAT — company not registered" : "Blank = default"}><input className={inputCls} value={noVatCompany ? "0" : f.vatRate} disabled={noVatCompany} onChange={(e) => set("vatRate", e.target.value)} inputMode="decimal" placeholder={String(vatDefault)} /></Field>
        </div>
        {/* A company without VAT has nothing to include: its price is the price. */}
        <label className={`flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-body ${noVatCompany ? "hidden" : ""}`}>
          <input type="checkbox" checked={priceInclVat} onChange={(e) => toggleInclVat(e.target.checked)} className="size-4 accent-[#2b8cff]" />
          The sell price I entered includes {vatValid ? `${effVat}%` : ""} VAT
          {vatExtracted != null && (
            <span className="text-[12px] font-normal text-muted">→ kept as <span className="num font-semibold text-body">Rs {enteredSell.toFixed(2)}</span> (of which VAT Rs {vatExtracted.toFixed(2)})</span>
          )}
          {priceInclVat && !vatValid && <span className="text-[12px] font-normal text-rose">enter a valid VAT rate first</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU"><input className={inputCls} value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Optional" /></Field>
          <Field label="Barcode"><input className={inputCls} value={f.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="Scan or type" /></Field>
        </div>
        <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional detail shown on documents" /></Field>

        {!isService ? (
          <div className="rounded-[12px] border border-line bg-sub p-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-body">
              <input type="checkbox" checked={f.isStocked} onChange={(e) => set("isStocked", e.target.checked)} className="size-4 accent-[#2b8cff]" />
              Track stock for this item
            </label>
            {f.isStocked && (
              <div className="mt-3 max-w-[220px]">
                <Field label="Low-stock threshold" hint="Blank = 10 · capped at 20">
                  <input
                    className={inputCls}
                    value={f.threshold}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = Number(v);
                      // hard cap: anything typed above 20 snaps to 20
                      set("threshold", v !== "" && Number.isFinite(n) && n > 20 ? "20" : v);
                    }}
                    inputMode="decimal"
                    placeholder="e.g. 10"
                  />
                </Field>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-[10px] bg-sub px-3 py-2 text-[12px] text-muted">Services aren’t stocked — no inventory is tracked.</p>
        )}
      </div>
    </Modal>
  );
}
