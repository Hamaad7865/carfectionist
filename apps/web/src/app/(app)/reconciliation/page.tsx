import Link from "next/link";
import { getStatementOfAccounts } from "@/lib/supabase/queries/reports";
import {
  OVERDUE_GRACE_DAYS,
  ageDays,
  buildCustomerAging,
  buildOverdueCustomers,
  getOpenReceivables,
  getOverpaidInvoices,
} from "@/lib/supabase/queries/reconciliation";
import { StatementSendButton } from "@/features/reports/StatementSendButton";
import { muToday } from "@/lib/mu-date";
import { formatMUR } from "@/lib/money";
import { btn } from "@/components/ui/button";

// Reconciliation — visibility over receivables: who owes, how old each debt
// is, and which rows look wrong. Server-rendered off the URL, like every
// other report. Taking money still happens on the customer's own page.

const TABS = [
  { key: "owed", label: "Owed" },
  { key: "exceptions", label: "Exceptions" },
] as const;

const inputCls =
  "h-9 w-full rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-medium text-ink outline-none focus:border-brand sm:w-[280px]";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "exceptions" ? "exceptions" : "owed";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const today = muToday();

  const [accounts, open, overpaid] = await Promise.all([
    getStatementOfAccounts(),
    getOpenReceivables(),
    getOverpaidInvoices(),
  ]);
  const aging = new Map(buildCustomerAging(open).map((a) => [a.customerId, a]));
  const overdue = buildOverdueCustomers(open, today);

  const matches = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());
  const owed = accounts.filter((c) => matches(c.name));
  const totalOwed = accounts.reduce((s, c) => s + c.balanceCents, 0);
  const overdueCents = overdue.reduce((s, o) => s + o.overdueCents, 0);
  const tabHref = (t: string) =>
    `/reconciliation?tab=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex rounded-[10px] border border-line-2 bg-sub p-0.5">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              scroll={false}
              className={`h-8 rounded-[8px] px-3 text-[12px] font-bold leading-8 ${tab === t.key ? "bg-card text-ink shadow-sm" : "text-muted"}`}
            >
              {t.label}
              {t.key === "exceptions" && overdue.length + overpaid.length > 0 && (
                <span className="num ml-1.5 rounded-full bg-[rgba(214,59,80,0.12)] px-1.5 py-0.5 text-[10px] font-bold text-rose">
                  {overdue.length + overpaid.length}
                </span>
              )}
            </Link>
          ))}
        </div>
        <div className="flex-1" />
        {/* GET form, not client state: searching stays a link, like the rest of the app. */}
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} placeholder="Search customers…" className={inputCls} />
          {q && (
            <Link href={`/reconciliation?tab=${tab}`} className={btn("quiet", "sm")}>
              Clear
            </Link>
          )}
        </form>
      </div>

      {tab === "owed" ? (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div className="rounded-[15px] border border-line bg-card p-5">
              <div className="text-[13px] font-semibold text-muted">Total owed</div>
              <div className="num mt-2 text-[30px] font-extrabold text-ink-strong">{formatMUR(totalOwed)}</div>
            </div>
            <div className="rounded-[15px] border border-line bg-card p-5">
              <div className="text-[13px] font-semibold text-muted">Customers owing</div>
              <div className="num mt-2 text-[30px] font-extrabold text-ink-strong">{accounts.length}</div>
            </div>
            <div className="rounded-[15px] border border-line bg-card p-5">
              <div className="text-[13px] font-semibold text-muted">Unpaid past {OVERDUE_GRACE_DAYS} days</div>
              <div className="num mt-2 text-[30px] font-extrabold text-rose">
                {formatMUR(overdue.reduce((s, o) => s + o.overdueCents, 0))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-line bg-card">
            <div className="hidden gap-3 border-b border-line bg-band px-5 py-3 md:grid md:grid-cols-[1fr_90px_130px_120px_130px_150px]">
              {["Customer", "Bills", "Oldest bill", "Live", "Balance owed", "Statement"].map((h, i) => (
                <span key={h} className={`text-[10.5px] font-bold uppercase tracking-[0.1em] text-th ${i >= 1 ? "text-right" : ""}`}>
                  {h}
                </span>
              ))}
            </div>
            {owed.length === 0 ? (
              <div className="px-5 py-16 text-center text-[13px] text-faint">
                {q ? `Nobody owing matches “${q}”.` : "Nobody owes the shop — every account is settled."}
              </div>
            ) : (
              owed.map((c) => {
                const a = aging.get(c.id);
                const oldest = a?.oldestDate ?? null;
                const age = oldest ? ageDays(oldest, today) : null;
                const stale = age !== null && age > OVERDUE_GRACE_DAYS;
                return (
                  <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-3 md:grid-cols-[1fr_90px_130px_120px_130px_150px] md:px-5">
                    <Link href={`/reconciliation/${c.id}`} className="min-w-0 truncate text-[13.5px] font-bold text-link hover:underline">
                      {c.name}
                    </Link>
                    <span className="num text-right text-[12.5px] text-muted md:text-[13px]">{a?.openBills ?? 0}</span>
                    <span className="hidden md:block md:text-right">
                      {oldest && age !== null ? (
                        <span className={`num rounded-[6px] px-2 py-0.5 text-[11.5px] font-bold ${stale ? "bg-[rgba(214,59,80,0.12)] text-rose" : "bg-sub text-body"}`}>
                          {oldest} · {age}d
                        </span>
                      ) : (
                        <span className="text-[11.5px] font-medium text-faint">carried</span>
                      )}
                    </span>
                    <span className="num hidden text-right text-[13px] text-muted md:block">{formatMUR(c.liveCents)}</span>
                    <span className="num text-right text-[13.5px] font-extrabold text-ink-strong">{formatMUR(c.balanceCents)}</span>
                    <span className="hidden items-center justify-end gap-3 md:flex">
                      <a href={`/api/reports/statement/${c.id}/pdf`} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-link hover:underline">
                        PDF
                      </a>
                      <StatementSendButton customerId={c.id} customerName={c.name} email={c.email} />
                    </span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between gap-2 bg-band px-4 py-3 sm:px-5">
              <span className="text-[12px] font-semibold text-th">
                {owed.length} customer{owed.length === 1 ? "" : "s"}
              </span>
              <span className="text-[13px] font-bold text-body">
                Total <span className="num text-ink-strong">{formatMUR(owed.reduce((s, c) => s + c.balanceCents, 0))}</span>
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-[14px] border border-line bg-card">
            <div className="border-b border-line px-5 py-3.5 font-display text-[15px] font-bold text-ink-strong">
              Overdue — unpaid past {OVERDUE_GRACE_DAYS} days
            </div>
            {overdue.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13.5px] font-medium text-faint">Nothing overdue. Every open bill is within its first month.</div>
            ) : (
              overdue
                .filter((o) => matches(o.customerName))
                .map((o) => (
                  <div key={o.customerId} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[1fr_80px_130px_130px] md:px-5">
                    <Link href={`/reconciliation/${o.customerId}`} className="min-w-0 truncate text-[13.5px] font-bold text-link hover:underline">
                      {o.customerName}
                    </Link>
                    <span className="num text-right text-[12.5px] text-muted">
                      {o.bills} bill{o.bills === 1 ? "" : "s"}
                    </span>
                    <span className="num hidden text-right text-[13px] font-bold text-rose md:block">{formatMUR(o.overdueCents)}</span>
                    <span className="num hidden text-right text-[12px] text-muted md:block">
                      since {o.oldestDate} · {o.maxDaysOverdue}d overdue
                    </span>
                  </div>
                ))
            )}
          </div>

          <div className="overflow-hidden rounded-[14px] border border-line bg-card">
            <div className="border-b border-line px-5 py-3.5 font-display text-[15px] font-bold text-ink-strong">
              Possible overpayments — the till took more than the bill
            </div>
            {overpaid.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13.5px] font-medium text-faint">No paid bill holds more than its total.</div>
            ) : (
              overpaid
                .filter((o) => matches(o.customerName))
                .map((o) => (
                  <div key={o.invoiceId} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[130px_1fr_130px_130px] md:px-5">
                    <Link href={`/sales/${o.invoiceId}`} className="num text-[13px] font-bold text-link hover:underline">
                      {o.number ?? "—"}
                    </Link>
                    <Link href={`/reconciliation/${o.customerId}`} className="min-w-0 truncate text-[13px] font-semibold text-body hover:underline">
                      {o.customerName}
                    </Link>
                    <span className="num hidden text-right text-[12.5px] text-muted md:block">
                      paid {formatMUR(o.paidCents)} of {formatMUR(o.totalCents)}
                    </span>
                    <span className="num text-right text-[13px] font-bold text-amber-ink">+{formatMUR(o.excessCents)}</span>
                  </div>
                ))
            )}
          </div>

          {overdueCents > 0 && (
            <div className="flex items-center justify-end gap-2 px-1 text-[13px] font-bold text-body">
              Overdue total <span className="num text-rose">{formatMUR(overdueCents)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
