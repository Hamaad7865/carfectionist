"use client";

import { useState } from "react";
import { sendZReportEmailAction } from "./z-report-actions";

/** Email a closed Z-report as a PDF. Same inline pattern as StatementSendButton. */
export function ZReportSendButton({ zId, number }: { zId: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    const r = await sendZReportEmailAction(zId, to);
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: "Sent" });
      setTimeout(() => setOpen(false), 1200);
    } else {
      setMsg({ ok: false, text: r.error });
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[13px] font-semibold text-link hover:underline">
        Email
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="email"
        autoFocus
        placeholder={`${number} to…`}
        className="h-8 w-[180px] rounded-[9px] border border-line-2 bg-card px-2.5 text-[13px] font-medium text-ink outline-none focus:border-brand"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && to.trim()) send(); }}
      />
      <button
        onClick={send}
        disabled={busy || !to.trim()}
        className="grad-brand h-8 rounded-[9px] px-3 text-[13px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "…" : "Send"}
      </button>
      <button onClick={() => { setOpen(false); setMsg(null); }} className="text-[13px] font-semibold text-muted">✕</button>
      {msg && <span className={`text-[12.5px] font-semibold ${msg.ok ? "text-mint" : "text-rose"}`}>{msg.text}</span>}
    </span>
  );
}
