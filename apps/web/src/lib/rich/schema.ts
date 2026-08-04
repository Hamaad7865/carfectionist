import { z } from "zod";
import type { RichDoc } from "./types";

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

export const richDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    blocks: z.array(block),
  })
  .refine((doc) => JSON.stringify(doc).length <= MAX_RICH_BYTES, {
    message: "That description is too long to store on a line.",
  });

/**
 * Read a `description_richtext` column back into a tree, or null.
 *
 * Fails closed and never throws. The column is written by the tablet as well as
 * the back office, so a row can hold a shape this build does not understand — a
 * newer schemaVersion, or the stringified blob that `->>` would have stored. A
 * line then renders with no description, which is wrong but harmless; throwing
 * here would take out the print page and the emailed PDF together.
 */
export function parseRichDoc(value: unknown): RichDoc | null {
  if (value === null || value === undefined) return null;
  const parsed = richDocSchema.safeParse(value);
  return parsed.success ? (parsed.data as RichDoc) : null;
}
