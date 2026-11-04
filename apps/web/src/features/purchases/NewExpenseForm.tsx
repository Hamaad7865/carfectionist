"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { parseMoneyInput } from "@/lib/money";
import { addExpenseAction } from "./actions";
import { btn } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { ExpenseFields, emptyExpenseForm, type ExpenseFormState } from "./ExpenseFields";

export function NewExpenseForm({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(() => emptyExpenseForm(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ExpenseFormState>(key: K, value: ExpenseFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    const amountCents = parseMoneyInput(form.amount) ?? 0;
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (!form.date) return setError("Pick a date.");
    setBusy(true);
    const res = await addExpenseAction({
      category: form.category,
      description: form.description,
      amountCents,
      vatCents: parseMoneyInput(form.vat) ?? 0,
      status: form.status,
      expenseDate: form.date,
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      // Keep the date — expenses are often entered in batches for one day.
      setForm(emptyExpenseForm(form.date || today));
      router.refresh();
    } else setError(res.error);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btn("primary", "lg", "gap-2")}>
        <Plus size={16} strokeWidth={2.4} /> New expense
      </button>
    );
  }

  return (
    // w-full parks the open form on its own line under the tabs (the toolbar is
    // flex-wrap) instead of squeezing it between "Purchase orders" and the edge.
    <div className="w-full rounded-[14px] border border-line bg-card p-4">
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        <ExpenseFields form={form} set={set} layout="panel" />
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className={btn("primary")}>
          {busy ? "Saving…" : "Save expense"}
        </button>
        <button onClick={() => setOpen(false)} className={btn("quiet")}>Cancel</button>
      </div>
    </div>
  );
}
