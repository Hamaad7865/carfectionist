"use client";

import { formatMUR, parseMoneyInput } from "@/lib/money";
import { Field, inputCls } from "@/components/ui/form";
import type { ExpenseRow } from "@/lib/supabase/queries/purchases";

// One definition of an expense's editable shape, shared by the inline "New
// expense" panel and the row-level edit dialog. Before this the create form
// hard-coded its category list and money parsing; editing the same row from a
// second copy of those rules is exactly how the two drift apart.

export type ExpenseStatus = "paid" | "due";

export const EXPENSE_CATEGORIES = [
  "Supplies",
  "Rent",
  "Utilities",
  "Salaries",
  "Marketing",
  "Equipment",
  "Insurance",
  "Other",
] as const;

export interface ExpenseFormState {
  category: string;
  description: string;
  /** Rupees as typed, e.g. "17822.87" — converted to cents only on submit. */
  amount: string;
  /** Rupees as typed; blank means no VAT. */
  vat: string;
  status: ExpenseStatus;
  date: string;
}

export function emptyExpenseForm(today: string): ExpenseFormState {
  return { category: EXPENSE_CATEGORIES[0], description: "", amount: "", vat: "", status: "paid", date: today };
}

/** Stored row (integer cents) → editable strings, without losing precision. */
export function expenseFormFrom(row: ExpenseRow): ExpenseFormState {
  return {
    category: row.category,
    description: row.description ?? "",
    amount: (row.amountCents / 100).toFixed(2),
    vat: row.vatCents > 0 ? (row.vatCents / 100).toFixed(2) : "",
    status: row.status === "due" ? "due" : "paid",
    date: row.date,
  };
}

/** Picker options, keeping a custom/legacy stored category selectable. */
export function expenseCategories(current: string): string[] {
  const list: string[] = [...EXPENSE_CATEGORIES];
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** Live "total incl. VAT" — same amount + VAT sum the list footer uses. */
export function expenseFormTotalCents(form: ExpenseFormState): number {
  return (parseMoneyInput(form.amount) ?? 0) + (parseMoneyInput(form.vat) ?? 0);
}

export function ExpenseFields({
  form,
  set,
  layout = "modal",
}: {
  form: ExpenseFormState;
  set: <K extends keyof ExpenseFormState>(key: K, value: ExpenseFormState[K]) => void;
  /** panel = inline strip under the toolbar (4 columns), modal = dialog (2). */
  layout?: "panel" | "modal";
}) {
  const wide = layout === "panel";
  return (
    <div className={wide ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "grid grid-cols-2 gap-3"}>
      <Field label="Category">
        <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {expenseCategories(form.category).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date">
        <input
          type="date"
          className={`${inputCls} num`}
          value={form.date}
          onChange={(e) => set("date", e.target.value)}
        />
      </Field>

      <Field label="Amount (Rs)" hint="VAT-exclusive">
        <input
          className={`${inputCls} num text-right`}
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
      </Field>

      <Field label="VAT (Rs)">
        <input
          className={`${inputCls} num text-right`}
          value={form.vat}
          onChange={(e) => set("vat", e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
      </Field>

      <div className={wide ? undefined : "col-span-2"}>
        <Field label="Status">
          <select
            className={inputCls}
            value={form.status}
            onChange={(e) => set("status", e.target.value as ExpenseStatus)}
          >
            <option value="paid">Paid</option>
            <option value="due">Due</option>
          </select>
        </Field>
      </div>

      <div className={wide ? "col-span-2 sm:col-span-3" : "col-span-2"}>
        <Field label="Description">
          <input
            className={inputCls}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What was it for?"
          />
        </Field>
      </div>

      <div className="col-span-full flex items-center justify-between rounded-[10px] border border-line bg-sub px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Total incl. VAT</span>
        <span className="num text-[13px] font-bold text-ink">{formatMUR(expenseFormTotalCents(form))}</span>
      </div>
    </div>
  );
}
