"use client";

import { useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Italic, Strikethrough, List, ListOrdered, Link2, Table as TableIcon, X } from "lucide-react";
import { fromTipTap, toTipTap } from "@/lib/rich/convert";
import type { RichDoc } from "@/lib/rich/types";

/**
 * The line-description editor.
 *
 * MUST be mounted through next/dynamic({ ssr: false }). DocumentBuilder is already
 * a client component, but Next still server-renders client trees inside the Worker,
 * and the Workers runtime has no DOM — ProseMirror throws on construction there.
 * `immediatelyRender: false` is the second belt: it stops TipTap rendering during
 * the SSR pass even if something does import this eagerly.
 *
 * The extension list is a whitelist, and deliberately short. Every node type
 * enabled here has to be understood by the A4 renderer, the plain-text flattener
 * AND the Kotlin renderer on the tablet, so adding one is a three-platform
 * decision, not a convenience.
 */

const TOOLBAR_BTN =
  "grid size-7 place-items-center rounded-[6px] border border-line-2 bg-card text-body hover:border-brand disabled:opacity-40";
const ACTIVE = "border-brand bg-[rgba(43,140,255,0.14)] text-link";

function Btn({ on, onClick, title, children }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={!!on} onClick={onClick} className={`${TOOLBAR_BTN} ${on ? ACTIVE : ""}`}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  function applyLink() {
    const url = href.trim();
    if (!url) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
    setHref("");
    setLinkOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
      <Btn title="Bold" on={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={13} strokeWidth={2.8} />
      </Btn>
      <Btn title="Italic" on={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={13} strokeWidth={2.8} />
      </Btn>
      <Btn title="Strikethrough" on={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={13} strokeWidth={2.8} />
      </Btn>
      <span className="mx-0.5 h-4 w-px bg-line-2" />
      <Btn title="Bulleted list" on={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} />
      </Btn>
      <Btn title="Numbered list" on={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </Btn>
      <span className="mx-0.5 h-4 w-px bg-line-2" />
      <Btn
        title="Link"
        on={editor.isActive("link") || linkOpen}
        onClick={() => {
          setHref(editor.getAttributes("link").href ?? "");
          setLinkOpen((v) => !v);
        }}
      >
        <Link2 size={14} />
      </Btn>
      <Btn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>
        <TableIcon size={14} />
      </Btn>
      {editor.isActive("table") && (
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteTable().run()}
          className="h-7 rounded-[6px] border border-line-2 bg-card px-2 text-[11px] font-semibold text-body hover:border-rose"
        >
          Remove table
        </button>
      )}
      {linkOpen && (
        <span className="ml-1 inline-flex items-center gap-1">
          <input
            value={href}
            autoFocus
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://…"
            className="h-7 w-52 rounded-[6px] border border-line-2 bg-sub px-2 text-[12px] text-ink outline-none focus:border-brand"
          />
          <button type="button" onClick={applyLink} className="h-7 rounded-[6px] bg-[#e2e8ef] px-2 text-[11.5px] font-bold text-body">
            Apply
          </button>
          <button type="button" title="Cancel" onClick={() => setLinkOpen(false)} className={TOOLBAR_BTN}>
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );
}

export default function RichEditor({
  value,
  onChange,
  onClose,
}: {
  value: RichDoc | null;
  onChange: (doc: RichDoc | null) => void;
  onClose?: () => void;
}) {
  const editor = useEditor({
    // Without this, TipTap renders during the SSR pass and ProseMirror reaches for
    // a DOM the Workers runtime does not have.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Everything the printed document, the tablet and the flattener would each
        // have to learn. Off until someone asks for them.
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          // Belt to the renderer's braces — RichContent also refuses anything else.
          protocols: ["http", "https", "mailto", "tel"],
        },
      }),
      // No column resizing and no cell merging: the A4 renderer draws a flat grid,
      // and the Kotlin one will too.
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: toTipTap(value),
    onUpdate: ({ editor }) => {
      const doc = fromTipTap(editor.getJSON());
      // An editor emptied back to one blank paragraph is not content — send null so
      // both columns clear rather than storing an empty shell.
      onChange(doc.blocks.length > 0 ? doc : null);
    },
    editorProps: {
      attributes: {
        class: "rich-editor-content",
      },
    },
  });

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-[9px] border border-line-2 bg-card">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {onClose && (
        <div className="flex justify-end border-t border-line px-2 py-1">
          <button type="button" onClick={onClose} className="text-[11.5px] font-semibold text-muted hover:text-ink">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
