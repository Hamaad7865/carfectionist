import type { SectionFlags } from "@/lib/pdf/fiscal-lock";
import type { DiscountKind } from "@/lib/money/totals";
import { policyOf, type DiscountPolicy } from "@/lib/money/allowance";
import type { RichDoc } from "@/lib/rich/types";

export interface BuilderLine {
  key: string;
  productId: string | null; // null = ad-hoc typed line
  title: string;
  /** Flat text from a row saved before rich content existed. Read-only now. */
  description: string;
  /** The description proper. Its flat mirror is derived at the save seam. */
  rich: RichDoc | null;
  unitLabel: string; // "" = no unit shown
  qty: number;
  unitCents: number;
  discountPct: number;
  discountKind: DiscountKind;      // 'percent' uses discountPct; 'amount' uses discountAmountCents
  discountAmountCents: number;     // VAT-inclusive Rs off, in cents
  /** How much of this line may be discounted — 'none' | 'carwash' | 'free'. A catalogue
   *  line reads its product's policy; an ad-hoc line has no product, so its own lineKind
   *  decides (policyOf(null, lineKind)). UI-only: the database re-derives this itself from
   *  the product join (app.document_discount_limits), so it never rides the save payload. */
  discountPolicy: DiscountPolicy;
  vatRatePct: number;
  // What the line IS — stated only on an ad-hoc line, because nothing else can say.
  // A catalogue line leaves it null: products.kind is the better answer, and copying it
  // here would only let the two drift. Decides whether an accepted quote raises a job.
  lineKind: "service" | "product" | null;
  /** document_lines.price_includes_vat (20260812000020): unitCents IS the VAT-inclusive
   *  figure exactly as typed, and the ledger extracts the VAT — a typed 1000 stays
   *  1000.00. Set when a price is typed under gross pricing; loaded lines carry what
   *  the row stored. */
  priceInclusive: boolean;
}

export interface BuilderState {
  docId: string | null;
  docType: "quote" | "invoice";
  status: string;
  number: string | null;
  issueDate: string | null; // the stored issue date once issued (for the preview)
  customerId: string | null;
  revision: number;
  lines: BuilderLine[];
  docDiscountKind: DiscountKind | null;  // null = no order discount
  docDiscountValue: number;              // percent: % ; amount: Cents (VAT-inclusive)
  /** Why a discount reaching into a service/carwash allowance was given — one box per
   *  document, read back by app.assert_discount_allowed. "" = none typed yet. */
  docDiscountReason: string;
  sectionConfig: Partial<SectionFlags>;
  customFields: { label: string; value: string }[];
  comment: string; // internal note — shown in Sales list + invoice screen, never on a receipt/PDF
  dirty: boolean;
  save: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
}

export function newKey(): string {
  return crypto.randomUUID();
}

/**
 * A line, as the save payload wants it.
 *
 * One place, because the builder used to hand-list these fields inline and simply
 * forgot `rich` and `unitLabel` — so everything typed into the description editor was
 * dropped on the way to the server while every unit test still passed, because the
 * tests called the conversion directly with a tree the builder never supplied.
 * state.test.ts now asserts that every field of a BuilderLine except `key` arrives.
 * `discountPolicy` is the other exception: it is UI-only, re-derived by the database
 * itself from the product join (app.document_discount_limits), so it is never document
 * content and never rides this payload.
 */
export function toSaveDraftLines(lines: BuilderLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    title: l.title,
    description: l.description || null,
    rich: l.rich,
    unitLabel: l.unitLabel,
    qty: l.qty,
    unitCents: l.unitCents,
    discountPct: l.discountPct,
    discountKind: l.discountKind,
    discountAmountCents: l.discountAmountCents,
    vatRatePct: l.vatRatePct,
    lineKind: l.lineKind,
    priceInclusive: l.priceInclusive,
  }));
}

export function blankLine(): BuilderLine {
  // A hand-typed line starts as work: that is what the shop types by hand, and the row's
  // own Service/Product control is right there to say otherwise.
  return { key: newKey(), productId: null, title: "", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 0, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: policyOf(null, "service"), vatRatePct: 15, lineKind: "service", priceInclusive: false };
}

