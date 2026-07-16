import { formatMUR, rupeesToCents } from "@/lib/money";

/**
 * A4 "Clôture de période" — the till-close Z-report, rendered from the report's FROZEN
 * totals (fixed by the server the moment the till closed, so a reprint months later is
 * identical). Mirrors the thermal slip (ZSlip.kt) section-for-section, and the on-screen
 * tablet view, so all three tell the same story. Pure inline styles, isolated from the
 * app's CSS like the other PDF templates.
 */

// The frozen totals are a jsonb blob; read it defensively, exactly like the slip does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Totals = Record<string, any>;

export interface ZReportA4Props {
  from: { tradingName: string; address: string; brn: string; vatNo: string; phone: string };
  number: string;
  scope: string; // "service" | "day"
  closedAt: string | null;
  note: string | null;
  totals: Totals;
}

const INK = "#101a24";
const MUTED = "#5b6b7a";
const LINE = "#d7dee5";
const HEAD = "#eef2f6";

const money = (rupees: unknown) => formatMUR(rupeesToCents(Number(rupees) || 0));
const int = (v: unknown) => Math.round(Number(v) || 0);
// VAT rate labels are frozen in the owner's Cashmag French — show them in English.
const enVat = (label: unknown) =>
  String(label ?? "").replace("TAUX NORMAL", "STANDARD").replace(/EXON[ÉE]RE/g, "EXEMPT").replace(/^TAUX /, "RATE ");

