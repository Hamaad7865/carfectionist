"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, ArrowRight, Check, Play, X } from "lucide-react";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { createAppointmentAction, setAppointmentStatusAction, convertAppointmentToJobAction } from "./actions";
import type { AppointmentsData } from "@/lib/supabase/queries/appointments";
import { btn } from "@/components/ui/button";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-[rgba(43,140,255,0.12)] text-link" },
  confirmed: { label: "Confirmed", cls: "bg-[rgba(106,92,255,0.12)] text-[#6a5cff]" },
  arrived: { label: "Arrived", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink" },
  done: { label: "Done", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  cancelled: { label: "Cancelled", cls: "bg-[rgba(214,59,80,0.12)] text-rose" },
  no_show: { label: "No-show", cls: "bg-[rgba(140,150,161,0.16)] text-muted" },
};
// Render a stored UTC instant in the viewer's local time.
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AppointmentsPanel({ data }: { data: AppointmentsData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const vehicles = useMemo(() => data.customers.find((c) => c.id === customerId)?.vehicles ?? [], [customerId, data.customers]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [service, setService] = useState(data.isTyreShop ? "Wheel alignment" : "");
  const [department, setDepartment] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("45");
  const [alignedOn, setAlignedOn] = useState("");
  const [alignedAtKm, setAlignedAtKm] = useState("");
  const [nextAtKm, setNextAtKm] = useState("");
  const [notes, setNotes] = useState("");
  const [convertId, setConvertId] = useState<string | null>(null);

  function onCustomer(id: string) {
    setCustomerId(id);
    setVehicleId(data.customers.find((c) => c.id === id)?.vehicles[0]?.id ?? "");
  }

  async function create() {
    setError(null);
    if (!customerId || !vehicleId) return setError("Pick a customer and vehicle.");
    if (!scheduledAt) return setError("Pick a date & time.");
    // Convert the naive datetime-local (browser wall-clock) to a real UTC instant
    // here, where the browser knows the timezone — the server may run in UTC.
    const whenLocal = new Date(scheduledAt);
    if (Number.isNaN(whenLocal.getTime())) return setError("Invalid date & time.");
    const duration = Number(durationMinutes);
    const aligned = alignedAtKm.trim() ? Number(alignedAtKm) : null;
    const next = nextAtKm.trim() ? Number(nextAtKm) : null;
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return setError("Enter a duration between 1 and 1440 minutes.");
    if (data.isTyreShop && (!alignedOn || aligned == null || next == null)) {
      return setError("Enter the alignment date, aligned mileage and next mileage.");
    }
    if (aligned != null && (!Number.isInteger(aligned) || aligned < 0)) return setError("Aligned mileage must be a whole number.");
    if (next != null && (!Number.isInteger(next) || next < 0)) return setError("Next mileage must be a whole number.");
    if (aligned != null && next != null && next <= aligned) return setError("Next mileage must be greater than aligned mileage.");
    setBusy(true);
    const r = await createAppointmentAction({
      customerId,
      vehicleId,
      service: service.trim() || undefined,
      department: department || null,
      technicianId: technicianId || null,
      scheduledAt: whenLocal.toISOString(),
      durationMinutes: duration,
      alignedOn: alignedOn || null,
      alignedAtKm: aligned,
      nextAtKm: next,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (r.ok) {
      setService(data.isTyreShop ? "Wheel alignment" : "");
      setScheduledAt("");
      setAlignedOn("");
      setAlignedAtKm("");
      setNextAtKm("");
      setNotes("");
      router.refresh();
    }
    else setError(r.error);
  }
  async function setStatus(id: string, status: "confirmed" | "cancelled" | "no_show" | "done") {
    setBusy(true);
    const r = await setAppointmentStatusAction(id, status);
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }
  async function convert(id: string, mode: "schedule" | "start_now") {
    setError(null);
    setBusy(true);
    const r = await convertAppointmentToJobAction(id, mode);
    setBusy(false);
    if (r.ok && r.data) {
      setConvertId(null);
      router.push(`/jobs/${r.data.jobId}`);
    }
    else if (!r.ok) setError(r.error);
  }

  const iconBtn = "grid size-7 place-items-center rounded-md text-faint hover:bg-sub";
  const listColumns = data.isTyreShop
    ? "140px minmax(0,1fr) minmax(0,1fr) 150px 100px 150px"
    : "140px minmax(0,1fr) minmax(0,1fr) 100px 150px";
  const fmtKm = (value: number | null) =>
    value == null ? "—" : `${new Intl.NumberFormat("en-MU").format(value)} km`;
  const fmtDate = (value: string | null) => {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString("en-MU", { day: "numeric", month: "short" });
  };

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
          {data.isTyreShop && (
            <div className="rounded-[12px] border border-line bg-band p-3">
              <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-th">Alignment follow-up</div>
              <Field label="Aligned on">
                <input type="date" className={inputCls} value={alignedOn} onChange={(e) => setAlignedOn(e.target.value)} />
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-2.5">
                <Field label="Aligned at">
                  <input inputMode="numeric" className={inputCls} value={alignedAtKm} onChange={(e) => setAlignedAtKm(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="km" />
                </Field>
                <Field label="Next at">
                  <input inputMode="numeric" className={inputCls} value={nextAtKm} onChange={(e) => setNextAtKm(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="km" />
                </Field>
              </div>
            </div>
          )}
          <div className="grid grid-cols-[1fr_92px] gap-2.5">
            <Field label="Date & time"><input type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
            <Field label="Minutes"><input type="number" min={1} max={1440} className={inputCls} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Place of work">
              <select className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">—</option>
                {data.workPlaces.map((place) => <option key={place.id} value={place.name}>{place.name}</option>)}
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
          <button onClick={create} disabled={busy} className={btn("primary", "lg", "gap-2")}>
            <CalendarPlus size={16} /> {busy ? "Saving…" : "Book appointment"}
          </button>
        </div>
      </div>

      {/* schedule */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="hidden gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th md:grid" style={{ gridTemplateColumns: listColumns }}>
          <span>When</span><span>Customer</span><span>Vehicle · service</span>
          {data.isTyreShop && <span>Alignment</span>}
          <span>Status</span><span className="text-right">Actions</span>
        </div>
        {data.appointments.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No appointments booked.</div>
        ) : (
          data.appointments.map((a) => {
            const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.scheduled;
            const open = ["scheduled", "confirmed", "arrived"].includes(a.status) && !a.jobId;
            return (
              <div key={a.id} className="border-b border-line">
                {/* Mobile card */}
                <div className="flex flex-col gap-2 px-4 py-3 md:hidden">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-bold text-body">{a.customerName}</span>
                      <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-1 truncate text-[12.5px] text-muted">
                      {a.vehicle}
                      {(a.service || a.department) && <span className="text-faint"> · {[a.service, a.department].filter(Boolean).join(" / ")}</span>}
                    </div>
                    <div className={`num mt-0.5 text-[11.5px] ${a.overdue ? "font-bold text-rose" : "text-faint"}`}>{fmtWhen(a.scheduledAt)}</div>
                    {data.isTyreShop && (
                      <div className="mt-1 text-[11px] text-muted">
                        Aligned {fmtKm(a.alignedAtKm)}{a.alignedOn ? ` · ${fmtDate(a.alignedOn)}` : ""} · Next {fmtKm(a.nextAtKm)}
                      </div>
                    )}
                  </div>
                  {(a.jobId || open) && (
                    <div className="flex items-center gap-1.5">
                      {a.jobId ? (
                        <Link href={`/jobs/${a.jobId}`} className="text-[11.5px] font-bold text-link hover:underline">View job →</Link>
                      ) : open ? (
                        <>
                          {a.status === "scheduled" && <button title="Confirm" onClick={() => setStatus(a.id, "confirmed")} disabled={busy} className={`${iconBtn} hover:text-[#6a5cff]`}><Check size={15} /></button>}
                          <button title="Convert to job" onClick={() => setConvertId(a.id)} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md bg-[rgba(43,140,255,0.12)] px-2 text-[11px] font-bold text-link hover:bg-[rgba(43,140,255,0.2)]">
                            Job <ArrowRight size={12} />
                          </button>
                          <button title="Cancel" onClick={() => setStatus(a.id, "cancelled")} disabled={busy} className={`${iconBtn} hover:text-rose`}><X size={14} /></button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
                {/* Desktop grid */}
                <div className="hidden items-center gap-3 px-5 py-3 text-[12.5px] md:grid" style={{ gridTemplateColumns: listColumns }}>
                  <span className={`num ${a.overdue ? "font-bold text-rose" : "text-body"}`}>{fmtWhen(a.scheduledAt)}</span>
                  <span className="truncate text-body">{a.customerName}</span>
                  <span className="truncate text-muted">
                    {a.vehicle}
                    {(a.service || a.department) && <span className="text-faint"> · {[a.service, a.department].filter(Boolean).join(" / ")}</span>}
                  </span>
                  {data.isTyreShop && (
                    <span className="min-w-0 text-[11.5px] text-muted">
                      <span className="block truncate">
                        Aligned {fmtKm(a.alignedAtKm)}{a.alignedOn ? ` · ${fmtDate(a.alignedOn)}` : ""}
                      </span>
                      <span className={`block truncate ${a.overdue ? "font-bold text-rose" : "text-body"}`}>Next {fmtKm(a.nextAtKm)}</span>
                    </span>
                  )}
                  <span><span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold ${st.cls}`}>{st.label}</span></span>
                  <span className="flex items-center justify-end gap-1.5">
                    {a.jobId ? (
                      <Link href={`/jobs/${a.jobId}`} className="text-[11.5px] font-bold text-link hover:underline">View job →</Link>
                    ) : open ? (
                      <>
                        {a.status === "scheduled" && <button title="Confirm" onClick={() => setStatus(a.id, "confirmed")} disabled={busy} className={`${iconBtn} hover:text-[#6a5cff]`}><Check size={15} /></button>}
                        <button title="Convert to job" onClick={() => setConvertId(a.id)} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md bg-[rgba(43,140,255,0.12)] px-2 text-[11px] font-bold text-link hover:bg-[rgba(43,140,255,0.2)]">
                          Job <ArrowRight size={12} />
                        </button>
                        <button title="Cancel" onClick={() => setStatus(a.id, "cancelled")} disabled={busy} className={`${iconBtn} hover:text-rose`}><X size={14} /></button>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
      {convertId && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(15,23,36,0.44)] p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="convert-appointment-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-[18px] border border-line bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h3 id="convert-appointment-title" className="font-display text-[18px] font-extrabold text-ink-strong">Create the job</h3>
                <p className="mt-1 text-[12.5px] text-muted">Keep the booking for later, or put the car into work now.</p>
              </div>
              <button onClick={() => !busy && setConvertId(null)} className="grid size-8 place-items-center rounded-lg bg-sub text-muted" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-3 p-5">
              <button
                onClick={() => convert(convertId, "schedule")}
                disabled={busy}
                className="flex min-h-16 items-center gap-3 rounded-[13px] border border-line-2 bg-card p-3.5 text-left hover:border-brand hover:bg-sub disabled:opacity-60"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[rgba(43,140,255,0.12)] text-link"><CalendarPlus size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-body">Schedule job</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">Use the appointment date and duration.</span>
                </span>
                <ArrowRight size={16} className="text-link" />
              </button>
              <button
                onClick={() => convert(convertId, "start_now")}
                disabled={busy}
                className="flex min-h-16 items-center gap-3 rounded-[13px] bg-brand p-3.5 text-left text-white shadow-brand hover:opacity-95 disabled:opacity-60"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white/15"><Play size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold">Start now</span>
                  <span className="mt-0.5 block text-[11.5px] text-white/75">Create the job and start the workshop clock.</span>
                </span>
                <ArrowRight size={16} />
              </button>
              {error && <FormError error={error} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
