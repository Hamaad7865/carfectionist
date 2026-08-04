import type { CSSProperties, ReactNode } from "react";
import type { Block, RichDoc, Run, Runs } from "./types";

/**
 * Renders rich line content as React elements.
 *
 * ONE renderer, three call sites — DocumentA4 (print page, preview iframe, server
 * PDF), the Sales detail screen, and the builder's own editor preview. Written
 * once because the moment it is written twice the printed document and the screen
 * start disagreeing about the same line.
 *
 * Two rules it must never break:
 *   1. Only the elements below are ever emitted. `dangerouslySetInnerHTML` appears
 *      nowhere — text is always a React child, so React escapes it.
 *   2. It fails closed. An unknown node is skipped, never thrown on: DocumentA4 is
 *      shared by the live print page and the emailed PDF, so one malformed row
 *      would otherwise break both at once.
 *
 * Styles are inline on purpose. DocumentA4 carries no Tailwind and the PDF is
 * rendered from a bare HTML string with no stylesheet, so a class name would
 * simply not arrive.
 */

/** Only these schemes survive. Anything else keeps its text and loses its link. */
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

const s = {
  list: { margin: "2px 0 0", paddingLeft: "14px" } as CSSProperties,
  item: { marginBottom: "1px" } as CSSProperties,
  table: { borderCollapse: "collapse", margin: "3px 0 0", width: "100%" } as CSSProperties,
  cell: { border: "1px solid currentColor", padding: "1px 5px", verticalAlign: "top" } as CSSProperties,
  para: { margin: 0 } as CSSProperties,
};

function renderRun(run: Run, key: number): ReactNode {
  if (!run || typeof run.text !== "string") return null;

  let node: ReactNode = run.text;
  if (run.bold) node = <strong>{node}</strong>;
  if (run.italic) node = <em>{node}</em>;
  if (run.strike) node = <s>{node}</s>;

  if (run.href && SAFE_SCHEME.test(run.href)) {
    node = (
      <a href={run.href} style={{ color: "inherit" }}>
        {node}
      </a>
    );
  }

  return <span key={key}>{node}</span>;
}

const renderRuns = (runs: Runs | undefined): ReactNode[] => (runs ?? []).map(renderRun);

/** Returns null for a block this build does not understand. */
function renderBlock(block: Block, key: number): ReactNode {
  switch (block?.type) {
    case "p":
      return (
        <p key={key} style={s.para}>
          {renderRuns(block.runs)}
        </p>
      );
    case "ul":
      return (
        <ul key={key} style={s.list}>
          {(block.items ?? []).map((item, i) => (
            <li key={i} style={s.item}>
              {renderRuns(item)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} style={s.list}>
          {(block.items ?? []).map((item, i) => (
            <li key={i} style={s.item}>
              {renderRuns(item)}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <table key={key} style={s.table}>
          <tbody>
            {(block.rows ?? []).map((row, r) => (
              <tr key={r}>
                {(row ?? []).map((cell, c) => (
                  <td key={c} style={s.cell}>
                    {renderRuns(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return null;
  }
}

export function RichContent({ doc }: { doc: RichDoc | null | undefined }) {
  const blocks = (doc?.blocks ?? []).map(renderBlock).filter((node) => node !== null);
  if (blocks.length === 0) return null;
  return <>{blocks}</>;
}
