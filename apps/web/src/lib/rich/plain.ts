import type { Block, RichDoc, Runs } from "./types";

/**
 * Flatten rich content to plain text.
 *
 * This is what lands in `document_lines.description`, the flat-text mirror every
 * renderer that predates rich content still reads, and what any future plain-text
 * consumer (a WhatsApp caption, a CSV cell) should use rather than learning the tree.
 */

const runsText = (runs: Runs | undefined): string => (runs ?? []).map((r) => r?.text ?? "").join("");

/** Returns null for a block this build does not understand, so the caller can drop it. */
function blockText(block: Block): string | null {
  switch (block?.type) {
    case "p":
      return runsText(block.runs);
    case "ul":
      return (block.items ?? []).map((item) => `- ${runsText(item)}`).join("\n");
    case "ol":
      return (block.items ?? []).map((item, i) => `${i + 1}. ${runsText(item)}`).join("\n");
    case "table":
      return (block.rows ?? []).map((row) => (row ?? []).map(runsText).join(" | ")).join("\n");
    default:
      return null;
  }
}

export function richToPlainText(doc: RichDoc | null | undefined): string {
  return (doc?.blocks ?? [])
    .map(blockText)
    .filter((text): text is string => text !== null)
    .join("\n");
}
