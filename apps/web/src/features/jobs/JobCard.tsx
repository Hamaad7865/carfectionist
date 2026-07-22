"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, Pause, Plus, Check, Trash2, FileText, FilePlus2 } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";
import type { JobDetail, JobRefData } from "@/lib/supabase/queries/jobs";
import { DEPARTMENTS } from "@/lib/departments";
import { CarDiagram } from "@/features/intake/CarDiagram";
import { PhotoUploader, type IntakePhoto } from "@/features/intake/PhotoUploader";
import { markerMeta } from "@/features/intake/damage";
import { addJobPhotoAction } from "@/features/intake/actions";
import {
  toggleTimerAction,
  toggleJobPauseAction,
  assignTechnicianAction,
  setJobDepartmentAction,
  updateChecklistAction,
  setJobStatusAction,
  cancelJobAction,
  completeJobAction,
  createDocumentFromJobAction,
  recordPaymentAction,
  setJobScheduleAction,
} from "./actions";
import { estimatedFinish } from "./clock";
import { btn } from "@/components/ui/button";

const DOC_LABEL: Record<string, string> = { quote: "Quotation", invoice: "Invoice", credit_note: "Credit note" };

/** "Tue 14 Jul, 14:30" — Mauritius time, the only clock the shop runs on. */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "Indian/Mauritius",
});
function fmtWhen(iso: string | number | null): string | null {
  if (iso == null) return null;
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  return Number.isNaN(ms) ? null : WHEN.format(ms);
}

