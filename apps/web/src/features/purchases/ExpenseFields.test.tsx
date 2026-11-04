import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExpenseFields,
  emptyExpenseForm,
  expenseCategories,
  expenseFormFrom,
  expenseFormTotalCents,
} from "./ExpenseFields";
import type { ExpenseRow } from "@/lib/supabase/queries/purchases";

const row: ExpenseRow = {
  id: "5f0d3f0e-0000-4000-8000-000000000001",
  date: "2026-11-04",
  category: "Equipment",
  description: "1 caisse oval",
  amountCents: 89900,
  vatCents: 0,
  status: "paid",
};

describe("expenseFormFrom", () => {
  it("turns stored cents into editable rupee strings", () => {
    expect(expenseFormFrom(row)).toEqual({
      category: "Equipment",
      description: "1 caisse oval",
      amount: "899.00",
      vat: "",
      status: "paid",
      date: "2026-11-04",
    });
  });

  it("keeps VAT blank only when there is none, and never drops decimals", () => {
    expect(expenseFormFrom({ ...row, amountCents: 1782287, vatCents: 267343 }).amount).toBe("17822.87");
    expect(expenseFormFrom({ ...row, amountCents: 1782287, vatCents: 267343 }).vat).toBe("2673.43");
  });

  it("maps the status and falls back to due for anything else", () => {
    expect(expenseFormFrom({ ...row, status: "due" }).status).toBe("due");
    expect(expenseFormFrom({ ...row, status: "unknown" }).status).toBe("paid");
  });

  it("renders an empty description as an empty input, not the word null", () => {
    expect(expenseFormFrom({ ...row, description: null }).description).toBe("");
  });
});

describe("expenseCategories", () => {
  it("offers the standard list", () => {
    expect(expenseCategories("Other")).toContain("Equipment");
  });

  it("keeps a stored custom category selectable instead of silently rewriting it", () => {
    const list = expenseCategories("Vehicle wrap");
    expect(list[0]).toBe("Vehicle wrap");
    expect(list).toContain("Other");
  });
});

describe("expenseFormTotalCents", () => {
  it("sums amount and VAT", () => {
    const form = emptyExpenseForm("2026-11-04");
    expect(expenseFormTotalCents({ ...form, amount: "17822.87", vat: "1000.00" })).toBe(1882287);
  });

  it("treats blank VAT as zero", () => {
    const form = emptyExpenseForm("2026-11-04");
    expect(expenseFormTotalCents({ ...form, amount: "899.00", vat: "" })).toBe(89900);
  });

  it("ignores malformed input rather than rendering NaN", () => {
    const form = emptyExpenseForm("2026-11-04");
    expect(expenseFormTotalCents({ ...form, amount: "abc", vat: "" })).toBe(0);
  });
});

describe("ExpenseFields", () => {
  it("pre-fills the edit form and shows the live total incl. VAT", () => {
    const html = renderToStaticMarkup(
      <ExpenseFields form={expenseFormFrom({ ...row, vatCents: 13485 })} set={() => {}} />,
    );
    expect(html).toContain('value="899.00"');
    expect(html).toContain('value="134.85"');
    expect(html).toContain('value="2026-11-04"');
    expect(html).toContain("Total incl. VAT");
    expect(html).toContain("Rs 1,033.85");
  });
});
