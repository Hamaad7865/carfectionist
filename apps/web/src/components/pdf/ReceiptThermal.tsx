import type { ReceiptData } from "@/lib/supabase/queries/receipt";

/** 80mm thermal receipt — mirrors the studio's Cashmag layout (header, VAT
 *  invoice block, line table, total, tender, VAT breakdown, legal footer) but
 *  drives every value from our own document data. Deliberately isolated from
 *  Tailwind (inline monospace styles) so app restyles can never reflow a
 *  fiscal receipt. Rendered both for on-screen preview and window.print(). */
export function ReceiptThermal({ r }: { r: ReceiptData }) {
  const n = (c: number) => (c / 100).toFixed(2);
  const hr = <div style={{ borderTop: "1px dashed #000", margin: "7px 0" }} />;
  const center: React.CSSProperties = { textAlign: "center" };

  return (
    <div
      style={{
        width: 280,
        margin: "0 auto",
        background: "#fff",
        color: "#000",
        fontFamily: "'Courier New', ui-monospace, monospace",
        fontSize: 12,
        lineHeight: 1.42,
        padding: "12px 12px 18px",
      }}
    >
      {/* Header */}
      <div style={{ ...center, fontWeight: 800, fontSize: 16, letterSpacing: 1.5 }}>{r.studioName.toUpperCase()}</div>
      {r.address && <div style={{ ...center, fontSize: 11 }}>{r.address}</div>}
      {hr}

      {/* Invoice block */}
      <div style={{ ...center, fontWeight: 700 }}>VAT INVOICE {r.number ?? ""}</div>
      <div style={{ ...center, fontSize: 11 }}>Sale - SALES [{r.studioName.toUpperCase()}]</div>
      {r.dateTime && <div style={{ ...center, fontSize: 11 }}>{r.dateTime}</div>}
      {hr}

      {/* Lines */}
      <div style={{ display: "flex", fontWeight: 700, fontSize: 11 }}>
        <span style={{ width: 22 }}>Qty</span>
        <span style={{ flex: 1 }}>Designation</span>
        <span style={{ width: 54, textAlign: "right" }}>UP</span>
        <span style={{ width: 58, textAlign: "right" }}>Total</span>
      </div>
      {r.lines.map((l, i) => (
        <div key={i} style={{ display: "flex", fontSize: 11.5, marginTop: 2 }}>
          <span style={{ width: 22 }}>{Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(2)}</span>
          <span style={{ flex: 1, wordBreak: "break-word", paddingRight: 4 }}>{l.title}</span>
          <span style={{ width: 54, textAlign: "right" }}>{n(l.unitInclCents)}</span>
          <span style={{ width: 58, textAlign: "right" }}>{n(l.totalInclCents)}</span>
        </div>
      ))}
      {hr}

      {/* Total */}
      <div style={{ ...center, fontWeight: 800, fontSize: 17 }}>Total: {n(r.totalCents)}Rs</div>
      <div style={{ ...center, fontWeight: 700, marginTop: 5 }}>excl. VAT : {n(r.subtotalCents)}Rs</div>
      {hr}

      {/* Tender */}
      {r.payments.map((p, i) => (
        <div key={i}>1&nbsp;&nbsp;&nbsp;{p.method} : {n(p.amountCents)}Rs</div>
      ))}
      {r.payments.length > 0 && hr}

      {/* VAT breakdown */}
      {r.vatGroups.map((g, i) => (
        <div key={i} style={{ marginBottom: i < r.vatGroups.length - 1 ? 4 : 0 }}>
          <div>TAUX NORMAL {g.rate.toFixed(1)}% : {n(g.vatCents)}Rs</div>
          <div style={{ fontSize: 11 }}>excl. VAT = {n(g.baseCents)}Rs / Incl. tax = {n(g.inclCents)}Rs</div>
        </div>
      ))}
      {hr}

      {/* Footer */}
      <div style={{ ...center, fontWeight: 700 }}>Thank you for visiting.</div>
      <div style={{ ...center, fontSize: 10.5, marginTop: 6 }}>
        {r.brn && <div>BRN : {r.brn}</div>}
        {r.vatNo && <div>VAT number : {r.vatNo}</div>}
        {r.cashier && <div style={{ marginTop: 2 }}>{r.cashier}</div>}
      </div>
    </div>
  );
}
