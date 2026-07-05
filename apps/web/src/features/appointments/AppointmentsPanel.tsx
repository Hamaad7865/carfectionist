"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, ArrowRight, Check, X } from "lucide-react";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { DEPARTMENTS } from "@/lib/departments";
import { createAppointmentAction, setAppointmentStatusAction, convertAppointmentToJobAction } from "./actions";
import type { AppointmentsData } from "@/lib/supabase/queries/appointments";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-[rgba(43,140,255,0.12)] text-link" },
  confirmed: { label: "Confirmed", cls: "bg-[rgba(106,92,255,0.12)] text-[#6a5cff]" },
  arrived: { label: "Arrived", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink" },
  done: { label: "Done", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  cancelled: { label: "Cancelled", cls: "bg-[rgba(214,59,80,0.12)] text-rose" },
  no_show: { label: "No-show", cls: "bg-[rgba(140,150,161,0.16)] text-muted" },
};
const fmtWhen = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function AppointmentsPanel({ data }: { data: AppointmentsData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const vehicles = useMemo(() => data.customers.find((c) => c.id === customerId)?.vehicles ?? [], [customerId, data.customers]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [service, setService] = useState("");
  const [department, setDepartment] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");

  function onCustomer(id: string) {
    setCustomerId(id);
    setVehicleId(data.customers.find((c) => c.id === id)?.vehicles[0]?.id ?? "");
  }

  async function create() {
    setError(null);
    if (!customerId || !vehicleId) return setError("Pick a customer and vehicle.");
    if (!scheduledAt) return setError("Pick a date & time.");
    setBusy(true);
    const r = await createAppointmentAction({ customerId, vehicleId, service: service.trim() || undefined, department: department || null, technicianId: technicianId || null, scheduledAt, notes: notes.trim() || undefined });
    setBusy(false);
    if (r.ok) { setService(""); setScheduledAt(""); setNotes(""); router.refresh(); }
    else setError(r.error);
  }
  async function setStatus(id: string, status: "confirmed" | "cancelled" | "no_show" | "done") {
    setBusy(true);
    const r = await setAppointmentStatusAction(id, status);
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }
  async function convert(id: string) {
    setError(null);
    setBusy(true);
    const r = await convertAppointmentToJobAction(id);
    setBusy(false);
    if (r.ok && r.data) router.push(`/jobs/${r.data.jobId}`);
    else if (!r.ok) setError(r.error);
  }

  const iconBtn = "grid size-7 place-items-center rounded-md text-faint hover:bg-sub";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      {/* book */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <CalendarPlus size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Book appointment</span>
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
          <Field label="Date & time"><input type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Place of work">
              <select className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">—</option>
                {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Assigned to">
              <select className={inputCls} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                <option value="">—</option>
                {data.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Service"><input className={inputCls} value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Full detail + ceramic" /></Field>
          <Field label="Notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
          <button onClick={create} disabled={busy} className="grad-brand shadow-brand inline-flex h-11 items-center justify-center gap-2 rounded-[12px] font-bold text-white disabled:opacity-60">
            <CalendarPlus size={16} /> {busy ? "Saving…" : "Book appointment"}
          </button>
        </div>
      </div>

      {/* schedule */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="grid grid-cols-[140px_1fr_1fr_100px_150px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          <span>When</span><span>Customer</span><span>Vehicle · service</span><span>Status</span><span className="text-right">Actions</span>
        </div>
        {data.appointments.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No appointments booked.</div>
        ) : (
          data.appointments.map((a) => {
            const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.scheduled;
            const open = a.status === "scheduled" || a.status === "confirmed";
            return (
              <div key={a.id} className="grid grid-cols-[140px_1fr_1fr_100px_150px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
                <span className={`num ${a.overdue ? "font-bold text-rose" : "text-body"}`}>{fmtWhen(a.scheduledAt)}</span>
                <span className="truncate text-body">{a.customerName}</span>
                <span className="truncate text-muted">
                  {a.vehicle}
                  {(a.service || a.department) && <span className="text-faint"> · {[a.service, a.department].filter(Boolean).join(" / ")}</span>}
                </span>
                <span><span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold ${st.cls}`}>{st.label}</span></span>
                <span className="flex items-center justify-end gap-1.5">
                  {a.jobId ? (
                    <Link href={`/jobs/${a.jobId}`} className="text-[11.5px] font-bold text-link hover:underline">View job →</Link>
                  ) : open ? (
                    <>
                      {a.status === "scheduled" && <button title="Confirm" onClick={() => setStatus(a.id, "confirmed")} disabled={busy} className={`${iconBtn} hover:text-[#6a5cff]`}><Check size={15} /></button>}
                      <button title="Convert to job" onClick={() => convert(a.id)} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md bg-[rgba(43,140,255,0.12)] px-2 text-[11px] font-bold text-link hover:bg-[rgba(43,140,255,0.2)]">
                        Job <ArrowRight size={12} />
                      </button>
                      <button title="Cancel" onClick={() => setStatus(a.id, "cancelled")} disabled={busy} className={`${iconBtn} hover:text-rose`}><X size={14} /></button>
                    </>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
