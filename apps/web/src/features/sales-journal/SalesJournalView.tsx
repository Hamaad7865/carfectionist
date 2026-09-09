import { formatMUR } from "@/lib/money";
import type { SalesJournal, JournalInvoiceRef } from "@/lib/supabase/queries/sales-journal";
import { rangeLabel, shortRangeLabel, type Range } from "./periods";

// The Cashmag "Journal de ventes": one period, aggregated once, broken down five
// ways down the page. Every section foots to the same pair of totals — the MONEY
// RECEIVED in the period — so the totals rows are deliberately loud.
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
}: {
  journal: SalesJournal;
  prior?: SalesJournal | null;
  priorRange?: Range | null;
  businessName: string;
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

        <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
          <div className="text-[13px] font-semibold text-[#3d5978]">Total received incl tax</div>
          <div className="num mt-2 text-[32px] font-extrabold text-[#0f2f5e]">{money(j.totalInclCents)}</div>
          <div className="num mt-1 text-[12.5px] font-medium text-[#3d5978]">Avg {money(j.avgInclCents)}</div>
          {cmp && (
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="num text-[12.5px] font-medium text-[#3d5978]">{money(prior!.totalInclCents)}</span>
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
        <div className="min-w-[560px]">
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
                label={p.label}
                qty={p.n}
                cents={p.cents}
                invoices={p.invoices}
                prior={cmp ? <PriorCell now={p.cents} prev={lookup(prior?.payments, p.label)?.cents ?? 0} /> : null}
              />
            ))
          )}
          {/* Money that arrived this period but settled a bill raised earlier. It IS
              part of the total below — the drawer took it — but it explains why the
              takings and the day's sales differ, so it is called out before the line. */}
          {j.settlingEarlierCents !== 0 && (
            <Drawer
              cols={grid("1fr 150px 180px")}
              label="…of which settled earlier bills"
              cents={j.settlingEarlierCents}
              invoices={j.settlingEarlier}
              muted
              prior={cmp ? <PriorCell now={j.settlingEarlierCents} prev={prior!.settlingEarlierCents} /> : null}
            />
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
              label="On account (not yet paid)"
              note={`of ${money(j.paymentsTotalCents)} invoiced`}
              cents={j.onAccountCents}
              invoices={j.onAccount}
              tone="text-amber-ink"
              divider
              prior={cmp ? <PriorCell now={j.onAccountCents} prev={prior!.onAccountCents} /> : null}
            />
          )}
        </div>
      </Card>

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
  cols, label, note, qty, cents, invoices, prior, tone = "text-ink", muted = false, divider = false,
}: {
  cols: React.CSSProperties;
  label: string;
  /** Quiet second line under the label — context that is not itself a figure. */
  note?: string;
  qty?: number;
  cents: number;
  invoices: JournalInvoiceRef[];
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
        {invoices.map((r) => (
          <div
            key={r.id}
            className="grid items-center gap-3 px-5 py-2 pl-10 text-[12.5px] text-muted"
            style={{ gridTemplateColumns: "1fr 150px 180px" }}
          >
            <span className="flex items-center gap-2 truncate">
              <span className="num font-semibold text-body">{r.number ?? "—"}</span>
              <span className="truncate">{r.customer ?? "Walk-in customer"}</span>
              {/* Why this bill is here at all when it was raised in another period. */}
              {r.earlier && (
                <span className="shrink-0 rounded-full bg-band px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-ink">
                  billed {r.businessDay}
                </span>
              )}
            </span>
            <span />
            <span className="num text-right font-semibold text-body">{money(r.cents)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
