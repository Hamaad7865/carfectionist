import { formatMUR } from "@/lib/money";
import { code128B } from "./barcode";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";

/** Card-style receipt matching the studio's POS mockup (cream paper, torn edges,
 *  header, meta, items, totals, PAID stamp, scannable barcode) driven entirely
 *  by our own document data. Inline-styled + self-contained so it renders the
 *  same on screen, in print, and in the counter "Sale complete" panel. */

const INK = "#37352f";
const MUTED = "#95907f";
const FAINT = "#b7b1a1";
const RULE = "#dcd5c6";
const GREEN = "#2f9e6f";
const RED = "#c8452f";

export function ReceiptCard({ r, stampAngle = -13 }: { r: ReceiptData; stampAngle?: number }) {
  const bc = code128B(r.barcodeValue);
  const BH = 32;
  // Label the VAT row with the actual rate(s) — never assume 15%.
  const rates = [...new Set(r.vatGroups.map((g) => g.rate))];
  const vatLabel = rates.length === 1 ? `VAT ${rates[0] % 1 === 0 ? rates[0] : rates[0].toFixed(1)}% (incl.)` : "VAT (incl.)";
  const row = (label: string, value: string, opts?: { strong?: boolean; muted?: boolean; color?: string }): React.ReactNode => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "3px 0", fontSize: opts?.strong ? 12 : 11 }}>
      <span style={{ color: opts?.muted ? MUTED : INK, fontWeight: opts?.strong ? 700 : 400 }}>{label}</span>
      <span className="num" style={{ color: opts?.color ?? (opts?.strong ? INK : INK), fontWeight: opts?.strong ? 800 : 600 }}>{value}</span>
    </div>
  );
  const dash = <div style={{ borderTop: `1px dashed ${RULE}`, margin: "9px 0" }} />;

  return (
    <div className="receipt-zig" style={{ position: "relative", width: 300, margin: "0 auto", background: "#faf7f1", color: INK, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", padding: "26px 22px 22px" }}>
      <style>{`
        .receipt-zig{
          --t:7px; --w:14px;
          -webkit-mask:
            linear-gradient(#000 0 0) 0 var(--t)/100% calc(100% - var(--t)*2) no-repeat,
            conic-gradient(from 135deg at top, #0000 25%, #000 0) 0 0/var(--w) var(--t) repeat-x,
            conic-gradient(from -45deg at bottom, #0000 25%, #000 0) 0 100%/var(--w) var(--t) repeat-x;
          mask:
            linear-gradient(#000 0 0) 0 var(--t)/100% calc(100% - var(--t)*2) no-repeat,
            conic-gradient(from 135deg at top, #0000 25%, #000 0) 0 0/var(--w) var(--t) repeat-x,
            conic-gradient(from -45deg at bottom, #0000 25%, #000 0) 0 100%/var(--w) var(--t) repeat-x;
        }
      `}</style>

      {/* Status stamp */}
      {(r.paid || r.voided) && (
        <div style={{ position: "absolute", top: 92, right: 20, transform: `rotate(${stampAngle}deg)`, border: `2.5px solid ${r.voided ? RED : GREEN}`, color: r.voided ? RED : GREEN, borderRadius: 6, padding: "3px 10px", fontSize: 17, fontWeight: 800, letterSpacing: 2, opacity: 0.82, boxShadow: `inset 0 0 0 1px ${r.voided ? RED : GREEN}` }}>
          {r.voided ? "VOID" : "PAID"}
        </div>
      )}

      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: 1.6 }}>{r.studioName.toUpperCase()}</div>
        {(r.address || r.brn) && (
          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 5 }}>{[r.address, r.brn && `BRN ${r.brn}`].filter(Boolean).join(" · ")}</div>
        )}
        {(r.vatNo || r.phone) && (
          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>{[r.vatNo && `VAT: ${r.vatNo}`, r.phone].filter(Boolean).join(" · ")}</div>
        )}
      </div>

      {dash}

      {/* Meta */}
      <div>
        {row(r.docLabel, r.number ?? "—", { muted: true })}
        {row("Date", r.dateLabel, { muted: true })}
        {row("Cashier", r.cashier || "—", { muted: true })}
        {row("Customer", r.customerName, { muted: true })}
      </div>

      {dash}

      {/* Items */}
      <div>
        {r.lines.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", margin: "4px 0", fontSize: 11 }}>
            <span style={{ color: MUTED, width: 26, flexShrink: 0 }}>{Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(2)}×</span>
            <span style={{ flex: 1, paddingRight: 8, lineHeight: 1.3 }}>{l.title}</span>
            <span className="num" style={{ fontWeight: 600 }}>{formatMUR(l.totalInclCents)}</span>
          </div>
        ))}
      </div>

      {dash}

      {/* Totals */}
      <div>
        {row("Subtotal", formatMUR(r.subtotalInclCents), { muted: true })}
        {row(vatLabel, formatMUR(r.vatCents), { muted: true })}
        {r.discountInclCents > 0 && row("Discount", `−${formatMUR(r.discountInclCents)}`, { muted: true, color: "#b8791b" })}
      </div>

      <div style={{ borderTop: `1.5px solid ${RULE}`, margin: "9px 0" }} />

      <div>
        {row("TOTAL", formatMUR(r.totalCents), { strong: true })}
        {!r.voided && r.isInvoice && (
          r.payments.length > 1
            ? r.payments.map((pmt, i) => <div key={i}>{row(`Paid · ${pmt.method.toLowerCase()}`, formatMUR(pmt.amountCents), { muted: true })}</div>)
            : r.paidCents > 0 && row(`Paid · ${r.methodLabel}`, formatMUR(r.paidCents), { muted: true })
        )}
        {!r.voided && r.changeCents > 0 && row("Change", formatMUR(r.changeCents), { muted: true })}
        {!r.voided && r.isInvoice && !r.paid && r.balanceDueCents > 0 && row("Balance due", formatMUR(r.balanceDueCents), { muted: true, color: "#b8791b" })}
      </div>

      {dash}

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 9.5, color: MUTED, lineHeight: 1.5, padding: "0 4px" }}>{r.footerNote}</div>
      <div style={{ textAlign: "center", fontSize: 8.5, color: FAINT, marginTop: 6, letterSpacing: 0.3 }}>powered by {r.studioName}</div>

      {/* Barcode */}
      <div style={{ marginTop: 12 }}>
        <svg viewBox={`0 0 ${bc.width} ${BH}`} width="72%" height={BH} preserveAspectRatio="none" style={{ display: "block", margin: "0 auto" }}>
          {bc.bars.map((b, i) => (
            <rect key={i} x={b.x} y={0} width={b.w} height={BH} fill={INK} />
          ))}
        </svg>
        <div className="num" style={{ textAlign: "center", fontSize: 9, color: MUTED, letterSpacing: 1, marginTop: 4 }}>{r.codeLabel}</div>
      </div>
    </div>
  );
}
