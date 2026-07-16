"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, Check, Send, X } from "lucide-react";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { createReminderAction, setReminderStatusAction } from "./actions";
import type { RemindersData } from "@/lib/supabase/queries/reminders";
import { btn } from "@/components/ui/button";

const KINDS = ["Ceramic coating top-up", "Annual inspection", "Wash membership renewal", "Tint warranty check", "PPF maintenance"];
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-[rgba(43,140,255,0.12)] text-link" },
  sent: { label: "Sent", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink" },
  done: { label: "Done", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  dismissed: { label: "Dismissed", cls: "bg-[rgba(140,150,161,0.16)] text-muted" },
};

export function RemindersPanel({ data, today }: { data: RemindersData; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const vehicles = useMemo(() => data.customers.find((c) => c.id === customerId)?.vehicles ?? [], [customerId, data.customers]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [kind, setKind] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  function onCustomer(id: string) {
    setCustomerId(id);
    setVehicleId(data.customers.find((c) => c.id === id)?.vehicles[0]?.id ?? "");
  }

  async function create() {
    setError(null);
    if (!customerId || !vehicleId) return setError("Pick a customer and vehicle.");
    setBusy(true);
    const r = await createReminderAction({ customerId, vehicleId, kind, dueDate, notes: notes.trim() || undefined });
    setBusy(false);
    if (r.ok) { setKind(""); setDueDate(""); setNotes(""); router.refresh(); }
    else setError(r.error);
  }
  async function setStatus(id: string, status: "sent" | "done" | "dismissed") {
    setBusy(true);
    const r = await setReminderStatusAction(id, status);
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      {/* create */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <BellPlus size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">New reminder</span>
        </div>
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Customer">
            <select className={inputCls} value={customerId} onChange={(e) => onCustomer(e.target.value)}>
              {data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Vehicle">
            <select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.length === 0 && <option value="">— no vehicle on file —</option>}
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="What for">
            <input className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="e.g. Ceramic coating top-up" list="reminder-kinds" />
            <datalist id="reminder-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
          </Field>
          <Field label="Due date"><input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
          <button onClick={create} disabled={busy} className={btn("primary", "lg", "gap-2")}>
            <BellPlus size={16} /> {busy ? "Saving…" : "Add reminder"}
          </button>
        </div>
      </div>

      {/* list */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="grid grid-cols-[100px_1fr_1fr_100px_150px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
          <span>Due</span><span>Customer</span><span>Vehicle · what</span><span>Status</span><span className="text-right">Actions</span>
        </div>
        {data.reminders.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No reminders yet.</div>
        ) : (
          data.reminders.map((r) => {
            const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
            return (
              <div key={r.id} className="grid grid-cols-[100px_1fr_1fr_100px_150px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
                <span className={`num ${r.overdue ? "font-bold text-rose" : "text-muted"}`}>{r.dueDate}{r.overdue && <span className="ml-1 text-[9px] font-bold uppercase">due</span>}</span>
                <span className="truncate text-body">{r.customerName}</span>
                <span className="truncate text-muted">{r.vehicle}<span className="text-faint"> · {r.kind}</span></span>
                <span><span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold ${st.cls}`}>{st.label}</span></span>
                <span className="flex justify-end gap-1.5">
                  {(r.status === "pending" || r.status === "sent") && (
                    <>
                      {r.status === "pending" && <button title="Mark sent" onClick={() => setStatus(r.id, "sent")} disabled={busy} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-amber-ink"><Send size={14} /></button>}
                      <button title="Mark done" onClick={() => setStatus(r.id, "done")} disabled={busy} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-mint"><Check size={15} /></button>
                      <button title="Dismiss" onClick={() => setStatus(r.id, "dismissed")} disabled={busy} className="grid size-7 place-items-center rounded-md text-faint hover:bg-sub hover:text-rose"><X size={14} /></button>
                    </>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
