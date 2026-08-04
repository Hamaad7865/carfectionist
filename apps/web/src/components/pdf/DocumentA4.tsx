import type { CSSProperties } from "react";
import { amountInWordsMUR } from "@/lib/number-to-words";
import { effectiveSections, type DocType, type SectionFlags } from "@/lib/pdf/fiscal-lock";
import { RichContent } from "@/lib/rich/render";
import type { RichDoc } from "@/lib/rich/types";

/**
 * The Diamondbrite A4 document — one template for quotes and invoices. Pure and
 * self-contained (inline styles + one embedded print stylesheet) so it renders
 * identically in the live preview iframe and in the server-side PDF. Deliberately
 * isolated from the app's Tailwind so a restyle can never reflow a fiscal document.
 *
 * Layout matches the studio's reference output byte-for-byte at the visual level:
 * COVERED BY DIAMONDS header band + Diamondbrite logo, filled grey party/bank
 * boxes, a zebra-striped numbered line table, MUR-prefixed money, a VAT + bordered
 * Total block, and the "Diamondbrite forever" footer band.
 */

export interface DocLineView {
  title: string;
  /** Flat text. Still printed for lines saved before rich content existed. */
  detail?: string | null;
  /** The structured description. Wins over `detail` when both are present. */
  rich?: RichDoc | null;
  /** Free word beside the quantity — "3 panels", "4 hrs". */
  unit?: string | null;
  qty: number;
  rateCents: number;
  amountCents: number;
  discountNote?: string | null;
}

export interface DocumentA4Props {
  docType: DocType;
  number: string | null;
  issueDate: string | null; // ISO yyyy-mm-dd
  createdBy: string;
  from: {
    tradingName: string;
    legalName: string;
    country: string;
    brn: string;
    email: string;
    phone: string;
    vatNo: string;
  };
  billTo: { name: string; country: string };
  lines: DocLineView[];
  subtotalCents: number;      // pre-order-discount ex-VAT sum (the Subtotal row)
  discountCents?: number;     // ex-VAT reduction from an order discount (> 0 shows a row)
  discountLabel?: string | null; // what was entered, e.g. "10%" or "Rs 500 incl. VAT"
  vatCents: number;
  totalCents: number;
  /** Line prices are stated VAT-INCLUSIVE, so VAT reads "of which" rather than an addition. */
  vatInclusive?: boolean;
  bank?: { accountName: string; accountNumber: string; bankName: string } | null;
  terms?: string[];
  assets?: { headerBannerUrl?: string | null; footerBannerUrl?: string | null; logoUrl?: string | null };
  sectionConfig?: Partial<SectionFlags>;
  customFields?: { label: string; value: string }[];
  /** Client acceptance captured on the tablet — stamps the document with the
   *  signature so the customer receives proof of what they agreed to. */
  accepted?: { name: string | null; at: string | null; signatureUrl: string | null } | null;
  /** The document's status is VOID. The cancelling of any scheduled send is the
   *  primary defence; this is the backstop — even a PDF that slips out some other
   *  way (an old email link, a manual re-send) can never read as a live payable. */
  voided?: boolean;
}

// Baked-in Diamondbrite artwork (served from apps/web/public) — the default so
// every document carries the brand without any template config.
const DEFAULT_HEADER = "/brand/covered-by-diamonds.png";
const DEFAULT_FOOTER = "/brand/diamondbrite-forever.png";
const DEFAULT_LOGO = "/brand/diamondbrite-logo.png";

const INK = "#20242a";
const MUTED = "#6b7280";
const LINE_LABEL = "#5b6570";
const HEADER_BG = "#3a3f43"; // table header dark grey
const BOX_BG = "#ededf0";    // filled party / bank boxes
const ZEBRA = "#f5f6f7";     // even table row
const HAIR = "#e7eaed";
const RULE = "#c9ced3";

