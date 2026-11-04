"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { ExpenseRow } from "@/lib/supabase/queries/purchases";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { StatusPill } from "@/components/ui/StatusPill";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { btn } from "@/components/ui/button";
import { updateExpenseAction } from "./actions";
import { ExpenseFields, expenseFormFrom, type ExpenseFormState } from "./ExpenseFields";

// Date · category · description · status · amount · edit
const GRID = "md:grid-cols-[100px_136px_1fr_92px_128px_32px]";

// 28px on touch, 24px on mouse: the pencil must not make every row taller than
// the text it sits beside (the old row was 24px of text + py-3.5 = ~49px).
const editBtn =
  "grid size-7 md:size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-sub hover:text-brand " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Expenses list with a per-row edit dialog. Rows are server-rendered data, but a
 * mistake can only be fixed where the handler lives, so the row markup moved
 * into this client island to carry the pencil + modal. Totals stay computed on
 * the server (and are recomputed there after the refresh).
 */
export function ExpensesPanel({ expenses, totalCents }: { expenses: ExpenseRow[]; totalCents: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState<ExpenseFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function launch(row: ExpenseRow) {
    setEditing(row);
    setForm(expenseFormFrom(row));
    setError(null);
  }

  function close() {
    if (busy) return;
    setEditing(null);
    setForm(null);
    setError(null);
  }

  function set<K extends keyof ExpenseFormState>(key: K, value: ExpenseFormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save() {
    if (!editing || !form) return;
    setError(null);
    const amountCents = parseMoneyInput(form.amount) ?? 0;
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (!form.date) return setError("Pick a date.");

    setBusy(true);
    const res = await updateExpenseAction({
      id: editing.id,
      category: form.category,
      description: form.description,
      amountCents,
      vatCents: parseMoneyInput(form.vat) ?? 0,
      status: form.status,
      expenseDate: form.date,
    });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      setForm(null);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <>
      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className={`hidden ${GRID} gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th md:grid`}>
          <span>Date</span>
          <span>Category</span>
          <span>Description</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {expenses.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-faint">No expenses yet. Add your first with “New expense”.</div>
        ) : (
          expenses.map((e) => {
            const label = e.description ?? e.category;
            return (
              <div key={e.id} className="border-b border-line">
                {/* Mobile card */}
                <div className="px-4 py-3 md:hidden">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-body">{label}</span>
                    <span className="num shrink-0 text-[13px] font-bold text-ink">{formatMUR(e.amountCents + e.vatCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[11.5px] text-muted">{e.category} · {e.date}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusPill status={e.status} />
                      <button onClick={() => launch(e)} aria-label={`Edit ${label}`} title="Edit expense" className={editBtn}>
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Desktop grid */}
                <div className={`hidden ${GRID} items-center gap-3 px-5 py-3 text-[13px] md:grid`}>
                  <span className="num text-muted">{e.date}</span>
                  <span className="min-w-0 truncate text-muted" title={e.category}>{e.category}</span>
                  <span className="min-w-0 font-semibold text-body">{label}</span>
                  <span><StatusPill status={e.status} /></span>
                  <span className="num text-right font-bold text-ink">{formatMUR(e.amountCents + e.vatCents)}</span>
                  <button onClick={() => launch(e)} aria-label={`Edit ${label}`} title="Edit expense" className={editBtn}>
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}

        <div className="flex justify-between bg-band px-5 py-3.5">
          <span className="text-[12.5px] font-bold text-th">Total expenses (incl. VAT)</span>
          <span className="num text-[14px] font-extrabold text-rose">{formatMUR(totalCents)}</span>
        </div>
      </div>

      <Modal
        open={!!editing && !!form}
        onClose={close}
        title="Edit expense"
        subtitle={editing ? `${editing.category} · ${editing.date}` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={close} disabled={busy} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={save} disabled={busy} className={btn("primary", "lg", "px-5")}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            <FormError error={error} />
            <ExpenseFields form={form} set={set} layout="modal" />
            <p className="text-[11.5px] text-faint">
              Corrections flow straight into input VAT and the profit &amp; loss report.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