/** 90 → "1h 30m". The estimate is spoken in hours and minutes, never "90 minutes". */
function fmtMins(m: number): string {
  const h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r}m` : r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** An <input type="datetime-local"> wants local wall-clock, not a UTC instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EST_CHOICES = [30, 60, 120, 240, 480];

const PAY_METHODS = [
  { v: "bank_transfer", label: "Bank transfer" },
  { v: "card", label: "Card" },
  { v: "juice", label: "Juice" },
] as const;

/**
 * A deposit, or part of a bill, taken from the back office. Any amount up to the balance —
 * the invoice goes partly paid and the remainder waits in the counter's TO COLLECT.
 */
function PartPayment({
  jobId, invoiceId, outstandingCents, onDone,
}: {
  jobId: string;
  invoiceId: string;
  outstandingCents: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAY_METHODS)[number]["v"]>("bank_transfer");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // One idempotency token per opened form (audit #4): a double-click reuses it and stays
  // safe, while a genuine second instalment — a fresh open — gets a fresh token so it is
  // never mistaken for a replay of the first.
  const [token, setToken] = useState("");

  const outstanding = outstandingCents / 100;
  const typed = Number(amount);
  // The pad on the tablet clamps the same way. Nobody should discover the ceiling by
  // having the transaction thrown back at them with the customer waiting.
  const over = Number.isFinite(typed) && typed > outstanding + 0.001;

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await recordPaymentAction(jobId, invoiceId, typed, method, ref, token);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOpen(false);
    setAmount("");
    setRef("");
    onDone();
  }

  if (!open) {
    return (
      <button onClick={() => { setToken(crypto.randomUUID()); setOpen(true); }} className="mt-1.5 text-[12px] font-semibold text-link hover:underline">
        Record a payment
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-[11px] border border-line bg-card p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Amount</span>
          <input
            type="number" min={0.01} max={outstanding} step="0.01" autoFocus
            placeholder={outstanding.toFixed(2)}
            className={`${field} w-[120px]`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => setAmount(outstanding.toFixed(2))}
          className="h-9 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12.5px] font-bold text-body"
        >
          Full {formatMUR(outstandingCents)}
        </button>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Method</span>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {PAY_METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Reference</span>
          <input
            className={`${field} w-[150px]`}
            placeholder="e.g. MCB-2214"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </label>
        <button
          onClick={submit}
          disabled={busy || !(typed > 0) || over || !ref.trim()}
          className="grad-brand shadow-brand h-9 rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Recording…" : "Record"}
        </button>
        <button onClick={() => { setOpen(false); setErr(null); }} className="h-9 px-2 text-[12.5px] font-semibold text-muted">
          Cancel
        </button>
      </div>
      {over && <p className="mt-2 text-[12px] text-rose">That is more than the {formatMUR(outstandingCents)} still owed.</p>}
      {typed > 0 && !over && typed < outstanding && (
        <p className="mt-2 text-[12px] text-muted">
          Leaves {formatMUR(outstandingCents - Math.round(typed * 100))} owing — it stays in Checkout to collect.
        </p>
      )}
      {err && <p className="mt-2 text-[12px] text-rose">{err}</p>}
    </div>
  );
}

/**
 * One line of the job's life. A step that hasn't happened renders nothing at all —
 * an empty "Started —" row reads as a fault rather than as work still to come.
 */
function Step({
  label, value, tone = "done", note,
}: {
  label: string;
  value: string | null;
  tone?: "done" | "estimate" | "late";
  note?: string;
}) {
  if (!value) return null;
  const cls =
    tone === "late" ? "text-rose font-bold"
    : tone === "estimate" ? "text-amber-ink font-semibold"
    : "text-body";
  return (
    <>
      <dt className="text-[12.5px] font-semibold text-muted">{label}</dt>
      <dd className={`num text-[13px] ${cls}`}>
        {value}
        {note && <span className="ml-2 text-[11.5px] font-semibold uppercase tracking-wide">{note}</span>}
      </dd>
    </>
  );
}

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
  // Errors render next to the control that caused them — a banner pinned at the
  // top is invisible when the Billing/Complete buttons are below the fold.
  const [error, setError] = useState<{ at: "top" | "photos" | "billing" | "bottom"; msg: string } | null>(null);
  const [docBusy, setDocBusy] = useState<null | "quote" | "invoice">(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const creatingRef = useRef(false);
  const readOnly = job.status === "ready" || job.status === "delivered";

  // The database allows ONE live document of each type per job (voids excluded,
  // drafts included — "no unbounded drafts"). These buttons used to render
  // regardless, so clicking "+ Invoice" on a billed job just bounced off the
  // guard with an error. Same owner rule as the quote page: once a step is
  // done, stop offering it — the document list right below is the way in.
  const hasLiveDoc = (t: "quote" | "invoice") => job.documents.some((d) => d.docType === t && d.status !== "void");

  const beforePhotos = job.photos.filter((p) => p.phase === "before");
  const [afterPhotos, setAfterPhotos] = useState<IntakePhoto[]>(() =>
    job.photos.filter((p) => p.phase === "after").map((p) => ({ path: p.url, url: p.url })),
  );
  async function addAfter(p: IntakePhoto) {
    setAfterPhotos((prev) => [...prev, p]); // optimistic
    const r = await addJobPhotoAction({ jobId: job.id, path: p.path, phase: "after" });
    if (!r.ok) { setAfterPhotos((prev) => prev.filter((x) => x !== p)); setError({ at: "photos", msg: r.error }); }
  }

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
      setError({ at: "billing", msg: !r.ok ? r.error : "Could not create the document." });
    }
  }

  // Resync to the server-authoritative elapsed time whenever a fresh job prop
  // arrives (e.g. router.refresh after Pause) — a backgrounded tab's throttled
  // interval otherwise leaves the local count too low until a full reload.
  const [serverSeconds, setServerSeconds] = useState(job.elapsedSeconds);
  if (job.elapsedSeconds !== serverSeconds) {
    setServerSeconds(job.elapsedSeconds);
    setSeconds(job.elapsedSeconds);
  }

  useEffect(() => {
    if (!job.running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [job.running]);

  // ── the schedule + estimate editor ──────────────────────────────────────────
  const [editWhen, setEditWhen] = useState(false);
  const [whenInput, setWhenInput] = useState(() => toLocalInput(job.scheduledAt));
  const [estInput, setEstInput] = useState(job.estimatedMinutes?.toString() ?? "");

  // The ETA slides while a job is paused, so recompute it on every tick rather than
  // freezing it once on render. `seconds` is the tick; the value itself comes from now.
  void seconds;
  const etaMs = estimatedFinish(
    {
      status: job.status,
      startedAt: job.startedAt,
      readyAt: job.readyAt,
      deliveredAt: job.deliveredAt,
      pausedAt: job.pausedAt,
      pausedMs: job.pausedMs,
      scheduledAt: job.scheduledAt,
      estimatedMinutes: job.estimatedMinutes,
    },
    Date.now(),
  );
  const overdue = etaMs != null && Date.now() > etaMs;

  async function saveSchedule() {
    const mins = estInput.trim() === "" ? null : Number(estInput);
    if (mins != null && !Number.isFinite(mins)) return setError({ at: "top", msg: "That estimate isn't a number." });
    await run(() => setJobScheduleAction(job.id, whenInput || null, mins == null ? null : Math.round(mins)));
    setEditWhen(false);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, at: "top" | "bottom" = "top") {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError({ at, msg: r.error ?? "Something went wrong" });
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

  const errNote = (at: "top" | "photos" | "billing" | "bottom") =>
    error?.at === at ? (
      <p className="my-3 rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error.msg}</p>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/jobs" className="text-[13px] font-semibold text-muted hover:text-body">← Jobs board</Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="num text-[11px] font-bold text-link">JOB-{job.id.slice(0, 4).toUpperCase()}</div>
          <h2 className="mt-1 font-display text-[22px] font-extrabold text-ink-strong">{job.vehicle ?? "—"}</h2>
          <div className="num text-[13px] text-muted">{job.plate} · {job.service ?? "—"}</div>
        </div>
        <StatusPill status={job.status} />
      </div>

      {errNote("top")}

      {/* the job's life, in order — only what has actually happened */}
      <div className="mt-5 rounded-[15px] border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Timeline</div>
          {!readOnly && (
            <button
              onClick={() => { setWhenInput(toLocalInput(job.scheduledAt)); setEstInput(job.estimatedMinutes?.toString() ?? ""); setEditWhen((v) => !v); }}
              className="text-[12px] font-semibold text-link hover:underline"
            >
              {editWhen ? "Cancel" : job.scheduledAt || job.estimatedMinutes ? "Edit schedule" : "Add a schedule"}
            </button>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
          <Step label={job.fromQuote ? "Accepted" : "Opened"} value={fmtWhen(job.createdAt)} />
          <Step label="Scheduled for" value={fmtWhen(job.scheduledAt)} />
          <Step label="Started" value={fmtWhen(job.startedAt)} />
          {/* An estimate is only worth showing while it can still be met. */}
          {etaMs != null && (
            <Step
              label="Est. finish"
              value={`${fmtWhen(etaMs)}${job.estimatedMinutes ? ` · ${fmtMins(job.estimatedMinutes)} of work` : ""}`}
              tone={overdue ? "late" : "estimate"}
              note={overdue ? "running late" : job.paused ? "paused — sliding" : undefined}
            />
          )}
          <Step label="Ready" value={fmtWhen(job.readyAt)} />
          <Step label="Delivered" value={fmtWhen(job.deliveredAt)} />
          {/* A dropped car ends here — this is also the clock's end marker. */}
          {job.cancelledAt && <Step label="Cancelled" value={fmtWhen(job.cancelledAt)} tone="late" />}
        </dl>

        {/* The reason is the whole point of demanding one at cancel time; it
            lived only in the audit trail, so the job itself never said why.
            Its own line, not a `note` — that renders uppercase, and this is a
            sentence someone typed. */}
        {job.cancelReason && (
          <div className="mt-3 rounded-[12px] border border-[rgba(214,59,80,0.25)] bg-[rgba(214,59,80,0.05)] px-3.5 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-rose">Cancelled because</div>
            <div className="mt-0.5 text-[13px] text-body">{job.cancelReason}</div>
          </div>
        )}

        {editWhen && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Scheduled for</span>
              <input
                type="datetime-local"
                className={`${field} w-[210px]`}
                value={whenInput}
                onChange={(e) => setWhenInput(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Takes about</span>
              <div className="flex items-center gap-1.5">
                {EST_CHOICES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEstInput(String(m))}
                    className={`h-9 rounded-[9px] px-2.5 text-[12.5px] font-bold ${
                      Number(estInput) === m ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"
                    }`}
                  >
                    {fmtMins(m)}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  placeholder="min"
                  className={`${field} w-[74px]`}
                  value={estInput}
                  onChange={(e) => setEstInput(e.target.value)}
                />
              </div>
            </label>
            <button
              onClick={saveSchedule}
              disabled={busy}
              className="grad-brand shadow-brand h-9 rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-60"
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* timer — the POS clock: Start → (Pause/Resume)* → Complete stops it */}
      <div className="mt-5 flex items-center gap-4 rounded-[15px] border border-line bg-card p-4">
        <div className="flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Time on job</div>
          <div className="mt-1 flex items-center gap-3">
            <div className="num text-[32px] font-extrabold text-ink-strong">{fmt(seconds)}</div>
            {job.paused && (
              <span className="rounded-full bg-[rgba(255,159,26,0.14)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-ink">Paused</span>
            )}
          </div>
        </div>
        {!readOnly && job.status === "scheduled" && (
          <button
            onClick={() => run(() => toggleTimerAction(job.id))}
            disabled={busy}
            className="grad-brand shadow-brand flex h-[52px] items-center gap-2 rounded-[13px] px-5 text-[14px] font-bold text-white"
          >
            <Play size={17} /> Start
          </button>
        )}
        {!readOnly && job.status === "in_progress" && (
          <button
            onClick={() => run(() => toggleJobPauseAction(job.id))}
            disabled={busy}
            className={`flex h-[52px] items-center gap-2 rounded-[13px] px-5 text-[14px] font-bold ${job.paused ? "grad-brand shadow-brand text-white" : "bg-[rgba(255,159,26,0.14)] text-amber-ink"}`}
          >
            {job.paused ? <><Play size={17} /> Resume</> : <><Pause size={17} /> Pause</>}
          </button>
        )}
      </div>

      {/* technician + place of work */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[13px] border border-line bg-card px-4 py-3">
        <span className="text-[13px] font-semibold text-body">Assigned to</span>
        <select
          className={`${field} w-full sm:w-auto sm:max-w-[220px]`}
          value={job.technicianId ?? ""}
          disabled={readOnly}
          onChange={(e) => run(() => assignTechnicianAction(job.id, e.target.value || null))}
        >
          <option value="">— unassigned —</option>
          {refData.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="ml-2 text-[13px] font-semibold text-body">Place of work</span>
        <select
          className={`${field} w-full sm:w-auto sm:max-w-[220px]`}
          value={job.department ?? ""}
          disabled={readOnly}
          onChange={(e) => run(() => setJobDepartmentAction(job.id, e.target.value || null))}
        >
          <option value="">— department —</option>
          {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
        </select>
      </div>

      {/* condition & damage (captured at intake) */}
      <div className="mt-4 rounded-[15px] border border-line bg-card p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Condition &amp; Damage</div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="sm:w-[200px] sm:shrink-0">
            <CarDiagram markers={job.damageMarkers} maxWidth={200} />
            {job.damageMarkers.length > 0 ? (
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {[...new Set(job.damageMarkers.map((m) => m.type))].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                    <span className="size-2.5 rounded-full" style={{ background: markerMeta(t).color }} />
                    {markerMeta(t).label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-center text-[11.5px] text-faint">No damage marked at intake.</p>
            )}
          </div>
          <div className="flex-1 space-y-3">
            {beforePhotos.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Before</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {beforePhotos.map((p) => (
                    <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="aspect-[4/3] overflow-hidden rounded-[10px] border border-line bg-sub">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">After</div>
              <PhotoUploader tenantId={job.tenantId} folder={job.id} photos={afterPhotos} onAdd={addAfter} label="" />
              {errNote("photos")}
            </div>
          </div>
        </div>
      </div>

      {/* billing — quotes & invoices raised from this job */}
      <div className="mt-4 rounded-[15px] border border-line bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
            <FileText size={14} /> Billing
          </span>
          <div className="flex gap-2">
            {!hasLiveDoc("quote") && (
              <button
                onClick={() => createDoc("quote")}
                disabled={docBusy !== null}
                className={btn("subtle", "sm")}
              >
                <Plus size={14} strokeWidth={2.6} /> {docBusy === "quote" ? "Creating…" : "Quote"}
              </button>
            )}
            {!hasLiveDoc("invoice") && (
              <button
                onClick={() => createDoc("invoice")}
                disabled={docBusy !== null}
                className={btn("primary", "sm")}
              >
                <FilePlus2 size={14} strokeWidth={2.4} /> {docBusy === "invoice" ? "Creating…" : "Invoice"}
              </button>
            )}
          </div>
        </div>
        {errNote("billing")}
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
                {/* Take a deposit or part of the bill by transfer. Cash is not offered: it
                    moves a physical drawer, and the server only takes it on an open till. */}
                {d.docType === "invoice" && d.outstandingCents > 0 && !readOnly && (
                  <PartPayment
                    jobId={job.id}
                    invoiceId={d.id}
                    outstandingCents={d.outstandingCents}
                    onDone={() => router.refresh()}
                  />
                )}
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
            <button onClick={addCheck} className={btn("subtle")}>Add</button>
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
            <select className={`${field} min-w-0 flex-1`} value={cProd} onChange={(e) => setCProd(e.target.value)}>
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
            onClick={() => run(() => completeJobAction({ jobId: job.id, consumptions: consume }), "bottom")}
            disabled={busy}
            className="grad-brand shadow-brand mt-4 flex h-12 w-full items-center justify-center rounded-[13px] font-display text-[15px] font-extrabold text-white disabled:opacity-60"
          >
            Complete job &amp; consume stock →
          </button>
          {errNote("bottom")}
        </div>
      )}

      {job.status === "ready" && (
        <>
          <button onClick={() => run(() => setJobStatusAction(job.id, "delivered"), "bottom")} disabled={busy} className={btn("ghost", "lg", "mt-5 w-full text-[14px]")}>
            Mark delivered
          </button>
          {errNote("bottom")}
        </>
      )}

      {/* a booking that won't happen — cancelling resolves the bill in the same stroke:
          a draft goes, an unpaid bill voids, money already taken is refunded by credit note */}
      {(job.status === "scheduled" || job.status === "in_progress") && (
        <div className="mt-5">
          {!cancelOpen ? (
            <button onClick={() => setCancelOpen(true)} className="w-full text-center text-[13px] font-bold text-pink">
              Cancel job…
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-[13px] border border-[rgba(255,84,104,0.35)] bg-card p-3">
              <input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancelling (required)"
                className={field}
              />
              <div className="text-[11.5px] text-muted">
                The bill resolves automatically — a draft is deleted, an unpaid bill is voided, money already taken is refunded by credit note.
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setCancelOpen(false); setCancelReason(""); }} className="h-10 flex-1 rounded-[11px] text-[13px] font-semibold text-muted">Keep job</button>
                <button
                  onClick={() => run(() => cancelJobAction(job.id, cancelReason), "bottom")}
                  disabled={busy || !cancelReason.trim()}
                  className="h-10 flex-[2] rounded-[11px] bg-pink text-[13px] font-bold text-white disabled:opacity-50"
                >
                  Cancel job
                </button>
              </div>
              {errNote("bottom")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
