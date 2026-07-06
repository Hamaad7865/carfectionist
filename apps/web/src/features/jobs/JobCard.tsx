"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, Square, Plus, Check, Trash2, FileText, FilePlus2 } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";
import type { JobDetail, JobRefData } from "@/lib/supabase/queries/jobs";
import { DEPARTMENTS } from "@/lib/departments";
import {
  toggleTimerAction,
  assignTechnicianAction,
  setJobDepartmentAction,
  updateChecklistAction,
  setJobStatusAction,
  completeJobAction,
  createDocumentFromJobAction,
} from "./actions";

const DOC_LABEL: Record<string, string> = { quote: "Quotation", invoice: "Invoice", credit_note: "Credit note" };

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const field = "h-9 rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";

export function JobCard({ job, refData }: { job: JobDetail; refData: JobRefData }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(job.elapsedSeconds);
  const [checklist, setChecklist] = useState(job.checklist);
  const [newItem, setNewItem] = useState("");
  const [consume, setConsume] = useState<{ productId: string; qty: number }[]>([]);
  const [cProd, setCProd] = useState("");
  const [cQty, setCQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState<null | "quote" | "invoice">(null);
  const creatingRef = useRef(false);
  const readOnly = job.status === "ready" || job.status === "delivered";

  async function createDoc(docType: "quote" | "invoice") {
    // Synchronous re-entry lock: setDocBusy only disables after a re-render, so a
    // fast second click would otherwise create a duplicate draft.
    if (creatingRef.current) return;
    creatingRef.current = true;
    setDocBusy(docType);
    setError(null);
    const r = await createDocumentFromJobAction(job.id, docType);
    if (r.ok && r.data) {
      router.push(`/sales/${r.data.id}/edit`); // leaving the page; keep the lock held
    } else {
      creatingRef.current = false;
      setDocBusy(null);
      setError(!r.ok ? r.error : "Could not create the document.");
    }
  }

  useEffect(() => {
    if (!job.running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [job.running]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Something went wrong");
    else router.refresh();
  }

  function toggleCheck(i: number) {
    const next = checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c));
    setChecklist(next);
    void updateChecklistAction(job.id, next);
  }
  function addCheck() {
    if (!newItem.trim()) return;
    const next = [...checklist, { label: newItem.trim(), done: false }];
    setChecklist(next);
    setNewItem("");
    void updateChecklistAction(job.id, next);
  }

  const checkDone = checklist.filter((c) => c.done).length;
  const consumeName = (id: string) => refData.consumables.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/jobs" className="text-[13px] font-semibold text-muted hover:text-body">← Jobs board</Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="num text-[11px] font-bold text-link">JOB-{job.id.slice(0, 4).toUpperCase()}</div>
          <h2 className="mt-1 font-display text-[22px] font-extrabold text-ink-strong">{job.vehicle ?? "—"}</h2>
          <div className="num text-[13px] text-muted">{job.plate} · {job.service ?? "—"}</div>
        </div>
        <StatusPill status={job.status} />
      </div>

      {error && <p className="mt-3 rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      {/* timer */}
      <div className="mt-5 flex items-center gap-4 rounded-[15px] border border-line bg-card p-4">
        <div className="flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Time on job</div>
          <div className="num mt-1 text-[32px] font-extrabold text-ink-strong">{fmt(seconds)}</div>
        </div>
        {!readOnly && (
          <button
            onClick={() => run(() => toggleTimerAction(job.id))}
            disabled={busy}
            className={`flex h-[52px] items-center gap-2 rounded-[13px] px-5 text-[14px] font-bold ${job.running ? "bg-[rgba(214,59,80,0.12)] text-rose" : "grad-brand shadow-brand text-white"}`}
          >
            {job.running ? <><Square size={17} /> Stop</> : <><Play size={17} /> Start</>}
          </button>
        )}
      </div>

      {/* technician + place of work */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[13px] border border-line bg-card px-4 py-3">
        <span className="text-[13px] font-semibold text-body">Assigned to</span>
        <select
          className={field}
          value={job.technicianId ?? ""}
          disabled={readOnly}
          onChange={(e) => run(() => assignTechnicianAction(job.id, e.target.value || null))}
        >
          <option value="">— unassigned —</option>
          {refData.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="ml-2 text-[13px] font-semibold text-body">Place of work</span>
        <select
          className={field}
          value={job.department ?? ""}
          disabled={readOnly}
          onChange={(e) => run(() => setJobDepartmentAction(job.id, e.target.value || null))}
        >
          <option value="">— department —</option>
          {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
        </select>
      </div>

      {/* billing — quotes & invoices raised from this job */}
      <div className="mt-4 rounded-[15px] border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
            <FileText size={14} /> Billing
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => createDoc("quote")}
              disabled={docBusy !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12.5px] font-bold text-body disabled:opacity-60"
            >
              <Plus size={14} strokeWidth={2.6} /> {docBusy === "quote" ? "Creating…" : "Quote"}
            </button>
            <button
              onClick={() => createDoc("invoice")}
              disabled={docBusy !== null}
              className="grad-brand shadow-brand inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-bold text-white disabled:opacity-60"
            >
              <FilePlus2 size={14} strokeWidth={2.4} /> {docBusy === "invoice" ? "Creating…" : "Invoice"}
            </button>
          </div>
        </div>
        {job.documents.length === 0 ? (
          <p className="text-[13px] text-faint">No quote or invoice yet — create one from this job.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {job.documents.map((d) => (
              <li key={d.id}>
                <Link
                  href={d.status === "draft" ? `/sales/${d.id}/edit` : `/sales/${d.id}`}
                  className="flex items-center justify-between gap-3 rounded-[11px] border border-line bg-sub px-3.5 py-2.5 hover:border-line-2"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-ink">{DOC_LABEL[d.docType] ?? d.docType}</span>
                    {d.number && <span className="num text-[12px] text-muted">{d.number}</span>}
                    <StatusPill status={d.status} />
                  </span>
                  <span className="flex items-center gap-3 text-[13px]">
                    {d.docType === "invoice" && d.outstandingCents > 0 && (
                      <span className="num text-[12px] font-semibold text-amber-ink">{formatMUR(d.outstandingCents)} due</span>
                    )}
                    <span className="num font-semibold text-ink">{formatMUR(d.totalCents)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* checklist */}
      <div className="mt-5">
        <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Checklist · {checkDone}/{checklist.length}</div>
        <div className="flex flex-col gap-2">
          {checklist.map((c, i) => (
            <button key={i} onClick={() => !readOnly && toggleCheck(i)} className="flex items-center gap-3 rounded-[12px] border border-line bg-card px-3.5 py-3 text-left">
              <span className={`grid size-6 shrink-0 place-items-center rounded-[7px] border-2 ${c.done ? "border-brand bg-brand text-white" : "border-line-2"}`}>
                {c.done && <Check size={14} strokeWidth={3} />}
              </span>
              <span className={`text-[14px] ${c.done ? "text-faint line-through" : "font-semibold text-body"}`}>{c.label}</span>
            </button>
          ))}
        </div>
        {!readOnly && (
          <div className="mt-2 flex gap-2">
            <input className={`${field} flex-1`} value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a checklist item…" onKeyDown={(e) => e.key === "Enter" && addCheck()} />
            <button onClick={addCheck} className="inline-flex h-9 items-center justify-center rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] font-semibold text-body">Add</button>
          </div>
        )}
      </div>

      {/* consumption + complete */}
      {!readOnly && (
        <div className="mt-6 rounded-[15px] border border-line bg-card p-4">
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Stock consumed</div>
          {consume.map((c, i) => (
            <div key={i} className="mb-2 flex items-center gap-2 text-[13px]">
              <span className="flex-1 text-body">{consumeName(c.productId)}</span>
              <span className="num text-muted">× {c.qty}</span>
              <button onClick={() => setConsume(consume.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded text-faint hover:text-rose"><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <select className={`${field} flex-1`} value={cProd} onChange={(e) => setCProd(e.target.value)}>
              <option value="">— consumable —</option>
              {refData.consumables.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </select>
            <input className={`${field} num w-20 text-right`} value={cQty} onChange={(e) => setCQty(e.target.value)} inputMode="decimal" />
            <button
              onClick={() => { if (cProd && Number(cQty) > 0) { setConsume([...consume, { productId: cProd, qty: Number(cQty) }]); setCProd(""); setCQty("1"); } }}
              className="grid size-9 place-items-center rounded-[10px] bg-[rgba(43,140,255,0.14)] text-link"
            >
              <Plus size={16} strokeWidth={2.6} />
            </button>
          </div>
          <button
            onClick={() => run(() => completeJobAction({ jobId: job.id, consumptions: consume }))}
            disabled={busy}
            className="grad-brand shadow-brand mt-4 flex h-12 w-full items-center justify-center rounded-[13px] font-display text-[15px] font-extrabold text-white disabled:opacity-60"
          >
            Complete job &amp; consume stock →
          </button>
        </div>
      )}

      {job.status === "ready" && (
        <button onClick={() => run(() => setJobStatusAction(job.id, "delivered"))} disabled={busy} className="mt-5 flex h-11 w-full items-center justify-center rounded-[12px] border border-line-2 bg-card text-[14px] font-bold text-body">
          Mark delivered
        </button>
      )}
    </div>
  );
}
