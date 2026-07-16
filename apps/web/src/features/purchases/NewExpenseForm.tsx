"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { parseMoneyInput } from "@/lib/money";
import { addExpenseAction } from "./actions";
import { btn } from "@/components/ui/button";

const CATS = ["Supplies", "Rent", "Utilities", "Salaries", "Marketing", "Equipment", "Insurance", "Other"];
const field = "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint";

export function NewExpenseForm({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Supplies");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  const [status, setStatus] = useState<"paid" | "due">("paid");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amountCents = parseMoneyInput(amount) ?? 0;
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    setBusy(true);
    const res = await addExpenseAction({
      category,
      description,
      amountCents,
      vatCents: parseMoneyInput(vat) ?? 0,
      status,
      expenseDate: date,
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setAmount("");
      setVat("");
      setDescription("");
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
    <div className="rounded-[14px] border border-line bg-card p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={lbl}>Category</span>
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="col-span-2 block sm:col-span-1">
          <span className={lbl}>Amount (Rs)</span>
          <input className={`${field} num text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
        <label className="block">
          <span className={lbl}>VAT (Rs)</span>
          <input className={`${field} num text-right`} value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" placeholder="0" />
        </label>
        <label className="block">
          <span className={lbl}>Status</span>
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value as "paid" | "due")}>
            <option value="paid">Paid</option>
            <option value="due">Due</option>
          </select>
        </label>
        <label className="col-span-2 block sm:col-span-3">
          <span className={lbl}>Description</span>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" />
        </label>
        <label className="block">
          <span className={lbl}>Date</span>
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-rose">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className={btn("primary")}>
          {busy ? "Saving…" : "Save expense"}
        </button>
        <button onClick={() => setOpen(false)} className={btn("quiet")}>Cancel</button>
      </div>
    </div>
  );
}
