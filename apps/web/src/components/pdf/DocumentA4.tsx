import type { CSSProperties } from "react";
import { formatMUR } from "@/lib/money";
import { amountInWordsMUR } from "@/lib/number-to-words";
import { effectiveSections, type DocType, type SectionFlags } from "@/lib/pdf/fiscal-lock";

/**
 * The Diamondbrite A4 document — one template for quotes and invoices. Pure and
 * self-contained (inline styles + one embedded print stylesheet) so it renders
 * identically in the live preview iframe and in the server-side PDF. Deliberately
 * isolated from the app's Tailwind so a restyle can never reflow a fiscal document.
 */

export interface DocLineView {
  title: string;
  detail?: string | null;
  qty: number;
  rateCents: number;
  amountCents: number;
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
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  bank?: { accountName: string; accountNumber: string; bankName: string } | null;
  terms?: string[];
  assets?: { headerBannerUrl?: string | null; footerBannerUrl?: string | null; logoUrl?: string | null };
  sectionConfig?: Partial<SectionFlags>;
  customFields?: { label: string; value: string }[];
}

const INK = "#14181c";
const MUTED = "#5a6570";
const HAIR = "#d7dde2";
const BAND = "#0f1316";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
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
  } as CSSProperties,
  band: { background: BAND, color: "#fff" } as CSSProperties,
  headerBanner: {
    background: BAND,
    color: "#fff",
    height: "104px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 18mm",
    backgroundSize: "cover",
    backgroundPosition: "center",
  } as CSSProperties,
  body: { padding: "10mm 18mm 0" } as CSSProperties,
  title: { fontSize: "26px", fontWeight: 800, letterSpacing: "0.02em", margin: 0 } as CSSProperties,
  trading: { color: MUTED, fontSize: "11px", marginTop: "2px" } as CSSProperties,
  metaRow: { display: "flex", gap: "26px", marginTop: "10px", fontSize: "10px" } as CSSProperties,
  metaLabel: { color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "8.5px" } as CSSProperties,
  metaValue: { fontWeight: 700 } as CSSProperties,
  boxes: { display: "flex", gap: "12px", marginTop: "16px" } as CSSProperties,
  box: { flex: 1, border: `1px solid ${HAIR}`, borderRadius: "6px", padding: "10px 12px" } as CSSProperties,
  boxLabel: {
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontSize: "8.5px",
    marginBottom: "5px",
  } as CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", marginTop: "18px", fontSize: "10.5px" } as CSSProperties,
  th: {
    background: BAND,
    color: "#fff",
    textAlign: "left",
    padding: "8px 12px",
    fontSize: "9px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
  } as CSSProperties,
  thNum: { textAlign: "right" } as CSSProperties,
  td: { padding: "9px 12px", borderBottom: `1px solid ${HAIR}`, verticalAlign: "top" } as CSSProperties,
  tdNum: {
    padding: "9px 12px",
    borderBottom: `1px solid ${HAIR}`,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  } as CSSProperties,
  lineTitle: { fontWeight: 700 } as CSSProperties,
  lineDetail: { color: MUTED, whiteSpace: "pre-wrap", marginTop: "2px", fontSize: "9.5px" } as CSSProperties,
  totalsWrap: { display: "flex", justifyContent: "space-between", marginTop: "16px", gap: "24px" } as CSSProperties,
  words: { flex: 1, fontSize: "9.5px" } as CSSProperties,
  wordsLabel: { color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "8.5px" } as CSSProperties,
  wordsValue: { fontWeight: 700, marginTop: "3px" } as CSSProperties,
  totalsBox: { width: "230px" } as CSSProperties,
  totalRow: { display: "flex", justifyContent: "space-between", padding: "5px 0" } as CSSProperties,
  grandRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "9px 12px",
    marginTop: "4px",
    background: BAND,
    color: "#fff",
    borderRadius: "5px",
    fontWeight: 800,
    fontSize: "13px",
  } as CSSProperties,
  section: { marginTop: "18px" } as CSSProperties,
  sectionLabel: {
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontSize: "8.5px",
    marginBottom: "5px",
  } as CSSProperties,
  footerBanner: { marginTop: "20px", background: BAND, color: "#fff", height: "56px", backgroundSize: "cover" } as CSSProperties,
};

