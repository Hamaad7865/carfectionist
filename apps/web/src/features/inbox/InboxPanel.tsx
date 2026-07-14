"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, Check, CheckCheck, Clock, AlertTriangle, Archive, MessageCircle, Car, Briefcase, Search } from "lucide-react";
import type { ConversationRow, ThreadDetail } from "@/lib/supabase/queries/inbox";
import type { WaTemplateRow } from "@/lib/supabase/queries/marketing";
import { sendReplyAction, sendTemplateReplyAction, markThreadReadAction, archiveThreadAction } from "./actions";

// The studio's WhatsApp conversations. New messages arrive by webhook, so the
// page polls while open (a websocket would be nicer; polling is bulletproof).

const POLL_MS = 6000;

export function InboxPanel({
  conversations,
  thread,
  templates,
  connected,
}: {
  conversations: ConversationRow[];
  thread: ThreadDetail | null;
  templates: WaTemplateRow[];
  connected: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Live-ish: refresh the server components on a timer while the tab is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [router]);

  // Opening a thread clears its unread badge.
  useEffect(() => {
    if (thread && conversations.find((c) => c.id === thread.id)?.unread) void markThreadReadAction(thread.id);
  }, [thread, conversations]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length, thread?.id]);

  const filtered = conversations.filter((c) => {
    const s = q.trim().toLowerCase();
    return !s || c.name.toLowerCase().includes(s) || c.phoneRaw.includes(s);
  });

  async function send() {
    if (!thread || !body.trim()) return;
    setBusy(true);
    setError(null);
    const r = await sendReplyAction({ conversationId: thread.id, body: body.trim() });
    setBusy(false);
    if (r.ok) { setBody(""); router.refresh(); }
    else setError(r.error);
  }

  async function sendTpl(templateId: string) {
    if (!thread) return;
    setBusy(true);
    setError(null);
    const r = await sendTemplateReplyAction({ conversationId: thread.id, templateId });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  const approved = templates.filter((t) => t.status === "approved");

  return (
    <div className="grid h-[calc(100vh-190px)] min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ── conversations ── */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="border-b border-line p-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or number"
              className="h-9 w-full rounded-[9px] border border-line-2 bg-sub pl-8 pr-2.5 text-[12.5px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-16 text-center text-[12.5px] text-faint">
              {conversations.length === 0 ? "No conversations yet — they appear here when a customer messages your WhatsApp number." : "No match."}
            </div>
          ) : (
            filtered.map((c) => {
              const active = thread?.id === c.id;
              return (
                <Link
                  key={c.id}
                  href={`/messages?c=${c.id}`}
                  className={`flex items-start gap-2.5 border-b border-line px-3.5 py-3 transition-colors ${active ? "bg-band" : "hover:bg-sub"}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(37,211,102,0.14)] text-[12px] font-bold text-mint">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-bold text-ink">{c.name}</span>
                      {c.unread > 0 && (
                        <span className="num grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-mint px-1 text-[10.5px] font-bold text-white">{c.unread}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">{c.lastPreview}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                      {c.lastAt}
                      {c.windowOpen ? (
                        <span className="font-semibold text-mint">· open {Math.floor((c.minutesLeft ?? 0) / 60)}h</span>
                      ) : (
                        <span className="text-faint">· window closed</span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* ── thread ── */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[15px] border border-line bg-card">
        {!thread ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <MessageCircle size={26} className="mx-auto text-faint" />
              <p className="mt-2 text-[13px] text-faint">Pick a conversation to read and reply.</p>
            </div>
          </div>
        ) : (
          <>
            {/* header: who + their car + live job */}
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-bold text-ink">{thread.name}</span>
                  <span className="num text-[12px] text-muted">{thread.phone}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
                  {thread.customerId ? (
                    <Link href={`/contacts?c=${thread.customerId}`} className="font-semibold text-link hover:underline">Customer card →</Link>
                  ) : (
                    <span className="text-amber-ink">Not in contacts</span>
                  )}
                  {thread.vehicles.map((v) => (
                    <span key={v} className="inline-flex items-center gap-1"><Car size={11} /> {v}</span>
                  ))}
                  {thread.openJobId && (
                    <Link href={`/jobs/${thread.openJobId}`} className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                      <Briefcase size={11} /> Open job →
                    </Link>
                  )}
                </div>
              </div>
              <button
                onClick={async () => { await archiveThreadAction(thread.id); router.push("/messages"); }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12px] font-semibold text-muted hover:text-body"
              >
                <Archive size={13} /> Archive
              </button>
            </div>

            {/* messages */}
            <div
              className="min-h-0 flex-1 overflow-y-auto p-4"
              style={{ background: "#e5ddd5", backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 0)", backgroundSize: "14px 14px" }}
            >
              <div className="flex flex-col gap-2">
                {thread.messages.map((m) => {
                  const out = m.direction === "out";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-[9px] px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] ${out ? "rounded-tr-[2px] bg-[#dcf8c6]" : "rounded-tl-[2px] bg-white"}`}
                      >
                        {m.mediaUrl && (m.mediaMime ?? "").startsWith("image/") && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
                            <img src={m.mediaUrl} alt="" className="mb-1 max-h-[260px] rounded-[6px] object-cover" />
                          </a>
                        )}
                        {m.mediaUrl && !(m.mediaMime ?? "").startsWith("image/") && (
                          <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1.5 rounded-[6px] bg-black/5 px-2 py-1.5 text-[12.5px] font-semibold text-[#075e54]">
                            📄 {m.mediaName ?? "Attachment"}
                          </a>
                        )}
                        {m.body && <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.35] text-[#111b21]">{m.body}</div>}
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {m.refType === "document" && <span className="mr-1 rounded bg-black/5 px-1 text-[9.5px] font-bold uppercase text-[#667781]">Document</span>}
                          {out && m.byName && <span className="mr-1 text-[9.5px] text-[#667781]">{m.byName}</span>}
                          <span className="text-[10.5px] text-[#667781]">{m.at.slice(-5)}</span>
                          {out && (
                            m.status === "failed" ? <AlertTriangle size={12} className="text-rose" />
                            : m.status === "read" ? <CheckCheck size={13} className="text-[#53bdeb]" />
                            : m.status === "delivered" ? <CheckCheck size={13} className="text-[#667781]" />
                            : m.status === "sent" ? <Check size={13} className="text-[#667781]" />
                            : <Clock size={11} className="text-[#667781]" />
                          )}
                        </div>
                        {m.error && <div className="mt-0.5 text-[10.5px] font-semibold text-rose">{m.error}</div>}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            </div>

            {/* composer — the 24h rule decides what's allowed */}
            <div className="border-t border-line p-3">
              {error && <p className="mb-2 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

              {!connected ? (
                <p className="rounded-[9px] bg-[rgba(245,166,35,0.1)] px-3 py-2 text-[12.5px] text-amber-ink">Connect WhatsApp to reply.</p>
              ) : thread.windowOpen ? (
                <>
                  <div className="flex items-end gap-2">
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                      rows={1}
                      placeholder="Type a reply…  (Enter to send)"
                      className="max-h-28 min-h-[42px] flex-1 resize-y rounded-[11px] border border-line-2 bg-sub px-3 py-2.5 text-[13.5px] leading-snug text-ink outline-none focus:border-brand"
                    />
                    <button
                      onClick={send}
                      disabled={busy || !body.trim()}
                      className="grid size-[42px] shrink-0 place-items-center rounded-full bg-[#25D366] text-[#06231A] disabled:opacity-50"
                    >
                      <Send size={17} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-faint">
                    Reply window open — {Math.floor((thread.minutesLeft ?? 0) / 60)}h {(thread.minutesLeft ?? 0) % 60}m left to answer freely.
                  </p>
                </>
              ) : (
                <div className="rounded-[11px] border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.07)] p-3">
                  <p className="text-[12.5px] font-semibold text-amber-ink">
                    The 24-hour reply window has closed.
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    WhatsApp only allows a free reply within 24 hours of the customer&apos;s last message. Send an approved template to re-open the conversation — once they answer, you can type freely again.
                  </p>
                  {approved.length === 0 ? (
                    <Link href="/marketing?tab=templates" className="mt-2 inline-block text-[12px] font-bold text-link hover:underline">Create a template →</Link>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {approved.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => sendTpl(t.id)}
                          disabled={busy}
                          title={t.body}
                          className="num h-8 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12px] font-bold text-body hover:border-brand disabled:opacity-50"
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
