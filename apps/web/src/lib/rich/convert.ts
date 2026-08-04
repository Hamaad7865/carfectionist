import type { Block, RichDoc, Run, Runs } from "./types";

/**
 * Between TipTap's document and ours.
 *
 * TipTap speaks ProseMirror: doc → paragraph → text, with formatting in a `marks`
 * array and list items wrapped in their own paragraph. Ours is flat, because the
 * same tree has to be walked by a Kotlin renderer on the tablet and by the
 * plain-text flattener, and neither should have to unwrap three levels to find a
 * word. This module is the only place that knows both shapes.
 *
 * Reading is forgiving — anything unrecognised is dropped rather than rejected,
 * so enabling a TipTap extension by accident cannot write a node the rest of the
 * system has never heard of. Writing is exact.
 */

/** What we may be handed. Everything optional — this is untrusted input. */
interface TipTapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: TipTapNode[];
}

/** What we produce. `type` is always set, which is what TipTap's JSONContent demands. */
export interface TipTapJson {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TipTapJson[];
}

// ── TipTap → ours ───────────────────────────────────────────────────────────

function readRuns(nodes: TipTapNode[] | undefined): Runs {
  const runs: Run[] = [];
  for (const n of nodes ?? []) {
    if (n?.type !== "text" || typeof n.text !== "string" || n.text === "") continue;
    const run: Run = { text: n.text };
    for (const mark of n.marks ?? []) {
      if (mark?.type === "bold") run.bold = true;
      else if (mark?.type === "italic") run.italic = true;
      else if (mark?.type === "strike") run.strike = true;
      else if (mark?.type === "link" && typeof mark.attrs?.href === "string") run.href = mark.attrs.href;
    }
    runs.push(run);
  }
  return runs;
}

/** A list item and a table cell both wrap their text in a paragraph. Unwrap it. */
const readWrapped = (node: TipTapNode | undefined): Runs =>
  (node?.content ?? []).flatMap((child) => (child?.type === "paragraph" ? readRuns(child.content) : []));

const readItems = (node: TipTapNode): Runs[] =>
  (node.content ?? []).filter((i) => i?.type === "listItem").map(readWrapped);

function readBlock(node: TipTapNode): Block | null {
  switch (node?.type) {
    case "paragraph": {
      const runs = readRuns(node.content);
      // An untouched editor holds one empty paragraph. That is not content.
      return runs.length > 0 ? { type: "p", runs } : null;
    }
    case "bulletList":
      return { type: "ul", items: readItems(node) };
    case "orderedList":
      return { type: "ol", items: readItems(node) };
    case "table":
      return {
        type: "table",
        rows: (node.content ?? [])
          .filter((r) => r?.type === "tableRow")
          .map((r) =>
            (r.content ?? [])
              // A header cell is just a cell — we do not model a header row.
              .filter((c) => c?.type === "tableCell" || c?.type === "tableHeader")
              .map(readWrapped),
          ),
      };
    default:
      return null;
  }
}

export function fromTipTap(json: unknown): RichDoc {
  const doc = (json ?? {}) as TipTapNode;
  const blocks = (doc.content ?? [])
    .map(readBlock)
    .filter((b): b is Block => b !== null);
  return { schemaVersion: 1, blocks };
}

// ── Ours → TipTap ───────────────────────────────────────────────────────────

function writeRuns(runs: Runs | undefined): TipTapJson[] {
  return (runs ?? [])
    .filter((r) => r?.text)
    .map((r) => {
      const marks: TipTapJson["marks"] = [];
      if (r.bold) marks.push({ type: "bold" });
      if (r.italic) marks.push({ type: "italic" });
      if (r.strike) marks.push({ type: "strike" });
      if (r.href) marks.push({ type: "link", attrs: { href: r.href } });
      return marks.length > 0 ? { type: "text", text: r.text, marks } : { type: "text", text: r.text };
    });
}

const wrap = (type: string, runs: Runs): TipTapJson => ({
  type,
  content: [{ type: "paragraph", content: writeRuns(runs) }],
});

function writeBlock(block: Block): TipTapJson | null {
  switch (block?.type) {
    case "p":
      return { type: "paragraph", content: writeRuns(block.runs) };
    case "ul":
      return { type: "bulletList", content: (block.items ?? []).map((i) => wrap("listItem", i)) };
    case "ol":
      return { type: "orderedList", content: (block.items ?? []).map((i) => wrap("listItem", i)) };
    case "table":
      return {
        type: "table",
        content: (block.rows ?? []).map((row) => ({
          type: "tableRow",
          content: (row ?? []).map((cell) => wrap("tableCell", cell)),
        })),
      };
    default:
      return null;
  }
}

export function toTipTap(doc: RichDoc | null | undefined): TipTapJson {
  const content = (doc?.blocks ?? [])
    .map(writeBlock)
    .filter((n): n is TipTapJson => n !== null);
  // TipTap will not mount a doc with no content.
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