const PRINT_CSS = `
@page { size: A4; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: "2px" }}>
      <span style={{ color: MUTED }}>{label}: </span>
      <span>{value}</span>
    </div>
  );
}

export function DocumentA4(props: DocumentA4Props) {
  const { docType, number, issueDate, createdBy, from, billTo, lines } = props;
  const sections = effectiveSections(props.sectionConfig ?? {}, docType);
  const title = docType === "quote" ? "Quotation" : docType === "credit_note" ? "Credit Note" : "Invoice";
  const terms = props.terms ?? [];

  return (
    <div style={s.page}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Header banner + logo */}
      <div
        style={{
          ...s.headerBanner,
          ...(props.assets?.headerBannerUrl ? { backgroundImage: `url(${props.assets.headerBannerUrl})` } : {}),
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "0.22em" }}>{from.tradingName.toUpperCase()}</div>
        {props.assets?.logoUrl ? (
          <img src={props.assets.logoUrl} alt="" style={{ height: "44px", objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: "9px", color: "#9aa4ad", letterSpacing: "0.14em" }}>DIAMONDBRITE</div>
        )}
      </div>

      <div style={s.body}>
        <h1 style={s.title}>{title}</h1>
        <div style={s.trading}>{from.tradingName}</div>

        <div style={s.metaRow}>
          <div>
            <div style={s.metaLabel}>Number</div>
            <div style={s.metaValue}>{number ?? "DRAFT"}</div>
          </div>
          <div>
            <div style={s.metaLabel}>Date</div>
            <div style={s.metaValue}>{formatDate(issueDate)}</div>
          </div>
          <div>
            <div style={s.metaLabel}>Created By</div>
            <div style={s.metaValue}>{createdBy}</div>
          </div>
          {(props.customFields ?? []).filter((f) => f.label.trim() !== "").map((f, i) => (
            <div key={i}>
              <div style={s.metaLabel}>{f.label}</div>
              <div style={s.metaValue}>{f.value || "—"}</div>
            </div>
          ))}
        </div>

        {/* From / For */}
        <div style={s.boxes}>
          {sections.from && (
            <div style={s.box}>
              <div style={s.boxLabel}>From</div>
              <div style={{ fontWeight: 700 }}>{from.legalName}</div>
              <Field label="Country" value={from.country} />
              <Field label="BRN" value={from.brn} />
              <Field label="Email" value={from.email} />
              <Field label="Phone" value={from.phone} />
              <Field label="VAT No" value={from.vatNo} />
            </div>
          )}
          <div style={s.box}>
            <div style={s.boxLabel}>For</div>
            <div style={{ fontWeight: 700 }}>{billTo.name || "—"}</div>
            <Field label="Country" value={billTo.country} />
          </div>
        </div>

        {/* Lines — Item / Quantity / Rate / Amount */}
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Item</th>
              <th style={{ ...s.th, ...s.thNum }}>Quantity</th>
              <th style={{ ...s.th, ...s.thNum }}>Rate</th>
              <th style={{ ...s.th, ...s.thNum }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={s.td}>
                  <div style={s.lineTitle}>{l.title}</div>
                  {l.detail ? <div style={s.lineDetail}>{l.detail}</div> : null}
                </td>
                <td style={s.tdNum}>{l.qty}</td>
                <td style={s.tdNum}>{formatMUR(l.rateCents)}</td>
                <td style={s.tdNum}>{formatMUR(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals + amount in words */}
        <div style={s.totalsWrap}>
          <div style={s.words}>
            {sections.totalInWords && (
              <>
                <div style={s.wordsLabel}>Total (in words):</div>
                <div style={s.wordsValue}>{amountInWordsMUR(props.totalCents)}</div>
              </>
            )}
          </div>
          <div style={s.totalsBox}>
            <div style={s.totalRow}>
              <span style={{ color: MUTED }}>Subtotal</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMUR(props.subtotalCents)}</span>
            </div>
            <div style={s.totalRow}>
              <span style={{ color: MUTED }}>VAT</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMUR(props.vatCents)}</span>
            </div>
            <div style={s.grandRow}>
              <span>Total (MUR)</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMUR(props.totalCents)}</span>
            </div>
          </div>
        </div>

        {/* Bank details */}
        {sections.bankDetails && props.bank && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Bank Details</div>
            <Field label="Account Name" value={props.bank.accountName} />
            <Field label="Account Number" value={props.bank.accountNumber} />
            <Field label="Bank" value={props.bank.bankName} />
          </div>
        )}

        {/* Terms */}
        {sections.terms && terms.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Terms and Conditions</div>
            <ol style={{ margin: 0, paddingLeft: "16px", color: MUTED }}>
              {terms.map((t, i) => (
                <li key={i} style={{ marginBottom: "2px" }}>
                  {t}
                </li>
              ))}
            </ol>
          </div>
        )}

        {sections.signature && (
          <div style={{ ...s.section, marginTop: "28px" }}>
            <div style={{ borderTop: `1px solid ${INK}`, width: "180px", paddingTop: "4px", color: MUTED }}>
              Authorised signature
            </div>
          </div>
        )}
      </div>

      {/* Footer banner */}
      {sections.footerBanner && (
        <div
          style={{
            ...s.footerBanner,
            ...(props.assets?.footerBannerUrl ? { backgroundImage: `url(${props.assets.footerBannerUrl})` } : {}),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            letterSpacing: "0.2em",
            fontSize: "10px",
            color: "#9aa4ad",
          }}
        >
          {props.assets?.footerBannerUrl ? "" : "DIAMONDBRITE FOREVER"}
        </div>
      )}
    </div>
  );
}
