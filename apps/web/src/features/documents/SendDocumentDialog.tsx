"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle, Mail, Send, Check, Eye, RefreshCw, Clock, Bell, Loader2 } from "lucide-react";
import { deliverDocumentAction, getSendContextAction, type SendContext } from "./actions";
import { btn } from "@/components/ui/button";

// The "Send to customer" sheet, modelled on the owner's Refrens reference: a
// titled WhatsApp/Email sheet with the client's name, the recipient field, the
// studio's reply-to number, an editable message, and Preview / Send. It loads
// its own context from the document id, so it drops onto any row unchanged.
// (No "Connect Now" — the studio's WhatsApp is already connected.)

const NOTE_PRESETS = [
  { label: "Thank you", text: "Thank you for your business." },
  { label: "As discussed", text: "As discussed — please review and let us know if you have any questions." },
  { label: "Reminder", text: "A gentle reminder regarding this document. We remain at your service." },
];

function prettyPhone(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("230") && d.length === 11) return `+230 ${d.slice(3, 7)} ${d.slice(7)}`;
  return e164.startsWith("+") ? e164 : `+${d}`;
}

export function SendDocumentDialog({
  documentId,
  channel,
  onClose,
}: {
  documentId: string;
  channel: "email" | "whatsapp";
  onClose: () => void;
}) {
  const [ctx, setCtx] = useState<SendContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("");
  const [note, setNote] = useState(NOTE_PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | string>(null);
  const [sentScheduled, setSentScheduled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // schedule-for-later + auto-reminders (matches the reference dialog)
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [remindersOn, setRemindersOn] = useState(false);

  // The list row is a <Link> (an <a>); rendering this modal inline makes it a DOM
  // descendant of that anchor, so a re-render (e.g. the token-refresh router.refresh)
  // could activate the row link and navigate away mid-edit. Portal to <body> so the
  // dialog lives outside every row link.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Let the "sent" flourish be seen, then close on its own so the operator isn't
  // left clicking Cancel.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1900);
    return () => clearTimeout(t);
  }, [done, onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getSendContextAction(documentId);
      if (!alive) return;
      if (r.ok) {
        setCtx(r.ctx);
        setTo(channel === "email" ? r.ctx.customerEmail ?? "" : r.ctx.customerPhone ?? "");
      } else {
        setError(r.error);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [documentId, channel]);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await deliverDocumentAction({
      documentId,
      channel,
      to,
      note: note.trim() || undefined,
      scheduleAt: scheduleOn && scheduleAt ? scheduleAt : undefined,
      autoReminders: remindersOn || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const bits = [
      r.scheduled ? "The customer will receive it at the scheduled time" : "The customer will receive the PDF",
      r.reminders > 0 ? `${r.reminders} reminder${r.reminders === 1 ? "" : "s"} set` : "",
    ].filter(Boolean);
    setSentScheduled(!!r.scheduled);
    setDone(bits.join(" · ") + ".");
  }

  const isWa = channel === "whatsapp";
  const kindCap = ctx ? ctx.kind.charAt(0).toUpperCase() + ctx.kind.slice(1) : "Document";
  const title = `${isWa ? "WhatsApp" : "Email"} ${kindCap}`;

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[18px] border border-line bg-card shadow-[0_24px_60px_rgba(6,12,20,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`grid size-9 place-items-center rounded-[10px] ${isWa ? "bg-[rgba(37,211,102,0.12)] text-[#1DA851]" : "bg-brand-wash text-link"}`}>
              {isWa ? <MessageCircle size={18} /> : <Mail size={18} />}
            </span>
            <div>
              <div className="font-display text-[16px] font-extrabold text-ink-strong">{title}</div>
              <div className="text-[12px] text-muted">
                Send {ctx?.number ? <span className="num font-semibold text-body">{ctx.number}</span> : "this document"} from the studio&apos;s
                {isWa ? " WhatsApp" : " email"} account.
              </div>
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body">
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="flex flex-col gap-3.5 px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
              <RefreshCw size={15} className="animate-spin" /> Loading…
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="animate-pop-check grid size-16 place-items-center rounded-full bg-[rgba(13,167,124,0.12)] text-mint">
                {sentScheduled ? <Clock size={30} strokeWidth={2.4} /> : <Check size={34} strokeWidth={3} />}
              </span>
              <div className="font-display text-[17px] font-extrabold text-ink-strong">
                {sentScheduled ? "Scheduled" : isWa ? "Message sent" : "Email sent"}
              </div>
              <p className="max-w-[16rem] text-[12.5px] leading-snug text-muted">{done}</p>
            </div>
          ) : (
            <>
              {/* client name (read-only) */}
              <Field label="Client's name">
                <div className="flex h-10 items-center rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] font-semibold text-body">
                  {ctx?.customerName || "—"}
                </div>
              </Field>

              {/* recipient */}
              <Field label={isWa ? "Client's phone no" : "Client's email"}>
                {isWa ? (
                  <div className="flex items-stretch gap-0 overflow-hidden rounded-[11px] border border-line-2 bg-sub focus-within:border-brand">
                    <span className="flex select-none items-center gap-1 border-r border-line-2 px-3 text-[13px] text-muted">🇲🇺 +230</span>
                    <input
                      className="h-10 flex-1 bg-transparent px-3 text-[13px] text-ink outline-none"
                      value={to}
                      onChange={(e) => { setTo(e.target.value); setDone(null); }}
                      placeholder="5XXX XXXX"
                      inputMode="tel"
                    />
                  </div>
                ) : (
                  <input
                    className="h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setDone(null); }}
                    placeholder="customer@email.com"
                    inputMode="email"
                  />
                )}
              </Field>

              {/* reply-to (read-only, WhatsApp only) */}
              {isWa && ctx?.replyToNumber && (
                <Field label="Reply to phone no">
                  <div className="flex h-10 items-center gap-2 rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-body">
                    <span className="select-none">🇲🇺</span>
                    <span className="num">{prettyPhone(ctx.replyToNumber)}</span>
                    <span className="ml-auto text-[11px] text-faint">replies arrive in Messages</span>
                  </div>
                </Field>
              )}

              {/* message */}
              <Field label="Message">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {NOTE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => { setNote(p.text); setDone(null); }}
                        className={`h-7 rounded-[8px] px-2.5 text-[11.5px] font-semibold ${note === p.text ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => { setNote(e.target.value.slice(0, 300)); setDone(null); }}
                    rows={2}
                    className="w-full resize-none rounded-[11px] border border-line-2 bg-sub px-3 py-2 text-[13px] leading-snug text-ink outline-none focus:border-brand"
                    placeholder="Message to the customer…"
                  />
                </div>
              </Field>

              {/* schedule for later */}
              <div className="flex flex-col gap-2 rounded-[11px] border border-line-2 bg-sub/40 p-1">
                <Toggle icon={<Clock size={15} />} label="Schedule for later" on={scheduleOn} onChange={setScheduleOn} />
                {scheduleOn && (
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    min={minLocal()}
                    onChange={(e) => { setScheduleAt(e.target.value); setDone(null); }}
                    className="mx-1 mb-1 h-10 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] text-ink outline-none focus:border-brand"
                  />
                )}
                {ctx?.kind === "invoice" && (
                  <Toggle icon={<Bell size={15} />} label="Auto reminders" hint="if unpaid, chase 3 & 7 days after due" on={remindersOn} onChange={setRemindersOn} />
                )}
              </div>

              {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
            </>
          )}
        </div>

        {/* footer */}
        {!done && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onClose} className="text-[13px] font-semibold text-muted hover:text-body">
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <a
              href={`/print/doc/${documentId}`}
              target="_blank"
              rel="noreferrer"
              className={btn("ghost", "lg")}
            >
              <Eye size={15} /> Preview
            </a>
            <button
              onClick={send}
              disabled={busy || loading || !to.trim() || (scheduleOn && !scheduleAt)}
              className={btn("primary", "lg", "gap-2")}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : scheduleOn ? <Clock size={15} /> : <Send size={15} />}{" "}
              {busy ? (scheduleOn ? "Scheduling…" : isWa ? "Sending…" : "Emailing…") : scheduleOn ? "Schedule" : "Send"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  icon,
  label,
  hint,
  on,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left hover:bg-sub">
      <span className={`${on ? "text-link" : "text-faint"}`}>{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-body">{label}</span>
        {hint && <span className="block text-[11px] text-faint">{hint}</span>}
      </span>
      <span className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-brand" : "bg-line-2"}`}>
        <span className={`absolute top-[3px] size-4 rounded-full bg-white shadow transition-all ${on ? "left-[19px]" : "left-[3px]"}`} />
      </span>
    </button>
  );
}

/** "now" as a datetime-local min (the browser's local clock = Mauritius time). */
function minLocal(): string {
  const n = new Date(Date.now() + 60_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}`;
}
