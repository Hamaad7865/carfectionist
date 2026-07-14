import { formatMUR } from "@/lib/money";

/**
 * A4 customer statement of account — who owes the shop, aged by calendar month, with
 * the outstanding invoices itemised. Pure and self-contained (inline styles) so it
 * renders identically in a preview and in the server-side PDF, and never reflows if the
 * app's Tailwind changes. Mirrors DocumentA4's isolation, kept deliberately plainer —
 * a statement is an internal/customer ledger, not a fiscal document.
 */

export interface StatementBucketView {
  label: string;
  cents: number;
}
export interface StatementInvoiceView {
  date: string; // display, e.g. "17 Mar 2026"
  number: string | null;
  detail: string;
  debitCents: number;
  creditCents: number;
}
export interface StatementA4Props {
  from: {
    tradingName: string;
    legalName: string;
    country: string;
    brn: string;
    email: string;
    phone: string;
    vatNo: string;
  };
  customerName: string;
  refDate: string; // display, e.g. "11 July 2026"
  soldeCents: number;
  buckets: StatementBucketView[];
  carriedCents: number;
  invoices: StatementInvoiceView[];
}

const INK = "#101a24";
const MUTED = "#5b6b7a";
const LINE = "#d7dee5";
const HEAD = "#eef2f6";

export function StatementA4({ from, customerName, refDate, soldeCents, buckets, carriedCents, invoices }: StatementA4Props) {
  const th: React.CSSProperties = { padding: "7px 10px", fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: MUTED, fontWeight: 700, borderBottom: `1px solid ${LINE}`, background: HEAD };
  const td: React.CSSProperties = { padding: "7px 10px", fontSize: 11, color: INK, borderBottom: `1px solid ${LINE}`, verticalAlign: "top" };
  const money: React.CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ width: "190mm", margin: "0 auto", padding: "12mm 0", fontFamily: "Arial, Helvetica, sans-serif", color: INK }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `2px solid ${INK}`, paddingBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{from.tradingName}</div>
          {from.legalName && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{from.legalName}</div>}
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
            {[from.country, from.brn && `BRN ${from.brn}`, from.vatNo && `VAT ${from.vatNo}`].filter(Boolean).join(" · ")}
          </div>
          <div style={{ fontSize: 10, color: MUTED }}>{[from.phone, from.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 1 }}>STATEMENT OF ACCOUNT</div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>As at {refDate}</div>
        </div>
      </div>

      {/* bill-to */}
      <div style={{ marginTop: 16, background: HEAD, border: `1px solid ${LINE}`, borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>Account</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{customerName}</div>
      </div>

      {/* aged balance */}
      <div style={{ marginTop: 18, fontSize: 11, fontWeight: 700 }}>Balance — aged</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, border: `1px solid ${LINE}` }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Solde</th>
            {buckets.map((b) => <th key={b.label} style={{ ...th, textAlign: "right" }}>{b.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...td, fontWeight: 800 }}>{formatMUR(soldeCents)}</td>
            {buckets.map((b) => <td key={b.label} style={{ ...td, ...money }}>{b.cents ? formatMUR(b.cents) : "—"}</td>)}
          </tr>
        </tbody>
      </table>

      {/* credit invoices */}
      <div style={{ marginTop: 18, fontSize: 11, fontWeight: 700 }}>Credit invoices</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, border: `1px solid ${LINE}` }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", width: "90px" }}>Date</th>
            <th style={{ ...th, textAlign: "left" }}>Detail</th>
            <th style={{ ...th, textAlign: "right", width: "110px" }}>Debit</th>
            <th style={{ ...th, textAlign: "right", width: "110px" }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {carriedCents !== 0 && (
            <tr>
              <td style={td}>Avant</td>
              <td style={{ ...td, color: MUTED, fontStyle: "italic" }}>Carried forward from Cashmag</td>
              <td style={{ ...td, ...money }}>{carriedCents > 0 ? formatMUR(carriedCents) : "—"}</td>
              <td style={{ ...td, ...money }}>{carriedCents < 0 ? formatMUR(-carriedCents) : "—"}</td>
            </tr>
          )}
          {invoices.map((inv, i) => (
            <tr key={i}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{inv.date}</td>
              <td style={td}>
                {inv.number && <div style={{ fontWeight: 600 }}>{inv.number}</div>}
                <div style={{ fontSize: 10, color: MUTED }}>{inv.detail}</div>
              </td>
              <td style={{ ...td, ...money }}>{formatMUR(inv.debitCents)}</td>
              <td style={{ ...td, ...money }}>{inv.creditCents ? formatMUR(inv.creditCents) : "—"}</td>
            </tr>
          ))}
          {invoices.length === 0 && carriedCents === 0 && (
            <tr><td style={{ ...td, color: MUTED, textAlign: "center" }} colSpan={4}>Nothing outstanding.</td></tr>
          )}
          <tr>
            <td style={{ ...td, borderBottom: "none", fontWeight: 800 }} colSpan={2}>Balance owed</td>
            <td style={{ ...td, ...money, borderBottom: "none", fontWeight: 800 }}>{formatMUR(soldeCents)}</td>
            <td style={{ ...td, borderBottom: "none" }} />
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 24, fontSize: 9.5, color: MUTED }}>
        This statement reflects invoices outstanding as at {refDate}. Amounts shown as "carried forward" are balances
        brought over from the previous system.
      </div>
    </div>
  );
}
