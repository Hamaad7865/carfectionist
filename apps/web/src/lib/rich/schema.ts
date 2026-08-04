import { z } from "zod";
import type { Block, RichDoc, Run } from "./types";

/**
 * Runtime validation for rich line content.
 *
 * The tree crosses two trust boundaries — a browser posting a draft, and rows read
 * back from a database another platform also writes to — so the shape is checked
 * rather than asserted. Anything outside this schema is refused at the seam instead
 * of being discovered by a renderer later.
 */

const run = z.object({
  text: z.string(),
  bold: z.literal(true).optional(),
  italic: z.literal(true).optional(),
  strike: z.literal(true).optional(),
  href: z.string().optional(),
});

const runs = z.array(run);

const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("p"), runs }),
  z.object({ type: z.literal("ul"), items: z.array(runs) }),
  z.object({ type: z.literal("ol"), items: z.array(runs) }),
  z.object({ type: z.literal("table"), rows: z.array(z.array(runs)) }),
]);

/** Mirrors the document_lines_richtext_size CHECK, so the refusal happens here first. */
export const MAX_RICH_BYTES = 20000;

/**
 * BYTES, not JS string length. The CHECK is octet_length(...::text), and a
 * description in accented French — routine here — weighs more in UTF-8 than its
 * `.length` suggests. Measuring the wrong thing let the client accept a document
 * Postgres would then refuse, with no sentence anyone could read.
 */
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export const richDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    blocks: z.array(block),
  })
  .refine((doc) => utf8Bytes(JSON.stringify(doc)) <= MAX_RICH_BYTES, {
    message: "That description is too long to store on a line.",
  });

/**
 * Read a `description_richtext` column back into a tree, or null.
 *
 * Deliberately NOT richDocSchema.safeParse. Zod is all-or-nothing: one malformed
 * run anywhere failed the entire document, so a row the tablet rendered almost
 * completely printed with no description at all — the same line saying two
 * different things on paper and on the screen beside it.
 *
 * This mirrors RichDoc.kt node for node instead: drop what cannot be read, keep
 * what can. Reading is lenient; WRITING stays strict — richDocSchema still guards
 * the save path, where the input is our own editor and sloppiness is a bug.
 *
 * Two things are still refused outright, and Kotlin refuses them too: a root that
 * is not an object (the stringified blob `->>` would have left), and a
 * schemaVersion we do not know — there, we cannot trust the shape at all.
 *
 * Never throws. This feeds the live print page and the emailed PDF from one
 * component; an exception would take out both.
 */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asRuns = (value: unknown): Run[] =>
  (Array.isArray(value) ? value : []).flatMap((r) => {
    if (!isObj(r) || typeof r.text !== "string") return [];
    const run: Run = { text: r.text };
    if (r.bold === true) run.bold = true;
    if (r.italic === true) run.italic = true;
    if (r.strike === true) run.strike = true;
    if (typeof r.href === "string") run.href = r.href;
    return [run];
  });

const asItems = (value: unknown): Run[][] => (Array.isArray(value) ? value.map(asRuns) : []);

function asBlock(node: unknown): Block | null {
  if (!isObj(node)) return null;
  switch (node.type) {
    case "p":
      return { type: "p", runs: asRuns(node.runs) };
    case "ul":
      return { type: "ul", items: asItems(node.items) };
    case "ol":
      return { type: "ol", items: asItems(node.items) };
    case "table":
      return {
        type: "table",
        rows: (Array.isArray(node.rows) ? node.rows : []).map((row) => asItems(row)),
      };
    default:
      return null;
  }
}

export function parseRichDoc(value: unknown): RichDoc | null {
  if (!isObj(value)) return null;
  if (value.schemaVersion !== 1) return null;
  const blocks = (Array.isArray(value.blocks) ? value.blocks : [])
    .map(asBlock)
    .filter((b): b is Block => b !== null);
  return { schemaVersion: 1, blocks };
}
