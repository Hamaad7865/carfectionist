import Link from "next/link";
import { Receipt } from "lucide-react";
import { formatMUR } from "@/lib/money";
import { btn } from "@/components/ui/button";
import { platesLabel, qtyLabel, servicesLabel, type SalesJournal, type JournalInvoiceRef, type ServiceDone } from "@/lib/supabase/queries/sales-journal";
import { rangeLabel, shortRangeLabel, type Range } from "./periods";

// The Cashmag "Journal de ventes": one period, aggregated once, broken down five
// ways down the page — plus a memo for money that settled earlier bills, kept
// out of Payments so the takings and the day's sales reconcile by eye. Every
// footing section answers the same pair of totals — the MONEY RECEIVED in the
// period — so the totals rows are deliberately loud. The memo never foots to
// the headline: it is already inside the Payments total.
//
// Server component: the whole screen is URL state, so there is nothing to hydrate.

const money = (c: number) => formatMUR(c);

/** Percent change vs the comparison period. Null when there is no base to compare to. */
function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const pct = pctChange(now, prev);
  const up = now > prev;
  const flat = now === prev;
  const tone = flat ? "text-faint" : up ? "text-mint" : "text-pink";
  return (
    <span className={`num text-[12px] font-bold ${tone}`}>
      {pct === null ? "new" : `${flat ? "" : up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

/** Prior figure + variance, as the trailing cell of a compared row. */
function PriorCell({ now, prev }: { now: number; prev: number }) {
  return (
    <span className="flex items-baseline justify-end gap-2">
      <span className="num text-[13px] font-medium text-faint">{money(prev)}</span>
      <Delta now={now} prev={prev} />
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="grad-rail h-[15px] w-[3px] rounded-[3px]" />
        <span className="font-display text-[14px] font-bold uppercase tracking-[0.06em] text-ink-strong">{title}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const HEAD = "grid gap-3 border-b border-line bg-band px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-th";
const ROW = "grid items-center gap-3 border-b border-line px-5 py-3 text-[13.5px] font-medium";
const TOTAL = "grid items-center gap-3 bg-sub px-5 py-3 text-[14px] font-bold text-ink";

/**
 * Merge current rows with the comparison period's, keyed by label, so a line
 * that sold last month but not this one still shows (at zero) instead of
 * silently vanishing from the comparison.
 */
function merged<T extends { label: string }>(now: T[], prev: T[] | undefined, zero: (label: string) => T): T[] {
  if (!prev) return now;
  const seen = new Set(now.map((r) => r.label));
  return [...now, ...prev.filter((r) => !seen.has(r.label)).map((r) => zero(r.label))];
}
const lookup = <T extends { label: string }>(rows: T[] | undefined, label: string): T | undefined =>
  rows?.find((r) => r.label === label);

export function SalesJournalView({
  journal: j,
  prior,
  priorRange,
  businessName,
  query,
}: {
  journal: SalesJournal;
  prior?: SalesJournal | null;
  priorRange?: Range | null;
  businessName: string;
  /** The current report query (period + filters) — receipt links hang ?receipt= off it. */
  query: string;
}) {
  const cmp = !!prior;
  /** Append the comparison column to a grid template when comparing. */
  const grid = (base: string) => ({ gridTemplateColumns: cmp ? `${base} 170px` : base });

  return (
    <div className="flex flex-col gap-4">
      {/* ── period header ── */}
      <div>
        <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-faint">{businessName}</div>
        <h2 className="font-display text-[26px] font-extrabold leading-tight text-ink-strong">
          {rangeLabel({ from: j.from, to: j.to })}
        </h2>
        {cmp && priorRange && (
          <div className="mt-1 text-[13px] font-medium text-muted">
            compared with <span className="font-semibold text-body">{shortRangeLabel(priorRange)}</span>
          </div>
        )}
        {/* The basis, stated where nobody can miss it: this is money received, not
            invoices issued. Anyone filing the VAT figures needs to know that. */}
        <div className="mt-1 text-[12px] font-medium text-faint">
          Cash basis — every figure is money received in this period, not invoices issued.
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[13px] font-semibold text-muted">Bills settled</div>
          <div className="num mt-2 text-[32px] font-extrabold text-ink-strong">{j.tickets}</div>
          {cmp && (
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="num text-[12.5px] font-medium text-faint">{prior!.tickets}</span>
              <Delta now={j.tickets} prev={prior!.tickets} />
            </div>
          )}
        </div>

        <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,var(--hero-a),var(--hero-b))" }}>
          <div className="text-[13px] font-semibold text-hero-sub">Total received incl tax</div>
          <div className="num mt-2 text-[32px] font-extrabold text-hero-ink">{money(j.totalInclCents)}</div>
          <div className="num mt-1 text-[12.5px] font-medium text-hero-sub">Avg {money(j.avgInclCents)}</div>
          {cmp && (
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="num text-[12.5px] font-medium text-hero-sub">{money(prior!.totalInclCents)}</span>
              <Delta now={j.totalInclCents} prev={prior!.totalInclCents} />
            </div>
          )}
        </div>

        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[13px] font-semibold text-muted">Clients</div>
          <div className="num mt-2 text-[32px] font-extrabold text-ink-strong">{j.clients}</div>
          <div className="num mt-1 text-[12.5px] font-medium text-faint">
            {money(j.clientInclCents)} · Avg {money(j.clientAvgInclCents)}
          </div>
        </div>
      </div>

      {/* ── 1. Sale methods ── */}
      <Card title="Sale methods">
        <div className="min-w-[620px]">
          <div className={HEAD} style={grid("1fr 150px 160px 160px")}>
            <span>Sale method</span>
            <span className="text-right">Bills settled</span>
            <span className="text-right">Total excl tax</span>
            <span className="text-right">Total incl tax</span>
            {cmp && <span className="text-right">Prior incl</span>}
          </div>
          {j.saleMethods.length === 0 ? (
            <Empty />
          ) : (
            merged(j.saleMethods, prior?.saleMethods, (label) => ({ label, tickets: 0, exclCents: 0, inclCents: 0 })).map((m) => (
              <div key={m.label} className={ROW} style={grid("1fr 150px 160px 160px")}>
                <span className="font-semibold text-body">{m.label}</span>
                <span className="num text-right text-muted">{m.tickets}</span>
                <span className="num text-right text-muted">{money(m.exclCents)}</span>
                <span className="num text-right font-bold text-ink">{money(m.inclCents)}</span>
                {cmp && <PriorCell now={m.inclCents} prev={lookup(prior?.saleMethods, m.label)?.inclCents ?? 0} />}
              </div>
            ))
          )}
          <div className={TOTAL} style={grid("1fr 150px 160px 160px")}>
            <span>Total</span>
            <span className="num text-right">{j.tickets}</span>
            <span className="num text-right">{money(j.totalExclCents)}</span>
            <span className="num text-right text-brand">{money(j.totalInclCents)}</span>
            {cmp && <PriorCell now={j.totalInclCents} prev={prior!.totalInclCents} />}
          </div>
        </div>
      </Card>

      {/* ── 2. Taxes ── */}
      <Card title="Taxes">
        <div className="min-w-[720px]">
          <div className={HEAD} style={grid("1fr 70px 140px 140px 150px 150px")}>
            <span>Label</span>
            <span className="text-right">Rate</span>
            <span className="text-right">Tax</span>
            <span className="text-right">Discount</span>
            <span className="text-right">Excluding tax</span>
            <span className="text-right">With tax</span>
            {cmp && <span className="text-right">Prior incl</span>}
          </div>
          {j.taxes.length === 0 ? (
            <Empty />
          ) : (
            j.taxes.map((t) => (
              <div key={t.ratePct} className={ROW} style={grid("1fr 70px 140px 140px 150px 150px")}>
                <span className="font-semibold text-body">{t.label}</span>
                <span className="num text-right text-muted">{t.ratePct}%</span>
                <span className="num text-right text-muted">{money(t.taxCents)}</span>
                <span className="num text-right italic text-amber-ink">{t.discountCents ? money(t.discountCents) : "—"}</span>
                <span className="num text-right text-muted">{money(t.exclCents)}</span>
                <span className="num text-right font-bold text-ink">{money(t.inclCents)}</span>
                {cmp && <PriorCell now={t.inclCents} prev={lookup(prior?.taxes, t.label)?.inclCents ?? 0} />}
              </div>
            ))
          )}
          <div className={TOTAL} style={grid("1fr 70px 140px 140px 150px 150px")}>
            <span>Total</span>
            <span />
            <span className="num text-right">{money(j.vatCents)}</span>
            <span className="num text-right text-amber-ink">{money(j.taxes.reduce((a, t) => a + t.discountCents, 0))}</span>
            <span className="num text-right">{money(j.totalExclCents)}</span>
            <span className="num text-right text-brand">{money(j.totalInclCents)}</span>
            {cmp && <PriorCell now={j.totalInclCents} prev={prior!.totalInclCents} />}
          </div>
        </div>
      </Card>

      {/* ── 3. Payments ── */}
      <Card title="Payments">
        {/* Wide enough for the bill table that opens under each method. */}
        <div className="min-w-[880px]">
          <div className={HEAD} style={grid("1fr 150px 180px")}>
            <span>Payment method</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Amount</span>
            {cmp && <span className="text-right">Prior</span>}
          </div>
          {j.payments.length === 0 ? (
            <Empty label="No money was taken in this period." />
          ) : (
            j.payments.map((p) => (
              <Drawer
                key={p.method}
                cols={grid("1fr 150px 180px")}
                cmp={cmp}
                label={p.label}
                qty={p.n}
                cents={p.cents}
                invoices={p.invoices}
                query={query}
                prior={cmp ? <PriorCell now={p.cents} prev={lookup(prior?.payments, p.label)?.cents ?? 0} /> : null}
              />
            ))
          )}
          {/* THE TOTAL OF THIS CARD IS THE MONEY, and since the whole report went
              cash-basis (the owner's call, 9 Sep 2026) that figure is also the
              report's headline: sale methods, taxes, categories and user logs all
              foot to this same number now. What was INVOICED survives only in the
              "of Rs X invoiced" note below — the bridge that reconciles the money
              with the bills, by eye. */}
          <div className={TOTAL} style={grid("1fr 150px 180px")}>
            <span>Total</span>
            <span />
            <span className="num text-right text-brand">{money(j.paymentsSubtotalCents)}</span>
            {cmp && <PriorCell now={j.paymentsSubtotalCents} prev={prior!.paymentsSubtotalCents} />}
          </div>
          {/* Below the total on purpose: money still owed is not money taken. */}
          {j.onAccountCents !== 0 && (
            <Drawer
              cols={grid("1fr 150px 180px")}
              cmp={cmp}
              label="On account (not yet paid)"
              note={`of ${money(j.paymentsTotalCents)} invoiced`}
              cents={j.onAccountCents}
              invoices={j.onAccount}
              query={query}
              tone="text-amber-ink"
              divider
              prior={cmp ? <PriorCell now={j.onAccountCents} prev={prior!.onAccountCents} /> : null}
            />
          )}
        </div>
      </Card>

      {/* ── 3b. Settled earlier bills ── */}
      {/* Money that arrived this period but settled a bill raised earlier. It IS
          part of the Payments total above — the drawer took it — but it lives in
          its own component so the takings and the day's sales reconcile by eye:
          this is why the two can differ. */}
      {j.settlingEarlierCents !== 0 && (
        <Card title="Settled earlier bills">
          <div className="min-w-[880px]">
            <div className={HEAD} style={grid("1fr 150px 180px")}>
              <span>Bill</span>
              <span />
              <span className="text-right">Amount</span>
              {cmp && <span className="text-right">Prior</span>}
            </div>
            <Drawer
              cols={grid("1fr 150px 180px")}
              cmp={cmp}
              label="Settled earlier bills"
              cents={j.settlingEarlierCents}
              invoices={j.settlingEarlier}
              query={query}
              muted
              prior={cmp ? <PriorCell now={j.settlingEarlierCents} prev={prior!.settlingEarlierCents} /> : null}
            />
            <div className={TOTAL} style={grid("1fr 150px 180px")}>
              <span>Total</span>
              <span />
              <span className="num text-right text-brand">{money(j.settlingEarlierCents)}</span>
              {cmp && <PriorCell now={j.settlingEarlierCents} prev={prior!.settlingEarlierCents} />}
            </div>
          </div>
        </Card>
      )}

      {/* ── 4. Categories ── */}
      <Card title="Categories">
        <div className="min-w-[660px]">
          <div className={HEAD} style={grid("1fr 110px 100px 160px 160px")}>
            <span>Label</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">%</span>
            <span className="text-right">Excluding tax</span>
            <span className="text-right">With tax</span>
            {cmp && <span className="text-right">Prior incl</span>}
          </div>
          {j.categories.length === 0 ? (
            <Empty />
          ) : (
            merged(j.categories, prior?.categories, (label) => ({ label, qty: 0, pct: 0, exclCents: 0, inclCents: 0 })).map((c) => (
              <div key={c.label} className={ROW} style={grid("1fr 110px 100px 160px 160px")}>
                <span className="font-semibold text-body">{c.label}</span>
                <span className="num text-right text-muted">{Number.isInteger(c.qty) ? c.qty : c.qty.toFixed(2)}</span>
                <span className="num text-right italic text-muted">{c.pct.toFixed(2)}%</span>
                <span className="num text-right text-muted">{money(c.exclCents)}</span>
                <span className="num text-right font-bold text-ink">{money(c.inclCents)}</span>
                {cmp && <PriorCell now={c.inclCents} prev={lookup(prior?.categories, c.label)?.inclCents ?? 0} />}
              </div>
            ))
          )}
          <div className={TOTAL} style={grid("1fr 110px 100px 160px 160px")}>
            <span>Total</span>
            <span />
            <span />
            <span className="num text-right">{money(j.totalExclCents)}</span>
            <span className="num text-right text-brand">{money(j.totalInclCents)}</span>
            {cmp && <PriorCell now={j.totalInclCents} prev={prior!.totalInclCents} />}
          </div>
        </div>
      </Card>

      {/* ── 5. User logs ── */}
      <Card title="User logs">
        <div className="min-w-[620px]">
          <div className={HEAD} style={grid("1fr 150px 160px 160px")}>
            <span>Label</span>
            <span className="text-right">Bills settled</span>
            <span className="text-right">Excluding tax</span>
            <span className="text-right">With tax</span>
            {cmp && <span className="text-right">Prior incl</span>}
          </div>
          {j.users.length === 0 ? (
            <Empty />
          ) : (
            merged(j.users, prior?.users, (label) => ({ label, tickets: 0, exclCents: 0, inclCents: 0 })).map((u) => (
              <div key={u.label} className={ROW} style={grid("1fr 150px 160px 160px")}>
                <span className="font-semibold text-body">{u.label}</span>
                <span className="num text-right text-muted">{u.tickets}</span>
                <span className="num text-right text-muted">{money(u.exclCents)}</span>
                <span className="num text-right font-bold text-ink">{money(u.inclCents)}</span>
                {cmp && <PriorCell now={u.inclCents} prev={lookup(prior?.users, u.label)?.inclCents ?? 0} />}
              </div>
            ))
          )}
          <div className={TOTAL} style={grid("1fr 150px 160px 160px")}>
            <span>Total</span>
            <span className="num text-right">{j.tickets}</span>
            <span className="num text-right">{money(j.totalExclCents)}</span>
            <span className="num text-right text-brand">{money(j.totalInclCents)}</span>
            {cmp && <PriorCell now={j.totalInclCents} prev={prior!.totalInclCents} />}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Empty({ label = "Nothing in this period." }: { label?: string }) {
  return <div className="px-5 py-10 text-center text-[14.5px] font-medium text-faint">{label}</div>;
}

/**
 * A money row that opens to show the bills behind it.
 *
 * Native <details>, not a client component: this whole screen is a server component
 * whose state lives in the URL, and one expandable row is not worth shipping
 * JavaScript for. It also means the rows stay open when the page is printed.
 */
function Drawer({
  cols, cmp, label, note, qty, cents, invoices, query, prior, tone = "text-ink", muted = false, divider = false,
}: {
  cols: React.CSSProperties;
  /** Comparing with a prior period — the bill table keeps that column too, so amounts stay aligned. */
  cmp: boolean;
  label: string;
  /** Quiet second line under the label — context that is not itself a figure. */
  note?: string;
  qty?: number;
  cents: number;
  invoices: JournalInvoiceRef[];
  /** Current report query — receipt links hang ?receipt= off it, staying on this screen. */
  query: string;
  prior?: React.ReactNode;
  tone?: string;
  muted?: boolean;
  /** Sits BELOW the card's total: a rule above it says "this is not in that figure". */
  divider?: boolean;
}) {
  const head = (
    <div
      className={`${ROW} ${muted ? "italic text-muted" : ""} ${divider ? "border-t border-line" : ""}`}
      style={cols}
    >
      <span className={muted ? "" : "font-semibold text-body"}>
        <span className="flex items-center gap-1.5">
          {invoices.length > 0 && (
            <span className="select-none text-[10px] text-faint transition-transform group-open:rotate-90">▶</span>
          )}
          {label}
          {invoices.length > 0 && (
            <span className="num text-[11.5px] font-medium text-faint">
              ({invoices.length} {invoices.length === 1 ? "bill" : "bills"})
            </span>
          )}
        </span>
        {note && <span className="mt-0.5 block pl-[18px] text-[11.5px] font-medium text-faint">{note}</span>}
      </span>
      <span className="num text-right text-muted">{qty ?? ""}</span>
      <span className={`num text-right font-bold ${tone}`}>{money(cents)}</span>
      {prior}
    </div>
  );

  // Nothing to open into — render the plain row rather than an empty disclosure.
  if (invoices.length === 0) return head;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
      <div className="border-b border-line bg-sub">
        <div
          className={`${BILL_ROW} border-b border-line py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint`}
          style={billGrid(cmp)}
        >
          <span />
          <span>Bill</span>
          <span>Customer</span>
          <span>Vehicle</span>
          <span>Services</span>
          <span />
          <span className="text-right">Amount</span>
          {cmp && <span />}
        </div>
        <div className="divide-y divide-line">
          {invoices.map((r) => (
            <BillRow key={r.id} r={r} query={query} cmp={cmp} />
          ))}
        </div>
      </div>
    </details>
  );
}

// ── The bill table inside an opened money row ────────────────────────────────
// One fixed set of columns, so every bill number, plate, service and amount sits
// under its heading instead of trailing wherever the text before it ended. The
// Amount column is the card's own 180px (and the comparison's 170px follows it),
// so each bill's figure lines up under the method's total above.
const BILL_COLS = "14px 92px minmax(120px,1.1fr) 132px minmax(150px,1.5fr) 92px 180px";
const billGrid = (cmp: boolean): React.CSSProperties => ({ gridTemplateColumns: cmp ? `${BILL_COLS} 170px` : BILL_COLS });
const BILL_ROW = "grid items-center gap-3 py-2.5 pl-10 pr-5";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-20" → "20 Oct" — short enough to sit under a bill number. */
const shortDay = (day: string) => {
  const [, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""}`;
};

/** A service without its car — the Vehicle column already says which car. */
const nameAndQty = (s: ServiceDone) => `${s.name}${s.qty !== 1 ? ` ×${qtyLabel(s.qty)}` : ""}`;

const Dash = () => <span className="text-faint">—</span>;

/** A plate, styled like a number plate so it reads at a glance. */
function PlateChip({ plate, title = "Vehicle" }: { plate: string; title?: string }) {
  return (
    <span
      title={title}
      className="num shrink-0 truncate rounded border border-line-2 bg-card px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-body"
    >
      {plate}
    </span>
  );
}

/**
 * One bill in the table. A bill with one service shows it in place; one with
 * several (or several cars) opens — the owner's second dropdown (6 Nov 2026) —
 * to a row per service, each under the Services column and, on a multi-car bill,
 * its car under Vehicle. A shelf sale is a plain row with dashes.
 *
 * Native <details>: the bill-number and Receipt links inside the summary are
 * interactive content, so clicking them navigates without toggling, and a click
 * anywhere else on the row opens it.
 */
function BillRow({ r, query, cmp }: { r: JournalInvoiceRef; query: string; cmp: boolean }) {
  const opens = r.services.length > 1 || r.plates.length > 1;
  const [first] = r.services;

  const row = (
    <div className={`${BILL_ROW} text-[13px] hover:bg-band/50`} style={billGrid(cmp)}>
      <span className="select-none text-[9px] text-faint">
        {opens && <span className="inline-block transition-transform group-open/bill:rotate-90">▶</span>}
      </span>

      {/* The bill itself: opens the invoice screen (lines, payments, corrections). */}
      <span className="min-w-0 leading-tight">
        <Link href={`/sales/${r.id}`} title={`Open ${r.number ?? "invoice"}`} className="num font-semibold text-brand hover:underline">
          {r.number ?? "—"}
        </Link>
        {/* Why this bill is here at all when it was raised in another period. */}
        {r.earlier && (
          <span className="mt-0.5 block text-[10.5px] font-semibold text-amber-ink" title={`Billed ${r.businessDay}`}>
            billed {shortDay(r.businessDay)}
          </span>
        )}
      </span>

      <span className={`truncate font-medium ${r.customer ? "text-body" : "text-muted"}`} title={r.customer ?? "Walk-in customer"}>
        {r.customer ?? "Walk-in customer"}
      </span>

      {/* Service bills only: which car the work was on. */}
      <span className="flex min-w-0 items-center gap-1.5">
        {r.plates.length === 0 ? (
          <Dash />
        ) : (
          <>
            <PlateChip plate={r.plates[0]} />
            {r.plates.length > 1 && (
              <span className="num shrink-0 text-[11px] font-semibold text-faint" title={platesLabel(r.plates)}>
                +{r.plates.length - 1}
              </span>
            )}
          </>
        )}
      </span>

      <span className="min-w-0 truncate text-muted" title={r.services.length ? servicesLabel(r.services) : undefined}>
        {!first ? (
          <Dash />
        ) : !opens ? (
          <span className="font-medium text-body">{nameAndQty(first)}</span>
        ) : (
          <>
            {/* Closed: the first service and how many more. Open: the rows below say it all. */}
            <span className="group-open/bill:hidden">
              <span className="font-medium text-body">{nameAndQty(first)}</span>
              {r.services.length > 1 && <span className="text-faint"> +{r.services.length - 1} more</span>}
            </span>
            <span className="hidden font-semibold text-faint group-open/bill:inline">
              {r.services.length} {r.services.length === 1 ? "service" : "services"}
            </span>
          </>
        )}
      </span>

      {/* The paper the customer got: opens as a modal over this screen. */}
      <span>
        <Link
          href={`/sales-journal?${query}&receipt=${encodeURIComponent(r.id)}`}
          scroll={false}
          title="View receipt"
          className={btn("subtle", "sm", "h-7 px-2 text-[11.5px]")}
        >
          <Receipt size={13} /> Receipt
        </Link>
      </span>

      <span className="num text-right font-semibold text-ink">{money(r.cents)}</span>
      {cmp && <span />}
    </div>
  );

  if (!opens) return row;

  return (
    // A NAMED group: this sits inside the method's own <details>, whose plain
    // `group` would otherwise turn this arrow too whenever the method is open.
    <details className="group/bill">
      <summary title="Show the services done" className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {row}
      </summary>
      <div className="pb-2">
        {r.services.map((s, i) => (
          <div key={`${s.name}-${s.plate ?? ""}-${i}`} className={`${BILL_ROW} py-1 text-[12.5px]`} style={billGrid(cmp)}>
            <span />
            <span />
            <span />
            <span className="flex min-w-0 items-center">{s.plate && <PlateChip plate={s.plate} />}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-current text-faint" />
              <span className="truncate font-medium text-body">{s.name}</span>
              {s.qty !== 1 && <span className="num shrink-0 text-faint">×{qtyLabel(s.qty)}</span>}
            </span>
            <span />
            <span />
            {cmp && <span />}
          </div>
        ))}
      </div>
    </details>
  );
}
