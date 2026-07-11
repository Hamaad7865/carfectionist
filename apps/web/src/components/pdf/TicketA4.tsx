import type { ReceiptData } from "@/lib/supabase/queries/receipt";
import { formatMUR } from "@/lib/money";

// A4 ticket detail (the owner's Cashmag print reference): company header,
// ticket number + date, the line table with BOTH excl- and incl-VAT unit
// prices and totals, the tax block, and the payment ("règlements") detail.
// Inline styles only — deliberately isolated from app CSS like DocumentA4.

const th: React.CSSProperties = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5b6572", fontWeight: 700, padding: "6px 8px", borderBottom: "1.5px solid #1c2733", textAlign: "right" };
const td: React.CSSProperties = { fontSize: 12.5, color: "#1c2733", padding: "7px 8px", borderBottom: "1px solid #e3e8ee", textAlign: "right", fontVariantNumeric: "tabular-nums" };

export function TicketA4({ r }: { r: ReceiptData }) {
  return (
    <div style={{ width: 794, minHeight: 1000, margin: "0 auto", background: "#fff", padding: "56px 64px", fontFamily: "Inter, Arial, sans-serif", color: "#1c2733" }}>
      {/* company */}
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.02em" }}>{r.studioName.toUpperCase()}</div>
      {r.address && <div style={{ fontSize: 12, color: "#5b6572", marginTop: 2, whiteSpace: "pre-line" }}>{r.address}</div>}
      {(r.brn || r.vatNo) && (
        <div style={{ fontSize: 11, color: "#5b6572", marginTop: 2 }}>
          {r.brn ? `BRN ${r.brn}` : ""}{r.brn && r.vatNo ? " · " : ""}{r.vatNo ? `VAT ${r.vatNo}` : ""}
        </div>
      )}

      {/* ticket header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 34 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Ticket {r.number ?? "—"}</div>
          <div style={{ fontSize: 12, color: "#5b6572", marginTop: 3 }}>
            {r.docLabel}{r.cashier ? ` · served by ${r.cashier}` : ""}{r.customerName ? ` · ${r.customerName}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "#5b6572", textTransform: "uppercase", letterSpacing: "0.06em" }}>{r.dateLabel}</div>
      </div>
      {r.voided && (
        <div style={{ marginTop: 10, display: "inline-block", border: "2px solid #d63b50", color: "#d63b50", fontWeight: 800, fontSize: 12, letterSpacing: "0.2em", padding: "4px 10px" }}>
          VOID
        </div>
      )}

      {/* lines: unit + total, both excl and incl */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 26 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", width: 42 }}>Qty</th>
            <th style={{ ...th, textAlign: "left" }}>Description</th>
            <th style={{ ...th, width: 100 }}>Unit excl</th>
            <th style={{ ...th, width: 100 }}>Unit incl</th>
            <th style={{ ...th, width: 108 }}>Total excl</th>
            <th style={{ ...th, width: 108 }}>Total incl</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td style={{ ...td, textAlign: "left" }}>{Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(2)}</td>
              <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{l.title}</td>
              <td style={td}>{formatMUR(l.unitExclCents)}</td>
              <td style={td}>{formatMUR(l.unitInclCents)}</td>
              <td style={td}>{formatMUR(l.totalExclCents)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{formatMUR(l.totalInclCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* tax block + totals */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 40, marginTop: 26 }}>
        <table style={{ borderCollapse: "collapse", alignSelf: "flex-start" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", width: 130 }}>Tax</th>
              <th style={{ ...th, width: 110 }}>Amount</th>
              <th style={{ ...th, width: 110 }}>Base excl</th>
            </tr>
          </thead>
          <tbody>
            {r.vatGroups.map((g) => (
              <tr key={g.rate}>
                <td style={{ ...td, textAlign: "left" }}>VAT ({g.rate.toFixed(2)}%)</td>
                <td style={td}>{formatMUR(g.vatCents)}</td>
                <td style={td}>{formatMUR(g.baseCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ minWidth: 260 }}>
          {r.discountInclCents > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", color: "#8a6410" }}>
              <span>Discount</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>−{formatMUR(r.discountInclCents)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" }}>
            <span style={{ color: "#5b6572" }}>Total excl</span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatMUR(r.subtotalCents)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15.5, fontWeight: 800, borderTop: "2px solid #1c2733", marginTop: 6, paddingTop: 8 }}>
            <span>TOTAL incl</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMUR(r.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* payment detail */}
      {r.paymentDetail.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 34, marginBottom: 4 }}>Payment details</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left", width: 130 }}>Date</th>
                <th style={{ ...th, textAlign: "left" }}>Method</th>
                <th style={{ ...th, width: 130 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.paymentDetail.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left" }}>{p.at}</td>
                  <td style={{ ...td, textAlign: "left" }}>{p.method}{p.isReversal ? " — REVERSED" : ""}</td>
                  <td style={{ ...td, color: p.amountCents < 0 ? "#d63b50" : "#1c2733" }}>{formatMUR(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
