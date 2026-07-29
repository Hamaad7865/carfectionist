"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Ban, Check, Plus, ShieldCheck, X } from "lucide-react";
import type { CertificatesData } from "@/lib/supabase/queries/certificates";
import { createCertificateAction, voidCertificateAction } from "./actions";
import { CertificateCard } from "./CertificateCard";
import { btn, btnBase } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const WARRANTIES = [12, 24, 36, 60];

export function CertificatesPanel({ data, today }: { data: CertificatesData; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(data.certificates[0]?.id ?? null);

  const selected = useMemo(() => data.certificates.find((c) => c.id === selectedId) ?? null, [selectedId, data.certificates]);

  // Only delivered jobs with a fully paid invoice are offered — the create
  // action re-checks this server-side, but there's no point showing a choice
  // that would only be refused on submit.
  const [jobId, setJobId] = useState(data.jobs[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [months, setMonths] = useState(36);
  const [appliedAt, setAppliedAt] = useState(today);
  const [notes, setNotes] = useState("");

  async function create() {
    setError(null);
    if (!jobId) return setError("Pick a completed, paid job to certify.");
    setBusy(true);
    const r = await createCertificateAction({
      jobId,
      productId: productId || null,
      warrantyMonths: months,
      appliedAt,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (r.ok) { setNotes(""); setShowForm(false); router.refresh(); }
    else setError(r.error);
  }

  // Revoke (void) the selected certificate — owner/manager only; the action
  // enforces that server-side too, this just keeps the confirm+reason flow
  // next to the certificate it acts on.
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  async function confirmVoid() {
    if (!selected) return;
    setVoidError(null);
    setVoidBusy(true);
    const r = await voidCertificateAction(selected.id, voidReason);
    setVoidBusy(false);
    if (r.ok) { setVoidOpen(false); router.refresh(); }
    else setVoidError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Certificates</span>
          <span className="text-[12.5px] text-faint">· {data.certificates.length}</span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className={btn()}
        >
          {showForm ? <X size={15} /> : <Plus size={15} />} {showForm ? "Cancel" : "Issue certificate"}
        </button>
      </div>

      {/* issue form (toggle) */}
      {showForm && (
        <div className="rounded-[15px] border border-line bg-card p-5">
          <p className="mb-4 text-[12.5px] text-muted">Next number <span className="num font-bold text-body">{data.nextNumber}</span></p>
          {data.jobs.length === 0 ? (
            <p className="rounded-[10px] border border-line-2 bg-sub px-3 py-2.5 text-[12.5px] text-muted">
              No completed job with a fully paid invoice is available to certify yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Job (delivered · invoice paid)</span>
                <select className={field} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  {data.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.customerName} · {j.vehicle}{j.plate ? ` (${j.plate})` : ""}{j.invoiceNumber ? ` — ${j.invoiceNumber}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Treatment (optional)</span>
                <select className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">—</option>
                  {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Warranty</span>
                <select className={field} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {WARRANTIES.map((m) => <option key={m} value={m}>{m} months</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Applied</span>
                <input type="date" className={field} value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Notes (optional)</span>
                <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Batch, applicator…" />
              </label>
            </div>
          )}
          {error && <p className="mt-3 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
          <button onClick={create} disabled={busy || data.jobs.length === 0} className={btn("primary", "lg", "mt-4 gap-2 px-5")}>
            <BadgeCheck size={17} /> {busy ? "Issuing…" : "Issue certificate"}
          </button>
        </div>
      )}

      {/* list + detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,44%)_1fr]">
        {/* list */}
        <div className="overflow-hidden rounded-[15px] border border-line bg-card">
          {data.certificates.length === 0 ? (
            <div className="px-5 py-16 text-center text-[13px] text-faint">No certificates issued yet.</div>
          ) : (
            data.certificates.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors ${active ? "bg-band" : "hover:bg-sub"}`}
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-white ${c.voidedAt ? "opacity-60" : ""}`}
                    style={{ background: c.voidedAt ? "#B0392E" : c.expired ? "#8494A3" : "linear-gradient(135deg,#0FBFA6,#3E8BFF)" }}
                  >
                    {c.voidedAt ? <Ban size={16} strokeWidth={3} /> : <Check size={17} strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13.5px] font-semibold ${c.voidedAt ? "text-faint line-through" : "text-ink"}`}>{c.vehicle}</div>
                    <div className="truncate text-[12px] text-muted">
                      <span className="num">{c.number}</span> · {c.customerName}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {c.plate && <div className="num inline-block rounded-[5px] bg-[#F0C542] px-1.5 py-0.5 text-[11px] font-bold text-[#151208]">{c.plate}</div>}
                    <div className={`mt-1 text-[11px] font-semibold ${c.voidedAt ? "text-rose" : c.expired ? "text-rose" : "text-muted"}`}>
                      {c.voidedAt ? "revoked" : c.expired ? "expired" : "to"} {c.voidedAt ? "" : c.expiresAt}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* detail */}
        <div>
          {selected ? (
            <>
              <div className="mb-2.5 flex items-center justify-end gap-2">
                {selected.voidedAt ? (
                  <span className="rounded-[8px] border border-[rgba(214,59,80,0.35)] bg-[rgba(214,59,80,0.08)] px-3 py-1.5 text-[12px] font-bold text-rose">
                    Revoked{selected.voidReason ? ` — ${selected.voidReason}` : ""}
                  </span>
                ) : (
                  <button
                    onClick={() => { setVoidReason(""); setVoidError(null); setVoidOpen(true); }}
                    className={btn("danger", "sm", "border-[rgba(214,59,80,0.35)] text-rose hover:bg-[rgba(214,59,80,0.06)]")}
                  >
                    <Ban size={14} /> Revoke
                  </button>
                )}
                {selected.jobId && (
                  <Link href={`/jobs/${selected.jobId}`} className={btn("ghost", "sm")}>
                    View job & flow →
                  </Link>
                )}
              </div>
              <CertificateCard cert={selected} studioName={data.studioName} />
            </>
          ) : (
            <div className="grid h-full min-h-[300px] place-items-center rounded-[15px] border border-dashed border-line-2 text-[13px] text-faint">
              Select a certificate to view it.
            </div>
          )}
        </div>
      </div>

      {selected && (
        <Modal
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
          title={`Revoke ${selected.number}?`}
          subtitle="The certificate stays on record, marked revoked. This can't be undone."
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setVoidOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
              <button onClick={confirmVoid} disabled={voidBusy} className={btnBase("lg", "bg-rose px-5 font-bold text-white")}>
                {voidBusy ? "Revoking…" : "Revoke certificate"}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <FormError error={voidError} />
            <Field label="Reason" hint="Shown in the audit trail.">
              <input className={inputCls} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Invoice was credited" autoFocus />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
