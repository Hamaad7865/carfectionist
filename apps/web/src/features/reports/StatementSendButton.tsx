"use client";

import { useState } from "react";
import { sendStatementEmailAction } from "./statement-actions";

/**
 * Email a customer their statement of account. Opens a tiny inline form prefilled with
 * the customer's saved address; the send goes through the same PDF+email pipeline as an
 * invoice. Nothing leaves the shop until the button is pressed.
 */
export function StatementSendButton({
  customerId,
  customerName,
  email,
}: {
  customerId: string;
  customerName: string;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    const r = await sendStatementEmailAction(customerId, to);
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
      <button onClick={() => setOpen(true)} className="text-[12px] font-semibold text-link hover:underline">
        Email
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="email"
        autoFocus
        placeholder={`${customerName}'s email`}
        className="h-8 w-[180px] rounded-[9px] border border-line-2 bg-card px-2.5 text-[12px] text-ink outline-none focus:border-brand"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && to.trim()) send(); }}
      />
      <button
        onClick={send}
        disabled={busy || !to.trim()}
        className="grad-brand h-8 rounded-[9px] px-3 text-[12px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "…" : "Send"}
      </button>
      <button onClick={() => { setOpen(false); setMsg(null); }} className="text-[12px] font-semibold text-muted">✕</button>
      {msg && <span className={`text-[11.5px] font-semibold ${msg.ok ? "text-mint" : "text-rose"}`}>{msg.text}</span>}
    </span>
  );
}