export type BuilderAction =
  | { type: "setDocType"; docType: "quote" | "invoice" }
  | { type: "setCustomer"; customerId: string | null }
  | { type: "addLine"; line: BuilderLine }
  | { type: "patchLine"; key: string; patch: Partial<BuilderLine> }
  | { type: "removeLine"; key: string }
  | { type: "moveLine"; key: string; by: -1 | 1 }
  | { type: "duplicateLine"; key: string }
  | { type: "setDocDiscount"; kind: DiscountKind | null; value: number }
  | { type: "setDiscountReason"; reason: string }
  | { type: "setSection"; key: keyof SectionFlags; value: boolean }
  | { type: "addCustomField"; field?: { label: string; value: string } }
  | { type: "patchCustomField"; index: number; patch: Partial<{ label: string; value: string }> }
  | { type: "removeCustomField"; index: number }
  | { type: "setComment"; comment: string }
  | { type: "saveStart" }
  | { type: "saveOk"; docId: string; revision: number; number?: string | null; status?: string; stillDirty?: boolean }
  | { type: "saveError"; error: string }
  | { type: "issued"; number: string; status: string };

const touched = (s: BuilderState): BuilderState => ({ ...s, dirty: true, save: "idle" });

export function reducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case "setDocType":
      return touched({ ...state, docType: action.docType });
    case "setCustomer":
      return touched({ ...state, customerId: action.customerId });
    case "addLine":
      return touched({ ...state, lines: [...state.lines, action.line] });
    case "patchLine":
      return touched({
        ...state,
        lines: state.lines.map((l) => (l.key === action.key ? { ...l, ...action.patch } : l)),
      });
    case "removeLine":
      return touched({ ...state, lines: state.lines.filter((l) => l.key !== action.key) });
    case "moveLine": {
      // sort_order is written from the array index and save_draft replaces every
      // line, so reordering this array IS the persistence. No server work at all.
      const i = state.lines.findIndex((l) => l.key === action.key);
      const j = i + action.by;
      if (i < 0 || j < 0 || j >= state.lines.length) return state;
      const lines = [...state.lines];
      [lines[i], lines[j]] = [lines[j], lines[i]];
      return touched({ ...state, lines });
    }
    case "duplicateLine": {
      const i = state.lines.findIndex((l) => l.key === action.key);
      if (i < 0) return state;
      // A fresh key, everything else carried — the whole point of duplicating the
      // Diamondbrite line is not to retype its bullets.
      const copy = { ...state.lines[i], key: newKey() };
      const lines = [...state.lines];
      lines.splice(i + 1, 0, copy);
      return touched({ ...state, lines });
    }
    case "setDocDiscount":
      return touched({ ...state, docDiscountKind: action.kind, docDiscountValue: action.value });
    case "setDiscountReason":
      return touched({ ...state, docDiscountReason: action.reason });
    case "setSection":
      return touched({ ...state, sectionConfig: { ...state.sectionConfig, [action.key]: action.value } });
    case "addCustomField":
      return touched({ ...state, customFields: [...state.customFields, action.field ?? { label: "", value: "" }] });
    case "patchCustomField":
      return touched({ ...state, customFields: state.customFields.map((f, i) => (i === action.index ? { ...f, ...action.patch } : f)) });
    case "removeCustomField":
      return touched({ ...state, customFields: state.customFields.filter((_, i) => i !== action.index) });
    case "setComment":
      return touched({ ...state, comment: action.comment });
    case "saveStart":
      return { ...state, save: "saving", saveError: null };
    case "saveOk":
      return {
        ...state,
        docId: action.docId,
        revision: action.revision,
        number: action.number ?? state.number,
        status: action.status ?? state.status,
        // Keep dirty when the document changed mid-save (edits made after the
        // saved snapshot) — otherwise those edits are silently lost while the UI
        // reads "Saved". The pending autosave timer (armed by that edit) then fires.
        dirty: action.stillDirty ?? false,
        save: action.stillDirty ? "idle" : "saved",
        saveError: null,
      };
    case "saveError":
      return { ...state, save: "error", saveError: action.error };
    case "issued":
      return { ...state, number: action.number, status: action.status, dirty: false, save: "saved" };
    default:
      return state;
  }
}
