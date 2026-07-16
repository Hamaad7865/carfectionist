"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Send, Trash2, Clock, CheckCircle2, XCircle, FileText } from "lucide-react";
import { TemplateComposer } from "./TemplateComposer";
import { submitTemplateAction, syncTemplatesAction, deleteTemplateAction } from "./actions";
import { countVariables } from "./render";
import type { WaTemplateRow } from "@/lib/supabase/queries/marketing";
import { btn } from "@/components/ui/button";

const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", cls: "bg-band text-body", icon: <FileText size={12} /> },
  pending: { label: "Pending approval", cls: "bg-[rgba(245,166,35,0.16)] text-amber-ink", icon: <Clock size={12} /> },
  approved: { label: "Approved", cls: "bg-[rgba(13,167,124,0.14)] text-mint", icon: <CheckCircle2 size={12} /> },
  rejected: { label: "Rejected", cls: "bg-[rgba(214,59,80,0.12)] text-rose", icon: <XCircle size={12} /> },
};

export function TemplatesPanel({ templates }: { templates: WaTemplateRow[] }) {
  const router = useRouter();
  const [composing, setComposing] = useState<WaTemplateRow | null | "new">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitFor, setSubmitFor] = useState<WaTemplateRow | null>(null);

  async function sync() {
    setBusy("sync");
    await syncTemplatesAction();
    setBusy(null);
    router.refresh();
  }
  async function del(id: string) {
    setBusy(id);
    await deleteTemplateAction(id);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] text-muted">{templates.length} template{templates.length === 1 ? "" : "s"} · approved templates can be sent as campaigns</div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={sync} disabled={busy === "sync"} className={btn()}>
            <RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} /> Sync approvals
          </button>
          <button onClick={() => setComposing("new")} className={btn("primary")}>
            <Plus size={15} /> New template
          </button>
        </div>
      </div>

      {composing && (
        <TemplateComposer template={composing === "new" ? null : composing} onDone={() => setComposing(null)} />
      )}

      {templates.length === 0 && !composing ? (
        <div className="rounded-[15px] border border-dashed border-line-2 px-5 py-16 text-center text-[13px] text-faint">
          No templates yet. Create one, submit it for WhatsApp approval, then send it as a campaign.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {templates.map((t) => {
            const st = STATUS[t.status];
            const vc = countVariables(t.body);
            return (
              <div key={t.id} className="rounded-[13px] border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[13.5px] font-bold text-ink">{t.name}</span>
                      <span className="rounded-[6px] bg-sub px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-faint">{t.language}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.icon} {st.label}</span>
                      {vc > 0 && <span className="text-[11px] text-faint">{vc} variable{vc === 1 ? "" : "s"}</span>}
                    </div>
                    <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[12.5px] leading-snug text-muted">{t.body}</p>
                    {t.status === "rejected" && t.rejectReason && (
                      <p className="mt-1 text-[11.5px] text-rose">Rejected: {t.rejectReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(t.status === "draft" || t.status === "rejected") && (
                      <>
                        <button onClick={() => setSubmitFor(t)} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-brand bg-[rgba(43,140,255,0.08)] px-2.5 text-[12px] font-bold text-link">
                          <Send size={13} /> Submit
                        </button>
                        <button onClick={() => setComposing(t)} className="h-8 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12px] font-semibold text-body">Edit</button>
                        <button onClick={() => del(t.id)} disabled={busy === t.id} className="grid size-8 place-items-center rounded-[9px] text-faint hover:text-rose"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {submitFor && <SubmitDialog template={submitFor} onClose={() => setSubmitFor(null)} onDone={() => { setSubmitFor(null); router.refresh(); }} />}
    </div>
  );
}

// WhatsApp requires an example value per variable so their reviewers see
// representative text. We collect them just before submitting.
function SubmitDialog({ template, onClose, onDone }: { template: WaTemplateRow; onClose: () => void; onDone: () => void }) {
  const vc = countVariables(template.body);
  const [examples, setExamples] = useState<string[]>(Array(vc).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await submitTemplateAction({ id: template.id, examples });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[16px] border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-[15px] font-bold text-ink-strong">Submit for WhatsApp approval</div>
        <p className="mt-1 text-[12.5px] text-muted">WhatsApp reviews marketing templates (usually minutes to a few hours). {vc > 0 && "Give an example for each variable so reviewers see how it reads."}</p>
        {vc > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {examples.map((ex, i) => (
              <label key={i} className="flex items-center gap-2">
                <span className="num w-9 text-[12px] font-bold text-faint">{`{{${i + 1}}}`}</span>
                <input value={ex} onChange={(e) => setExamples((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} placeholder={i === 0 ? "Anesh" : "example"} className="h-9 flex-1 rounded-[10px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand" />
              </label>
            ))}
          </div>
        )}
        {error && <p className="mt-3 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-[11px] border border-line-2 bg-sub px-4 text-[13px] font-semibold text-body">Cancel</button>
          <button onClick={submit} disabled={busy} className={btn("primary", "lg", "gap-2")}>
            <Send size={14} /> {busy ? "Submitting…" : "Submit to WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}