// Money on the document is MUR-prefixed (the reference uses "MUR", the app UI uses "Rs").
function group(rupees: number): string {
  return String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function mur(cents: number): string {
  const n = Math.trunc(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  return `MUR ${neg ? "-" : ""}${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}
// Unit rate drops a whole-rupee ".00" (reference shows "MUR 935", not "MUR 935.00").
function murRate(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  if (abs % 100 === 0) return `MUR ${cents < 0 ? "-" : ""}${group(Math.floor(abs / 100))}`;
  return mur(cents);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
}

const s = {
  page: {
    boxSizing: "border-box",
    width: "210mm",
    minHeight: "297mm",
    margin: "0 auto",
    background: "#fff",
    color: INK,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSize: "10.5px",
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  } as CSSProperties,
  // Fixed to the viewport (not absolute to the page), so it stays centred on
  // whatever prints even if the content grows past one A4 sheet.
  voidWatermark: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%) rotate(-30deg)",
    fontSize: "130px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "rgba(200, 30, 30, 0.32)",
    border: "8px solid rgba(200, 30, 30, 0.32)",
    borderRadius: "12px",
    padding: "8px 36px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 999,
  } as CSSProperties,
  // Banner bands are capped at the reference height (~43mm — the Refrens bands
  // are 582×122pt) and centre-cropped, so a tall/square image configured in
  // Settings → Templates can never balloon the page onto a second sheet.
  banner: { display: "block", width: "100%", maxHeight: "43mm", objectFit: "cover", objectPosition: "center", flexShrink: 0 } as CSSProperties,
  body: { padding: "8mm 10mm 0", flexGrow: 1 } as CSSProperties,

  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" } as CSSProperties,
  title: { fontSize: "29px", fontWeight: 400, margin: 0, lineHeight: 1.05, color: INK } as CSSProperties,
  tradingCaps: { color: MUTED, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "3px" } as CSSProperties,
  logo: { height: "42px", objectFit: "contain" } as CSSProperties,

  meta: { marginTop: "14px", display: "flex", flexDirection: "column", gap: "5px" } as CSSProperties,
  metaRow: { display: "flex", fontSize: "10.5px", alignItems: "baseline" } as CSSProperties,
  metaLabel: { color: MUTED, width: "120px", flexShrink: 0 } as CSSProperties,
  metaValue: { fontWeight: 700, color: INK } as CSSProperties,

  boxes: { display: "flex", gap: "14px", marginTop: "18px" } as CSSProperties,
  box: { flex: 1, background: BOX_BG, borderRadius: "6px", padding: "13px 15px" } as CSSProperties,
  boxHeading: { fontSize: "14px", fontWeight: 400, color: "#565f68", marginBottom: "8px" } as CSSProperties,
  boxName: { fontWeight: 700, color: INK, marginBottom: "2px" } as CSSProperties,
  boxLine: { color: LINE_LABEL, fontSize: "10px", marginTop: "1px" } as CSSProperties,

  table: { width: "100%", borderCollapse: "collapse", marginTop: "20px", fontSize: "10.5px" } as CSSProperties,
  thBand: { background: HEADER_BG } as CSSProperties,
  thNo: { background: HEADER_BG, width: "26px" } as CSSProperties,
  th: { background: HEADER_BG, color: "#fff", textAlign: "left", padding: "9px 12px", fontSize: "10px", fontWeight: 600 } as CSSProperties,
  thNum: { background: HEADER_BG, color: "#fff", textAlign: "right", padding: "9px 12px", fontSize: "10px", fontWeight: 600 } as CSSProperties,
  tdNo: { padding: "10px 4px 10px 14px", color: "#7a828a", verticalAlign: "top", whiteSpace: "nowrap" } as CSSProperties,
  td: { padding: "10px 12px", borderBottom: `1px solid ${HAIR}`, verticalAlign: "top" } as CSSProperties,
  tdNum: { padding: "10px 12px", borderBottom: `1px solid ${HAIR}`, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", verticalAlign: "top" } as CSSProperties,
  lineTitle: { fontWeight: 500 } as CSSProperties,
  lineDetail: { color: MUTED, whiteSpace: "pre-wrap", marginTop: "2px", fontSize: "9.5px" } as CSSProperties,

  totalsWrap: { display: "flex", justifyContent: "space-between", marginTop: "16px", gap: "24px", alignItems: "flex-start" } as CSSProperties,
  words: { flex: 1, fontSize: "10px", paddingTop: "4px" } as CSSProperties,
  wordsValue: { textTransform: "uppercase" } as CSSProperties,
  totalsBox: { width: "260px", flexShrink: 0 } as CSSProperties,
  totalRow: { display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: "10.5px" } as CSSProperties,
  grandRow: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "9px", marginTop: "5px", borderTop: `1px solid ${RULE}`, fontWeight: 700, fontSize: "15px" } as CSSProperties,

  bankBox: { marginTop: "18px", background: BOX_BG, borderRadius: "6px", padding: "13px 15px", maxWidth: "340px" } as CSSProperties,
  bankRow: { display: "flex", gap: "12px", marginTop: "3px", fontSize: "10px" } as CSSProperties,
  bankLabel: { fontWeight: 700, color: INK, width: "120px", flexShrink: 0 } as CSSProperties,
  bankValue: { color: LINE_LABEL } as CSSProperties,

  section: { marginTop: "18px" } as CSSProperties,
  sectionLabel: { color: "#565f68", fontSize: "12.5px", marginBottom: "5px" } as CSSProperties,

  disclaimer: { textAlign: "center", fontSize: "8px", color: "#9aa4ad", padding: "12px 0 16px", flexShrink: 0 } as CSSProperties,
};

const PRINT_CSS = `
@page { size: auto; margin: 0; }
/* size MUST stay auto: the PDF renderer prints onto content-height paper, and a
   fixed "size: A4" here makes Chromium centre an A4 page box on the taller
   paper — a 50pt band above the header and the footer spilling to page 2. */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
/* A table inside a line's rich description is a table in its own right — the rule
   above only names tr, so without this one a two-row spec table can split. */
table { page-break-inside: avoid; }
`;

function BoxLine({ label, value }: { label?: string; value: string }) {
  return (
    <div style={s.boxLine}>
      {label ? <span style={{ fontWeight: 700, color: "#3f474f" }}>{label} </span> : null}
      {value}
    </div>
  );
}

export function DocumentA4(props: DocumentA4Props) {
  const { docType, number, issueDate, createdBy, from, billTo, lines } = props;
  const sections = effectiveSections(props.sectionConfig ?? {}, docType);
  const title = docType === "quote" ? "Quotation" : docType === "credit_note" ? "Credit Note" : "Invoice";
  const noun = title; // "Quotation From" / "Invoice For" etc.
  const terms = props.terms ?? [];

  const headerUrl = props.assets?.headerBannerUrl || DEFAULT_HEADER;
  const footerUrl = props.assets?.footerBannerUrl || DEFAULT_FOOTER;
  const logoUrl = props.assets?.logoUrl || DEFAULT_LOGO;

  return (
    <div style={s.page}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {props.voided && <div style={s.voidWatermark}>VOID</div>}

      {/* header band */}
      <img src={headerUrl} alt={from.tradingName} style={s.banner} />

      <div style={s.body}>
        {/* title + logo */}
        <div style={s.headerRow}>
          <div>
            <h1 style={s.title}>{title}</h1>
            <div style={s.tradingCaps}>{from.tradingName.toUpperCase()}</div>
          </div>
          {logoUrl ? <img src={logoUrl} alt="" style={s.logo} /> : null}
        </div>

        {/* meta rows */}
        <div style={s.meta}>
          <div style={s.metaRow}><span style={s.metaLabel}>{noun} No #</span><span style={s.metaValue}>{number ?? "DRAFT"}</span></div>
          <div style={s.metaRow}><span style={s.metaLabel}>{noun} Date</span><span style={s.metaValue}>{formatDate(issueDate)}</span></div>
          <div style={s.metaRow}><span style={s.metaLabel}>Created By</span><span style={s.metaValue}>{createdBy}</span></div>
          {(props.customFields ?? []).filter((f) => f.label.trim() !== "").map((f, i) => (
            <div key={i} style={s.metaRow}><span style={s.metaLabel}>{f.label}</span><span style={s.metaValue}>{f.value || "—"}</span></div>
          ))}
        </div>

        {/* From / For */}
        <div style={s.boxes}>
          {sections.from && (
            <div style={s.box}>
              <div style={s.boxHeading}>{noun} From</div>
              <div style={s.boxName}>{from.tradingName}</div>
              <BoxLine value={from.country} />
              <BoxLine label="BRN:" value={from.brn} />
              <BoxLine label="Email:" value={from.email} />
              <BoxLine label="Phone:" value={from.phone} />
              <BoxLine label="VAT NUMBER:" value={from.vatNo} />
            </div>
          )}
          <div style={s.box}>
            <div style={s.boxHeading}>{noun} For</div>
            <div style={s.boxName}>{billTo.name || "—"}</div>
            <BoxLine value={billTo.country} />
          </div>
        </div>

        {/* Lines */}
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.thNo}></th>
              <th style={s.th}>Item</th>
              <th style={s.thNum}>Quantity</th>
              <th style={s.thNum}>Rate</th>
              <th style={s.thNum}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const zebra = i % 2 === 1 ? { background: ZEBRA } : undefined;
              return (
                <tr key={i} style={zebra}>
                  <td style={{ ...s.tdNo, ...(zebra ?? {}), borderBottom: `1px solid ${HAIR}` }}>{i + 1}.</td>
                  <td style={{ ...s.td, ...(zebra ?? {}) }}>
                    <div style={s.lineTitle}>{l.title}</div>
                    {/* The tree wins. `detail` is its flat mirror, so printing both
                        would say the same thing twice. */}
                    {l.rich ? (
                      <div style={s.lineDetail}>
                        <RichContent doc={l.rich} />
                      </div>
                    ) : l.detail ? (
                      <div style={s.lineDetail}>{l.detail}</div>
                    ) : null}
                    {l.discountNote ? <div style={s.lineDetail}>{l.discountNote}</div> : null}
                  </td>
                  <td style={{ ...s.tdNum, ...(zebra ?? {}) }}>{l.unit ? `${l.qty} ${l.unit}` : l.qty}</td>
                  <td style={{ ...s.tdNum, ...(zebra ?? {}) }}>{murRate(l.rateCents)}</td>
                  <td style={{ ...s.tdNum, ...(zebra ?? {}) }}>{mur(l.amountCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div style={s.totalsWrap}>
          <div style={s.words}>
            {sections.totalInWords && (
              <span>
                <span style={{ color: MUTED }}>Total (in words) : </span>
                <span style={s.wordsValue}>{amountInWordsMUR(props.totalCents)}</span>
              </span>
            )}
          </div>
          <div style={s.totalsBox}>
            {props.discountCents ? (
              <>
                <div style={s.totalRow}><span style={{ color: MUTED }}>Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{mur(props.subtotalCents)}</span></div>
                <div style={s.totalRow}><span style={{ color: MUTED }}>Discount{props.discountLabel ? ` (${props.discountLabel})` : ""}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>−{mur(props.discountCents)}</span></div>
              </>
            ) : null}
            <div style={s.totalRow}><span style={{ color: MUTED }}>{props.vatInclusive ? "of which VAT" : "VAT"}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{mur(props.vatCents)}</span></div>
            <div style={s.grandRow}><span>Total (MUR)</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{mur(props.totalCents)}</span></div>
          </div>
        </div>

        {/* Bank details */}
        {sections.bankDetails && props.bank && (
          <div style={s.bankBox}>
            <div style={s.boxHeading}>Bank Details</div>
            <div style={s.bankRow}><span style={s.bankLabel}>Account Name</span><span style={s.bankValue}>{props.bank.accountName}</span></div>
            <div style={s.bankRow}><span style={s.bankLabel}>Account Number</span><span style={s.bankValue}>{props.bank.accountNumber}</span></div>
            <div style={s.bankRow}><span style={s.bankLabel}>Bank</span><span style={s.bankValue}>{props.bank.bankName}</span></div>
          </div>
        )}

        {/* Terms */}
        {sections.terms && terms.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Terms and Conditions</div>
            <ol style={{ margin: 0, paddingLeft: "16px", color: LINE_LABEL }}>
              {terms.map((t, i) => (
                <li key={i} style={{ marginBottom: "2px" }}>{t}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Client acceptance stamp — only on documents accepted (signed) on the tablet */}
        {props.accepted && (
          <div style={{ ...s.section, display: "flex", justifyContent: "flex-end" }}>
            <div style={{ border: `1px solid ${RULE}`, borderRadius: "6px", padding: "10px 14px", minWidth: "220px" }}>
              <div style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#2e7d32", fontWeight: 700 }}>
                Accepted by the client
              </div>
              {props.accepted.signatureUrl ? (
                <img src={props.accepted.signatureUrl} alt="Client signature" style={{ height: "44px", marginTop: "6px", objectFit: "contain" }} />
              ) : null}
              <div style={{ marginTop: "5px", fontSize: "9.5px", color: LINE_LABEL }}>
                {props.accepted.name ? <span style={{ fontWeight: 700, color: INK }}>{props.accepted.name}</span> : "Signed in the studio"}
                {props.accepted.at ? ` · ${props.accepted.at}` : ""}
              </div>
            </div>
          </div>
        )}

        {sections.signature && (
          <div style={{ ...s.section, marginTop: "28px" }}>
            <div style={{ borderTop: `1px solid ${INK}`, width: "180px", paddingTop: "4px", color: MUTED }}>Authorised signature</div>
          </div>
        )}
      </div>

      {/* footer band + disclaimer */}
      {sections.footerBanner && <img src={footerUrl} alt="" style={s.banner} />}
      <div style={s.disclaimer}>This is an electronically generated document, no signature is required.</div>
    </div>
  );
}
