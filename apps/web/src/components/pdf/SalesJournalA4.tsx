import { formatMUR } from "@/lib/money";

/**
 * A4 Sales Journal — the printable twin of /sales-journal, matching Cashmag's
 * "Journal de ventes" export section for section (in English, and in this app's
 * house style rather than Cashmag's green). Pure and self-contained (inline
 * styles) like DocumentA4 and StatementA4, so it renders identically in a
 * preview and in the server-side PDF and never reflows if Tailwind changes.
 *
 * Unlike the invoice/statement PDFs this one PAGINATES — see the `paginate`
 * option on htmlToPdf — because a long period genuinely runs to several sheets
 * and the owner files them.
 */

const INK = "#101a24";
const MUTED = "#5b6b7a";
const FAINT = "#8c96a1";
const LINE = "#d7dee5";
const HEAD = "#eef2f6";
const BRAND = "#0f2f5e";

const money = (c: number) => formatMUR(c);

export interface JournalTableRow {
  label: string;
  /** rendered right-aligned, in order; a null renders as an empty cell */
  cells: (string | null)[];
  emphasis?: boolean;
}
export interface JournalTable {
  title: string;
  /** the leading label column header, then the right-aligned column headers */
  head: string[];
  rows: JournalTableRow[];
  /** italic pre-total line, e.g. "Subtotal (excl credits)" */
  note?: JournalTableRow;
  total: JournalTableRow;
}

export interface SalesJournalA4Props {
  businessName: string;
  periodLabel: string;
  comparedWith?: string | null;
  tickets: number;
  totalInclLabel: string;
  avgLabel: string;
  clients: number;
  clientsSubLabel: string;
  tables: JournalTable[];
}

export function SalesJournalA4(p: SalesJournalA4Props) {
  const th: React.CSSProperties = {
    padding: "6px 8px", fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase",
    color: MUTED, fontWeight: 700, borderBottom: `1px solid ${LINE}`, background: HEAD,
  };
  const td: React.CSSProperties = { padding: "6px 8px", fontSize: 10, color: INK, borderBottom: `1px solid ${LINE}` };
  const right: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <div style={{ width: "190mm", margin: "0 auto", fontFamily: "Arial, Helvetica, sans-serif", color: INK }}>
      {/* ── header ── */}
      <div style={{ borderBottom: `2px solid ${INK}`, paddingBottom: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>
          {p.businessName}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 3 }}>Sales Journal</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{p.periodLabel}</div>
        {p.comparedWith && (
          <div style={{ fontSize: 10, color: FAINT, marginTop: 2 }}>compared with {p.comparedWith}</div>
        )}
      </div>

      {/* ── KPI tiles ── */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, breakInside: "avoid" }}>
        {[
          { k: "Tickets / Invoices", v: String(p.tickets), sub: null as string | null },
          { k: "Total sales incl tax", v: p.totalInclLabel, sub: p.avgLabel },
          { k: "Clients", v: String(p.clients), sub: p.clientsSubLabel },
        ].map((t, i) => (
          <div
            key={t.k}
            style={{
              flex: 1, border: `1px solid ${LINE}`, borderRadius: 6, padding: "9px 11px",
              background: i === 1 ? "#eef4ff" : "#fff",
            }}
          >
            <div style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{t.k}</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: i === 1 ? BRAND : INK, fontVariantNumeric: "tabular-nums" }}>
              {t.v}
            </div>
            {t.sub && <div style={{ fontSize: 9, color: FAINT, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── the five sections ── */}
      {p.tables.map((t) => (
        <div key={t.title} style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8,
              color: INK, paddingBottom: 5, breakAfter: "avoid",
            }}
          >
            {t.title}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${LINE}` }}>
            <thead>
              <tr>
                {t.head.map((h, i) => (
                  <th key={h + i} style={{ ...th, ...(i === 0 ? { textAlign: "left" } : right) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.length === 0 ? (
                <tr>
                  <td colSpan={t.head.length} style={{ ...td, textAlign: "center", color: FAINT, padding: "14px 8px" }}>
                    Nothing in this period.
                  </td>
                </tr>
              ) : (
                t.rows.map((r, ri) => (
                  <tr key={r.label + ri}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.label}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} style={{ ...td, ...right, color: i === r.cells.length - 1 ? INK : MUTED, fontWeight: i === r.cells.length - 1 ? 700 : 400 }}>
                        {c ?? ""}
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {t.note && (
                <tr>
                  <td style={{ ...td, fontStyle: "italic", color: MUTED }}>{t.note.label}</td>
                  {t.note.cells.map((c, i) => (
                    <td key={i} style={{ ...td, ...right, fontStyle: "italic", color: MUTED, fontWeight: 700 }}>{c ?? ""}</td>
                  ))}
                </tr>
              )}
              <tr>
                <td style={{ ...td, background: HEAD, fontWeight: 800, borderBottom: "none" }}>{t.total.label}</td>
                {t.total.cells.map((c, i) => (
                  <td
                    key={i}
                    style={{ ...td, ...right, background: HEAD, fontWeight: 800, borderBottom: "none", color: i === t.total.cells.length - 1 ? BRAND : INK }}
                  >
                    {c ?? ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** SalesJournal → the flat table shapes above. Exported so it can be unit-tested
 *  without a browser: the PDF must agree with the screen figure for figure. */
export { money as formatJournalMoney };
