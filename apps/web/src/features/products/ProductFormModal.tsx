"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveProductAction } from "./actions";
import type { InventoryRow } from "@/lib/supabase/queries/inventory";

const KINDS = ["service", "product", "consumable"] as const;
const UNITS = ["piece", "ml", "l", "g", "kg", "m2", "service"] as const;

type PForm = {
  name: string; sku: string; description: string;
  kind: (typeof KINDS)[number]; category: string; unit: (typeof UNITS)[number];
  sellingPrice: string; costPrice: string; vatRate: string; barcode: string;
  isStocked: boolean; threshold: string; isActive: boolean;
};
const grossPrice = (p: InventoryRow, vatDefault: number) => (p.sellingPrice * (1 + (p.vatRatePct ?? vatDefault) / 100)).toFixed(2);
const seed = (p: InventoryRow | undefined, inclVat: boolean, vatDefault: number): PForm => ({
  name: p?.name ?? "",
  sku: p?.sku ?? "",
  description: p?.description ?? "",
  kind: (p?.kind as PForm["kind"]) ?? "consumable",
  category: p?.category ?? "",
  unit: (p?.unit as PForm["unit"]) ?? "piece",
  sellingPrice: p ? (inclVat ? grossPrice(p, vatDefault) : String(p.sellingPrice)) : "",
  costPrice: p ? String(p.costPrice) : "",
  vatRate: p?.vatRatePct != null ? String(p.vatRatePct) : "",
  barcode: p?.barcode ?? "",
  isStocked: p?.isStocked ?? false,
  threshold: p?.threshold != null ? String(p.threshold) : "",
  isActive: p?.isActive ?? true,
});

export function ProductFormModal({ open, onClose, product, vatDefault, pricesInclVat = false, categories = [] }: { open: boolean; onClose: () => void; product: InventoryRow | null; vatDefault: number; pricesInclVat?: boolean; categories?: string[] }) {
  const router = useRouter();
  const editing = !!product;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceInclVat, setPriceInclVat] = useState(pricesInclVat);
  const [f, setF] = useState<PForm>(() => seed(product ?? undefined, pricesInclVat, vatDefault));

  // Re-seed whenever the modal opens for a (different) product.
  const [seededFor, setSeededFor] = useState<string | null | undefined>(undefined);
  if (open && seededFor !== (product?.id ?? null)) {
    setF(seed(product ?? undefined, pricesInclVat, vatDefault));
    setSeededFor(product?.id ?? null);
    setPriceInclVat(pricesInclVat);
    setError(null);
  }
  if (!open && seededFor !== undefined) setSeededFor(undefined);

  const set = <K extends keyof PForm>(k: K, v: PForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const isService = f.kind === "service";

  // Effective VAT rate (product override else business default) and the net
  // price we'll store when the entered sell price is VAT-inclusive. Prices may
  // carry thousands separators, so strip them before parsing.
  const money = (v: string) => parseFloat(v.replace(/[,\s]/g, ""));
  const effVat = f.vatRate.trim() !== "" ? money(f.vatRate) : vatDefault;
  const vatValid = Number.isFinite(effVat) && effVat >= 0;
  const enteredSell = money(f.sellingPrice);
  const netFromGross = priceInclVat && vatValid && enteredSell > 0 ? enteredSell / (1 + effVat / 100) : null;

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
      // selling_price is stored VAT-exclusive; convert if the user entered a gross price.
      sellingPrice: netFromGross != null ? netFromGross.toFixed(2) : f.sellingPrice,
      costPrice: f.costPrice,
      vatRate: f.vatRate,
      barcode: f.barcode,
      isStocked: isService ? false : f.isStocked,
      threshold: f.threshold,
      isActive: f.isActive,
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
      title={editing ? "Edit product" : "New product"}
      subtitle={editing ? product!.name : "Add a service, product or consumable"}
      footer={
        <div className="flex items-center gap-2">
          {editing && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-body">
              <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[#2b8cff]" />
              Active
            </label>
          )}
          <button onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
          <button onClick={submit} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
            {busy ? "Saving…" : editing ? "Save changes" : "Create product"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Ceramic Coating 9H" autoFocus /></Field>
        <Field label="Category" hint="Groups it in the catalogue">
          <input className={inputCls} value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Car Accessories" list="product-categories" />
          <datalist id="product-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
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
        <div className="grid grid-cols-3 gap-3">
          <Field label={priceInclVat ? "Sell price (incl. VAT)" : "Sell price (excl. VAT)"} hint="Rupees"><input className={inputCls} value={f.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
          <Field label="Cost price" hint="Rupees"><input className={inputCls} value={f.costPrice} onChange={(e) => set("costPrice", e.target.value)} inputMode="decimal" placeholder="0.0000" /></Field>
          <Field label="VAT rate %" hint="Blank = default"><input className={inputCls} value={f.vatRate} onChange={(e) => set("vatRate", e.target.value)} inputMode="decimal" placeholder={String(vatDefault)} /></Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-body">
          <input type="checkbox" checked={priceInclVat} onChange={(e) => toggleInclVat(e.target.checked)} className="size-4 accent-[#2b8cff]" />
          The sell price I entered includes {vatValid ? `${effVat}%` : ""} VAT
          {netFromGross != null && (
            <span className="text-[12px] font-normal text-muted">→ stored net <span className="num font-semibold text-body">Rs {netFromGross.toFixed(2)}</span> (VAT Rs {(enteredSell - netFromGross).toFixed(2)})</span>
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