export function ZReportA4({ from, number, scope, closedAt, note, totals: t }: ZReportA4Props) {
  const methods: Totals[] = Array.isArray(t.methods) ? t.methods : [];
  const categories: Totals[] = Array.isArray(t.categories) ? t.categories : [];
  const cashiers: Totals[] = Array.isArray(t.cashiers) ? t.cashiers : [];
  const vat: Totals[] = Array.isArray(t.vat) ? t.vat : [];
  const accumulation: Totals[] = Array.isArray(t.accumulation) ? t.accumulation : [];
  const services: Totals[] = Array.isArray(t.services) ? t.services : [];
  const credit = t.customer_credit as Totals | undefined;
  const movements = t.movements as Totals | undefined;

  const sec: React.CSSProperties = { marginTop: 18, fontSize: 12, fontWeight: 800, borderBottom: `1px solid ${LINE}`, paddingBottom: 4 };
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", color: INK };
  const sub: React.CSSProperties = { ...row, paddingLeft: 14, color: MUTED };

  const Kv = ({ l, r, indent }: { l: string; r?: string; indent?: boolean }) => (
    <div style={indent ? sub : row}><span>{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{r ?? ""}</span></div>
  );

  const floatBlock = (s: Totals, label: string) => (
    <div key={label} style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{label}</div>
      <Kv l="Initial cash float" r={money(s.float_initial)} />
      <Kv l="Final cash float" r={money(s.float_final)} />
      {s.counted_cash !== undefined && <Kv l="Counted" r={money(s.counted_cash)} />}
      {Number(s.variance) !== 0 && <Kv l="Variance" r={money(s.variance)} />}
    </div>
  );

  return (
    <div style={{ width: "170mm", margin: "0 auto", padding: "12mm 0", fontFamily: "Arial, Helvetica, sans-serif", color: INK }}>
      {/* header */}
      <div style={{ textAlign: "center", borderBottom: `2px solid ${INK}`, paddingBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{from.tradingName}</div>
        {from.address && <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{from.address}</div>}
        <div style={{ fontSize: 10, color: MUTED }}>{[from.brn && `BRN ${from.brn}`, from.vatNo && `VAT ${from.vatNo}`, from.phone].filter(Boolean).join(" · ")}</div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 1, marginTop: 10 }}>CLÔTURE DE PÉRIODE</div>
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
          {number} · {scope === "day" ? "Day" : `Service ${int(t.service_no)}`}
          {closedAt ? ` · ${closedAt.slice(0, 16).replace("T", " ")}` : ""}
        </div>
      </div>

      {/* float(s) */}
      {services.length > 0
        ? services.map((s, i) => floatBlock(s, `Service ${int(s.service_no) || i + 1}`))
        : floatBlock(t, `Service ${int(t.service_no)}`)}

      {/* period */}
      <div style={sec}>Period</div>
      <Kv l="Total incl. tax" r={money(t.total_incl)} />
      <Kv l={`${int(t.tickets)} tickets`} r={`Avg. ${money(t.avg_basket)}`} />
      {int(t.reversals) > 0 && <Kv l={`${int(t.reversals)} reversal${int(t.reversals) === 1 ? "" : "s"}`} />}
      {int(t.voided_bills) > 0 && <Kv l={`${int(t.voided_bills)} deleted bill${int(t.voided_bills) === 1 ? "" : "s"}`} />}

      {/* means of payment */}
      <div style={sec}>Means of payment</div>
      {methods.map((m, i) => {
        const name = String(m.method ?? "?").replace(/_/g, " ").toUpperCase();
        return name === "CASH" ? (
          <div key={i}>
            <Kv l="CASH" r={money(m.gross)} indent />
            <Kv l="CHANGE" r={money(m.change)} indent />
            <Kv l="CASH NET" r={money(m.net)} indent />
          </div>
        ) : (
          <Kv key={i} l={`${int(m.count)} ${name}`} r={money(m.net)} indent />
        );
      })}
      {credit && Number(credit.amount) !== 0 && <Kv l={`${int(credit.count)} CUSTOMER CREDIT`} r={money(credit.amount)} indent />}

      {/* categories */}
      {categories.length > 0 && (
        <>
          <div style={sec}>Categories</div>
          {categories.map((c, i) => <Kv key={i} l={`${int(c.lines)} ${String(c.name ?? "").toUpperCase()}`} r={money(c.incl)} indent />)}
        </>
      )}

      {/* cashiers — also the salespeople (one person rings and sells) */}
      {cashiers.length > 0 && (
        <>
          <div style={sec}>Cashier / salesperson</div>
          {cashiers.map((c, i) => <Kv key={i} l={String(c.name ?? "—")} r={money(c.total)} indent />)}
        </>
      )}

      {/* VAT */}
      {vat.length > 0 && (
        <>
          <div style={sec}>VAT</div>
          {vat.map((v, i) => (
            <div key={i}>
              <Kv l={enVat(v.label)} r={money(v.vat)} indent />
              <div style={{ ...sub, fontSize: 10 }}><span>excl. {money(v.excl)}</span><span>incl. {money(v.incl)}</span></div>
            </div>
          ))}
        </>
      )}

      {/* petty cash paid out of the drawer */}
      {movements && int(movements.count) > 0 && (
        <>
          <div style={sec}>Paid out</div>
          <Kv l={`${int(movements.count)} movement${int(movements.count) === 1 ? "" : "s"}`} r={money(movements.total)} indent />
        </>
      )}

      {/* float accumulation */}
      {accumulation.length > 0 && (
        <>
          <div style={sec}>Float accumulation</div>
          {accumulation.map((a, i) => {
            const name = String(a.method ?? "?").replace(/_/g, " ").toUpperCase();
            return (
              <div key={i}>
                {Number(a.remitted) > 0 && <Kv l={`${name} remitted to bank`} r={money(a.remitted)} indent />}
                <Kv l={`${name} carried on`} r={money(a.float_out)} indent />
              </div>
            );
          })}
        </>
      )}

      {/* sale modes */}
      <div style={sec}>Sale modes</div>
      <Kv l={`SALES [${from.tradingName.toUpperCase()}]`} r={money(t.total_incl)} indent />

      {note && <div style={{ marginTop: 16, fontSize: 10, color: MUTED }}>Note: {note}</div>}
      <div style={{ marginTop: 10, fontSize: 10, color: MUTED }}>Closed by {cashiers[0]?.name ?? "—"}</div>
    </div>
  );
}
