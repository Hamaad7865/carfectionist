import { z } from "zod";

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
