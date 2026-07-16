"use client";

import { useRef, useState } from "react";
import { Bold, Italic, Strikethrough, Braces, Smile, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { saveTemplateAction } from "./actions";
import { countVariables, renderBodyPreview } from "./render";
import { WaBubble } from "./WaBubble";
import type { WaTemplateRow } from "@/lib/supabase/queries/marketing";
import { btn } from "@/components/ui/button";

const EMOJI = ["😀", "😍", "🎉", "🚗", "✨", "🔥", "💧", "🧼", "⭐", "👍", "🙏", "📅", "📍", "💬", "🎁", "💯", "🏆", "✅", "❤️", "😎", "🕒", "📞", "🚀", "🤝"];
const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";

// Sample values used to fill {{1}}, {{2}}… in the live bubble preview.
const SAMPLE = ["Anesh", "20%", "Saturday", "Carfectionist", "5 Aug"];

export function TemplateComposer({ template, onDone }: { template: WaTemplateRow | null; onDone: () => void }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState(template?.name ?? "");
  const [language, setLanguage] = useState<"en" | "fr">((template?.language as "en" | "fr") ?? "en");
  const [body, setBody] = useState(template?.body ?? "");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const varCount = countVariables(body);
  const previewText = renderBodyPreview(body, SAMPLE);

  function wrap(token: string) {
    const ta = taRef.current;
    if (!ta) return;
    const [s, e] = [ta.selectionStart, ta.selectionEnd];
    const sel = body.slice(s, e) || "text";
    const next = `${body.slice(0, s)}${token}${sel}${token}${body.slice(e)}`;
    setBody(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + token.length, s + token.length + sel.length); });
  }
  function insertAtCursor(text: string) {
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : body.length;
    setBody(body.slice(0, pos) + text + body.slice(pos));
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(pos + text.length, pos + text.length); } });
  }
  function addVariable() {
    insertAtCursor(`{{${varCount + 1}}}`);
  }

  async function save() {
    setError(null);
    setBusy(true);
    const r = await saveTemplateAction({ id: template?.id, name: name.trim(), language, body });
    setBusy(false);
    if (r.ok) { router.refresh(); onDone(); }
    else setError(r.error);
  }

  const overLimit = body.length > 1024;

  return (
    <div className="rounded-[15px] border border-line bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-display text-[14px] font-bold text-ink-strong">{template ? "Edit template" : "New message template"}</span>
        <button onClick={onDone} className="grid size-8 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body"><X size={15} /></button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* editor */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Template name</span>
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+/, ""))}
                placeholder="july_promo"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Language</span>
              <select className={field} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "fr")}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Message</span>
              <span className={`text-[11px] ${overLimit ? "font-bold text-rose" : "text-faint"}`}>{body.length}/1024</span>
            </div>
            <div className="rounded-[11px] border border-line-2 bg-sub">
              <div className="flex flex-wrap items-center gap-1 border-b border-line px-1.5 py-1.5">
                <ToolBtn onClick={() => wrap("*")} title="Bold"><Bold size={15} /></ToolBtn>
                <ToolBtn onClick={() => wrap("_")} title="Italic"><Italic size={15} /></ToolBtn>
                <ToolBtn onClick={() => wrap("~")} title="Strikethrough"><Strikethrough size={15} /></ToolBtn>
                <span className="mx-1 h-4 w-px bg-line-2" />
                <ToolBtn onClick={addVariable} title="Insert variable"><Braces size={15} /><span className="ml-1 text-[11.5px] font-bold">Variable</span></ToolBtn>
                <div className="relative">
                  <ToolBtn onClick={() => setEmojiOpen((v) => !v)} title="Emoji"><Smile size={15} /></ToolBtn>
                  {emojiOpen && (
                    <div className="absolute left-0 top-9 z-10 grid w-[228px] grid-cols-8 gap-0.5 rounded-[10px] border border-line bg-card p-2 shadow-lg">
                      {EMOJI.map((em) => (
                        <button key={em} onClick={() => { insertAtCursor(em); setEmojiOpen(false); }} className="grid size-6 place-items-center rounded hover:bg-sub">{em}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <textarea
                ref={taRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="Hi {{1}}, this month enjoy {{2}} off any ceramic package at Carfectionist! Book your slot today. 🚗✨"
                className="w-full resize-y bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none"
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">
              {varCount > 0
                ? `${varCount} variable${varCount === 1 ? "" : "s"} — each recipient gets their own value (name, etc.). *bold*, _italic_, ~strike~ format the text.`
                : "Use *bold*, _italic_, ~strike~. Insert a variable to personalise each message (e.g. the customer's name)."}
            </p>
          </div>

          {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy || !name.trim() || !body.trim() || overLimit} className={btn("primary", "lg", "gap-2 px-5")}>
              <Save size={16} /> {busy ? "Saving…" : "Save draft"}
            </button>
            <span className="text-[11.5px] text-faint">Drafts go to WhatsApp for approval before they can be sent.</span>
          </div>
        </div>

        {/* live preview */}
        <div className="lg:sticky lg:top-4">
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">Preview</div>
          <WaBubble text={previewText} />
          <p className="mt-2 text-[11px] text-faint">Sample values shown for variables.</p>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} className="inline-flex h-7 items-center rounded-[7px] px-1.5 text-muted hover:bg-band hover:text-body">
      {children}
    </button>
  );
}
