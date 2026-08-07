import { code128B } from "./barcode";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";

/**
 * The customer's slip — laid out section for section against the tablet's printed slip
 * (android · core/hardware/Hardware.kt · ReceiptText.render), which is itself the studio's own
 * fiscal receipt: identity, the numbered sale block, Qty/Designation/UP/Total with each line's
 * saving spelled out beneath it, a Subtotal/Discount/Total block that shows what the discount
 * was worth, the tender lines, the per-rate tax breakdown, and the fiscal footer.
 *
 * The two must stay IDENTICAL in content and ordering — a customer holding the tablet's paper
 * beside the emailed/printed web copy is looking at one document, not two.
 *
 * Inline-styled and self-contained so it renders the same on screen, in the 80mm print route,
 * on the public /t/[token] page and in the counter's "Sale complete" panel.
 */

const INK = "#37352f";
const MUTED = "#95907f";
const RULE = "#dcd5c6";
const RED = "#c8452f";

/** Plain 2dp, NO thousands separator — the studio's slip reads "2233.00", never "2,233.00". */
function plain(c: number): string {
  const neg = c < 0;
  const a = Math.abs(Math.trunc(c));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
/** "1550.45Rs" — the reference puts the unit AFTER the figure. */
const rs = (c: number) => `${plain(c)}Rs`;
/** "15.0%" for a whole rate, "7.5%" otherwise — the tablet's ReceiptVatGroup.label. */
const ratePct = (r: number) => (Number.isInteger(r) ? r.toFixed(1) : String(r));

export function ReceiptCard({ r, stampAngle = -13 }: { r: ReceiptData; stampAngle?: number }) {
  const bc = code128B(r.barcodeValue);
  const BH = 32;
  const hasLines = r.lines.length > 0;
  // Tender rows state that money changed hands — never on a quote, and never on a dead invoice.
  const showTenders = !r.voided && r.isInvoice;

  const dash = <div style={{ borderTop: `1px dashed ${RULE}`, margin: "8px 0" }} />;
  const centred: React.CSSProperties = { textAlign: "center" };
  /**
   * A left label with its figure pushed to the right edge — the slip's "Subtotal :" rows.
   * Light by default: on the reference only the Total/tender/identity lines carry emphasis,
   * and a slip where everything is bold is a slip where nothing is.
   */
  const kv = (label: string, value: string, strong = false): React.ReactNode => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "2px 0", paddingLeft: 16, fontWeight: strong ? 700 : 400 }}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );

  // "Helvetia, 80840 Moka, MU" prints as two centred lines, as on the reference.
  const addressLines = (() => {
    const a = (r.address ?? "").trim();
    if (!a) return [] as string[];
    const i = a.search(/[\n,]/);
    return (i < 0 ? [a] : [a.slice(0, i), a.slice(i + 1)]).map((s) => s.trim()).filter(Boolean);
  })();
  // Stored as "VAT28070619"; the slip states the number itself under its own label.
  const vatNumber = r.vatNo.replace(/^VAT[\s:]*/i, "").trim();
  // The client's own VAT number, normalised the same way — printed under their name when the
  // sale is to a business (a walk-in or individual carries neither and the lines are dropped).
  const customerVatNumber = r.customerVatNo.replace(/^VAT[\s:]*/i, "").trim();

  return (
    <div
      className="receipt-zig"
      style={{
        position: "relative", width: 300, maxWidth: "100%", margin: "0 auto",
        background: "#faf7f1", color: INK,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSize: 11, lineHeight: 1.42, padding: "26px 20px 22px",
      }}
    >
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

      {/* Status stamp — VOID only. The PAID stamp was dropped on the owner's
          request (2026-07-12); payment state still reads from the tender rows. */}
      {r.voided && (
        <div style={{ position: "absolute", top: 92, right: 20, transform: `rotate(${stampAngle}deg)`, border: `2.5px solid ${RED}`, color: RED, borderRadius: 6, padding: "3px 10px", fontSize: 17, fontWeight: 800, letterSpacing: 2, opacity: 0.82, boxShadow: `inset 0 0 0 1px ${RED}` }}>
          VOID
        </div>
      )}

      {/* ── identity ─────────────────────────────────────────────────────────── */}
      <div style={centred}>
        {r.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.logoUrl} alt="" style={{ display: "block", margin: "0 auto 6px", maxWidth: "100%", maxHeight: 44, objectFit: "contain" }} />
        )}
        {/* The name only prints when there is NO logo — otherwise the studio appears twice,
            exactly as on the tablet, where the transport rasters the logo above the text. */}
        {!r.logoUrl && <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: 1.6 }}>{r.studioName.toUpperCase()}</div>}
        {addressLines.map((a, i) => (
          <div key={i} style={{ fontSize: 10.5 }}>{a}</div>
        ))}
      </div>

      {dash}

      {/* ── the numbered sale block ─────────────────────────────────────────────
          The two references the owner's till printed per sale: the fiscal VAT invoice
          number, and the internal bill reference directly beneath it. */}
      <div style={centred}>
        {r.ticketNo != null && <div style={{ fontWeight: 800, fontSize: 13 }}>No. {r.ticketNo}</div>}
        <div style={{ fontWeight: 700 }}>NUM VAT INVOICE {r.number ?? "—"}</div>
        {r.billLabel && <div style={{ fontWeight: 700 }}>{r.billLabel}</div>}
        <div>{r.saleModeLabel}</div>
        {r.dateTime && <div>{r.dateTime}</div>}
        {/* Who it was for — "Walk-in" when nobody was named, never blank. Matches the
            tablet's slip, which prints this line under the timestamp. */}
        {r.customerName && <div>Customer : {r.customerName}</div>}
        {/* A business client's own fiscal identity, directly under their name — the buyer's
            BRN/VRN a VAT invoice must carry, as distinct from the issuer's in the footer. */}
        {r.customerBrn && <div>BRN : {r.customerBrn}</div>}
        {customerVatNumber && <div>VAT No : {customerVatNumber}</div>}
      </div>

      {dash}

      {/* ── items: Qty | Designation | UP | Total ─────────────────────────────── */}
      {hasLines && (
        <>
          {/* The column header stays light — the ITEM ROWS are what the reference emphasises. */}
          <div style={{ display: "flex", fontSize: 10, color: MUTED }}>
            <span style={{ width: 20, flexShrink: 0 }}>Qty</span>
            <span style={{ flex: 1, minWidth: 0 }}>Designation</span>
            <span style={{ width: 54, textAlign: "right", flexShrink: 0 }}>UP</span>
            <span style={{ width: 58, textAlign: "right", flexShrink: 0 }}>Total</span>
          </div>
          {r.lines.map((l, i) => (
            <div key={i} style={{ marginTop: 3 }}>
              <div style={{ display: "flex", alignItems: "baseline", fontWeight: 700 }}>
                <span className="num" style={{ width: 20, flexShrink: 0 }}>{String(l.qty)}</span>
                {/* minWidth:0 + break-word: a long product name wraps inside its column instead
                    of shoving the money columns off the edge of the paper. */}
                <span style={{ flex: 1, minWidth: 0, paddingRight: 4, lineHeight: 1.3, wordBreak: "break-word" }}>{l.title}</span>
                {/* UP is the FULL unit price; Total is what the line actually cost. */}
                <span className="num" style={{ width: 54, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{plain(l.unitInclCents)}</span>
                <span className="num" style={{ width: 58, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{plain(l.totalInclCents)}</span>
              </div>
              {/* What they saved, in the reference's own words — only when there IS a saving. */}
              {l.discountInclCents > 0 && (
                <div style={{ fontSize: 10, color: MUTED }}>
                  <div>Initial price : <span className="num">{plain(l.fullInclCents)}</span></div>
                  <div>
                    {l.discountPct > 0
                      ? <>Discount {l.discountPct.toFixed(1)}% / <span className="num">{plain(l.discountInclCents)}</span></>
                      : <>Discount : <span className="num">{plain(l.discountInclCents)}</span></>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {dash}

          {/* ── totals ─────────────────────────────────────────────────────────
              Subtotal is the lines at FULL price and Discount is the gap to the total, so
              Subtotal − Discount = Total foots however the discount was stored (per line,
              whole-basket, or both). */}
          {kv("Subtotal :", plain(r.subtotalInclCents))}
          {r.discountInclCents > 0 && kv("Discount :", plain(r.discountInclCents))}
        </>
      )}

      <div style={{ ...centred, fontWeight: 800, fontSize: 15, marginTop: 6 }}>
        Total: <span className="num">{rs(r.totalCents)}</span>
      </div>
      {hasLines && (
        <div style={{ ...centred, fontWeight: 700, marginTop: 2 }}>
          excl. VAT : <span className="num">{rs(r.totalCents - r.vatCents)}</span>
        </div>
      )}

      {dash}

      {/* ── tenders ──────────────────────────────────────────────────────────── */}
      {showTenders && (
        <>
          {r.payments.length === 0 ? (
            <div style={{ fontWeight: 700 }}>1&nbsp;&nbsp;&nbsp;ON ACCOUNT : <span className="num">{rs(r.totalCents)}</span></div>
          ) : (
            // The leading digit counts the legs of that method: "2   CASH : 800.00Rs". A reversal
            // is its own row — the dated per-payment breakdown lives on the A4 ticket.
            r.payments.map((p, i) => (
              <div key={i} style={{ fontWeight: 700, color: p.isReversal ? RED : undefined }}>
                {p.count}&nbsp;&nbsp;&nbsp;{p.method}{p.isReversal ? " REVERSED" : ""} : <span className="num">{rs(p.amountCents)}</span>
              </div>
            ))
          )}
          {r.changeCents > 0 && kv("Change :", plain(r.changeCents))}
          {/* The one number a customer leaving a deposit needs to see on the paper. */}
          {r.balanceDueCents > 0 && kv("BALANCE DUE :", plain(r.balanceDueCents), true)}
          {dash}
        </>
      )}

      {/* ── tax breakdown ────────────────────────────────────────────────────── */}
      {hasLines && r.vatGroups.length > 0 && (
        <>
          {r.vatGroups.map((g, i) => (
            <div key={i} style={{ marginBottom: i < r.vatGroups.length - 1 ? 4 : 0 }}>
              {/* The reference's wording, kept verbatim from the studio's own receipt. */}
              <div>TAUX NORMAL {ratePct(g.rate)}% : <span className="num">{rs(g.vatCents)}</span></div>
              <div style={{ fontSize: 10 }}>
                excl. VAT = <span className="num">{rs(g.baseCents)}</span> / Incl. tax = <span className="num">{rs(g.inclCents)}</span>
              </div>
            </div>
          ))}
          {dash}
        </>
      )}

      {/* ── fiscal footer ────────────────────────────────────────────────────── */}
      <div style={{ ...centred, fontWeight: 700, lineHeight: 1.5, padding: "0 4px" }}>{r.footerNote}</div>
      <div style={{ ...centred, fontSize: 10, color: MUTED, marginTop: 5 }}>
        {r.terminalNo != null && <div>Appareil {r.terminalNo}</div>}
        {r.brn && <div>BRN : {r.brn}</div>}
        {vatNumber && <div>VAT number : {vatNumber}</div>}
        {r.cashier && <div>{r.cashier}</div>}
      </div>

      {/* Barcode — the tablet's transport appends the same one after the text. */}
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
