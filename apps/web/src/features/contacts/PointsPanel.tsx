import { formatMUR } from "@/lib/money";
import { pointsValueCents } from "@/lib/points";
import { muDate } from "@/lib/mu-date";
import type { PointsLedgerEntry } from "@/lib/supabase/queries/contacts";

const REASON_LABEL: Record<string, string> = {
  earned: "Earned",
  redeemed: "Redeemed",
  adjusted: "Adjusted",
  reversed: "Reversed",
};

/** The customer's points balance, what it is worth, and the ledger behind it —
 *  same shell as VehiclesEditor (header + bordered rows, dashed empty state),
 *  same stat-tile markup as the Lifetime spend / Outstanding balance pair
 *  above it on the customer detail page. */
export function PointsPanel({
  balance,
  pointValueRupees,
  history,
}: {
  balance: number;
  pointValueRupees: number;
  history: PointsLedgerEntry[];
}) {
  const worthCents = pointsValueCents(balance, pointValueRupees);

  // What they held AFTER each movement. history arrives newest-first, so row i's
  // balance is today's less everything that happened after it. Derived, never
  // stored: the ledger is the only truth here, and a second stored figure is a
  // second thing that can disagree with it.
  //
  // Written without a running mutation on purpose — the React Compiler rejects
  // one (react-hooks/immutability), and a ledger is short enough that the extra
  // pass costs nothing.
  const running = history.map((entry, i) => ({
    entry,
    balanceAfter: balance - history.slice(0, i).reduce((sum, e) => sum + e.delta, 0),
  }));

  return (
    <>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]">Points</div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-[12px] border border-line p-4">
          <div className="text-[11.5px] font-semibold text-muted">Balance</div>
          <div className="num mt-1.5 text-[20px] font-extrabold text-ink-strong">{balance} pts</div>
        </div>
        <div className="rounded-[12px] border border-line p-4">
          <div className="text-[11.5px] font-semibold text-muted">Worth</div>
          <div className="num mt-1.5 text-[20px] font-extrabold text-ink-strong">{formatMUR(worthCents)}</div>
        </div>
      </div>
      <div className="flex flex-col">
        {history.length === 0 ? (
          <div className="rounded-[11px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">
            No points earned yet.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line-2 px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
              <span className="min-w-0 flex-1">Sale</span>
              <span className="w-16 shrink-0 text-right">Date</span>
              <span className="w-12 shrink-0 text-right">Change</span>
              <span className="w-16 shrink-0 text-right">Balance</span>
            </div>
            {running.map(({ entry: l, balanceAfter }) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-line px-1 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">
                    {l.docNumber ? (
                      <a href={`/sales/${l.docId}`} className="text-link hover:underline">
                        {l.docNumber}
                      </a>
                    ) : (
                      REASON_LABEL[l.reason] ?? l.reason
                    )}
                    {l.docNumber && (
                      <span className="ml-2 text-[11.5px] font-medium text-muted">{REASON_LABEL[l.reason] ?? l.reason}</span>
                    )}
                  </div>
                  {l.note && <div className="truncate text-[11px] text-faint">{l.note}</div>}
                </div>
                <span className="num w-16 shrink-0 text-right text-[11.5px] text-muted">{muDate(l.createdAt)}</span>
                <span className={`num w-12 shrink-0 text-right text-[13px] font-bold ${l.delta >= 0 ? "text-mint" : "text-rose"}`}>
                  {l.delta >= 0 ? "+" : ""}
                  {l.delta}
                </span>
                {/* What they held after this sale — the accumulation, read down the column. */}
                <span className="num w-16 shrink-0 text-right text-[12.5px] font-semibold text-body">{balanceAfter}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
