"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, Archive, CheckCheck, Check, Clock, XCircle, Ban, AlertTriangle } from "lucide-react";
import { sendBatchAction, archiveCampaignAction } from "./actions";
import { WaBubble } from "./WaBubble";
import { renderBodyPreview } from "./render";
import type { CampaignDetail } from "@/lib/supabase/queries/marketing";

const ROW_STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", cls: "text-muted", icon: <Clock size={13} /> },
  sent: { label: "Sent", cls: "text-link", icon: <Check size={13} /> },
  delivered: { label: "Delivered", cls: "text-mint", icon: <CheckCheck size={13} /> },
  read: { label: "Read", cls: "text-mint", icon: <CheckCheck size={13} /> },
  failed: { label: "Failed", cls: "text-rose", icon: <XCircle size={13} /> },
  invalid: { label: "No number", cls: "text-amber-ink", icon: <AlertTriangle size={13} /> },
  skipped: { label: "Opted out", cls: "text-faint", icon: <Ban size={13} /> },
};

export function CampaignProgress({ campaign }: { campaign: CampaignDetail }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = campaign.counts;
  const total = campaign.recipients.length;
  const pending = counts.pending ?? 0;
  const done = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0);
  const failed = counts.failed ?? 0;
  const pct = total > 0 ? Math.round(((done + failed + (counts.invalid ?? 0) + (counts.skipped ?? 0)) / total) * 100) : 0;

  async function runSend() {
    setSending(true);
    setError(null);
    // Drain batches until nothing is pending. Each batch refreshes the table.
    // Restartable: if the tab closes mid-send, reopening and pressing Send again
    // resumes from the remaining pending rows.
    for (let guard = 0; guard < 400; guard++) {
      const r = await sendBatchAction(campaign.id);
      if (!r.ok) { setError(r.error); break; }
      router.refresh();
      if (r.remaining === 0) break;
      await new Promise((res) => setTimeout(res, 400));
    }
    setSending(false);
    router.refresh();
  }

  async function archive() {
    await archiveCampaignAction(campaign.id);
    router.push("/marketing");
  }

  const previewText = renderBodyPreview(campaign.templateBody, campaign.recipients[0] ? ["Anesh", "20%", "Saturday"] : []);
  const canSend = pending > 0 && campaign.status !== "archived";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <Link href="/marketing" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-body"><ArrowLeft size={15} /> Marketing</Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-[22px] font-extrabold text-ink-strong">{campaign.name}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">
            <span className="num">{campaign.templateName}</span><span className="text-faint">·</span><span>{campaign.createdAt}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canSend && (
            <button onClick={runSend} disabled={sending} className="grad-brand shadow-brand inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
              <Send size={15} /> {sending ? "Sending…" : campaign.status === "draft" ? `Send now · ${pending}` : `Resume · ${pending}`}
            </button>
          )}
          {(campaign.status === "done" || campaign.status === "failed") && (
            <button onClick={archive} className="inline-flex h-10 items-center gap-1.5 rounded-[11px] border border-line-2 bg-card px-3.5 text-[13px] font-semibold text-body"><Archive size={15} /> Archive</button>
          )}
        </div>
      </div>

      {error && <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      {/* progress + counts */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Progress</span>
          <span className="num text-[13px] font-bold text-ink">{pct}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-band">
          <div className="h-full rounded-full bg-mint transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Delivered" value={done} tone="text-mint" />
          <Stat label="Pending" value={pending} tone="text-muted" />
          <Stat label="Failed" value={failed} tone="text-rose" />
          <Stat label="Skipped" value={(counts.invalid ?? 0) + (counts.skipped ?? 0)} tone="text-amber-ink" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        {/* recipients */}
        <div className="overflow-hidden rounded-[15px] border border-line bg-card">
          <div className="border-b border-line px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Recipients · {total}</div>
          <div className="max-h-[420px] overflow-y-auto">
            {campaign.recipients.map((r) => {
              const st = ROW_STATUS[r.status] ?? ROW_STATUS.pending;
              return (
                <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{r.name}</div>
                    <div className="num truncate text-[11.5px] text-muted">{r.phone ?? "no number"}{r.error ? ` · ${r.error}` : ""}</div>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold ${st.cls}`}>{st.icon} {st.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* message preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">Message</div>
          <WaBubble text={previewText} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[11px] border border-line bg-sub px-3 py-2.5">
      <div className={`num text-[20px] font-extrabold ${tone}`}>{value}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}
