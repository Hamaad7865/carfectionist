"use client";

import { useEffect, useState } from "react";
import { Mail, MessageCircle, Clock, Bell, X, Loader2, AlertTriangle } from "lucide-react";
import { cancelScheduledSendAction } from "./actions";
import type { ScheduledSendRow } from "@/lib/supabase/queries/scheduled-sends";

// The only place a "Schedule for later" send or an auto-reminder is visible
// after it's been queued: what will go out, to whom, when, and — once the
// cron processor has touched it — whether it actually went. Without this a
// scheduled send vanishes into scheduled_sends with no UI anywhere near it.

const STATUS: Record<ScheduledSendRow["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-[rgba(43,140,255,0.12)] text-link" },
  sending: { label: "Sending…", cls: "bg-[rgba(43,140,255,0.14)] text-link" },
  sent: { label: "Sent", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  failed: { label: "Failed", cls: "bg-[rgba(214,59,80,0.12)] text-rose" },
  skipped: { label: "Skipped — paid", cls: "bg-sub text-faint" },
  cancelled: { label: "Cancelled", cls: "bg-sub text-faint" },
};

/** "Tue 14 Jul, 14:30" — Mauritius time, the only clock the shop runs on. */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "Indian/Mauritius",
});
function fmtWhen(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : WHEN.format(ms);
}

/** Renders one document's queued/reminder sends, with a Cancel control for
 *  anything still pending. Fetch the rows server-side with
 *  `getScheduledSends(documentId)` and pass them in — this component itself
 *  does no fetching, it only renders and cancels. */
export function ScheduledSends({ documentId, sends }: { documentId: string; sends: ScheduledSendRow[] }) {
  const [rows, setRows] = useState(sends);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ id: string; error: string } | null>(null);

  // The parent re-fetches on navigation/revalidation; keep in step with it.
  useEffect(() => setRows(sends), [sends]);

  async function cancel(id: string) {
    setErrorId(null);
    setBusyId(id);
    const res = await cancelScheduledSendAction(id);
    setBusyId(null);
    if (res.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)));
    } else {
      setErrorId({ id, error: res.error });
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-[13px] border border-line bg-card p-4" data-document-id={documentId}>
      <div className="flex items-center gap-2">
        <Clock size={15} className="text-faint" />
        <span className="text-[13px] font-bold text-ink-strong">Scheduled sends</span>
        <span className="text-[12px] text-faint">
          {rows.length} queued send{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-col divide-y divide-line">
        {rows.map((r) => {
          const st = STATUS[r.status] ?? STATUS.pending;
          const isWa = r.channel === "whatsapp";
          return (
            <div key={r.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0.5 last:pb-0.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px] ${isWa ? "bg-[rgba(37,211,102,0.12)] text-[#1DA851]" : "bg-brand-wash text-link"}`}>
                    {isWa ? <MessageCircle size={13} /> : <Mail size={13} />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.kind === "reminder" && <Bell size={11} className="text-faint" />}
                      <span className="text-[13px] font-semibold text-body">
                        {r.kind === "reminder" ? "Auto reminder" : "Scheduled send"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="truncate text-[12px] text-muted">
                      to <span className="num text-body">{r.toAddr}</span> · {fmtWhen(r.scheduledAt)}
                    </div>
                    {r.note && <div className="mt-0.5 truncate text-[11.5px] text-faint">“{r.note}”</div>}
                  </div>
                </div>

                {r.status === "pending" && (
                  <button
                    onClick={() => cancel(r.id)}
                    disabled={busyId === r.id}
                    title="Cancel this scheduled send"
                    className="grid size-7 shrink-0 place-items-center rounded-[8px] border border-line-2 bg-sub text-muted hover:border-rose hover:text-rose disabled:opacity-50"
                  >
                    {busyId === r.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  </button>
                )}
              </div>

              {r.status === "failed" && r.lastError && (
                <div className="ml-[38px] flex items-start gap-1.5 rounded-[9px] bg-[rgba(214,59,80,0.06)] px-2.5 py-1.5 text-[11.5px] text-rose">
                  <AlertTriangle size={12} className="mt-[1.5px] shrink-0" />
                  <span>
                    {r.lastError}
                    {r.attempts > 1 ? ` (${r.attempts} attempts)` : ""}
                  </span>
                </div>
              )}

              {errorId?.id === r.id && (
                <div className="ml-[38px] text-[11.5px] text-rose">{errorId.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
