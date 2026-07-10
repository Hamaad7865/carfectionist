import type { SectionFlags } from "@/lib/pdf/fiscal-lock";
import type { DiscountKind } from "@/lib/money/totals";

export interface BuilderLine {
  key: string;
  productId: string | null; // null = ad-hoc typed line
  title: string;
  description: string;
  qty: number;
  unitCents: number;
  discountPct: number;
  discountKind: DiscountKind;      // 'percent' uses discountPct; 'amount' uses discountAmountCents
  discountAmountCents: number;     // VAT-inclusive Rs off, in cents
  vatRatePct: number;
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
  sectionConfig: Partial<SectionFlags>;
  customFields: { label: string; value: string }[];
  dirty: boolean;
  save: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
}

export function newKey(): string {
  return crypto.randomUUID();
}

export function blankLine(): BuilderLine {
  return { key: newKey(), productId: null, title: "", description: "", qty: 1, unitCents: 0, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: 15 };
}

export type BuilderAction =
  | { type: "setDocType"; docType: "quote" | "invoice" }
  | { type: "setCustomer"; customerId: string | null }
  | { type: "addLine"; line: BuilderLine }
  | { type: "patchLine"; key: string; patch: Partial<BuilderLine> }
  | { type: "removeLine"; key: string }
  | { type: "setDocDiscount"; kind: DiscountKind | null; value: number }
  | { type: "setSection"; key: keyof SectionFlags; value: boolean }
  | { type: "addCustomField"; field?: { label: string; value: string } }
  | { type: "patchCustomField"; index: number; patch: Partial<{ label: string; value: string }> }
  | { type: "removeCustomField"; index: number }
  | { type: "saveStart" }
  | { type: "saveOk"; docId: string; revision: number; number?: string | null; status?: string }
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
    case "setDocDiscount":
      return touched({ ...state, docDiscountKind: action.kind, docDiscountValue: action.value });
    case "setSection":
      return touched({ ...state, sectionConfig: { ...state.sectionConfig, [action.key]: action.value } });
    case "addCustomField":
      return touched({ ...state, customFields: [...state.customFields, action.field ?? { label: "", value: "" }] });
    case "patchCustomField":
      return touched({ ...state, customFields: state.customFields.map((f, i) => (i === action.index ? { ...f, ...action.patch } : f)) });
    case "removeCustomField":
      return touched({ ...state, customFields: state.customFields.filter((_, i) => i !== action.index) });
    case "saveStart":
      return { ...state, save: "saving", saveError: null };
    case "saveOk":
      return {
        ...state,
        docId: action.docId,
        revision: action.revision,
        number: action.number ?? state.number,
        status: action.status ?? state.status,
        dirty: false,
        save: "saved",
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
