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
          history.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-b border-line px-1 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">{REASON_LABEL[l.reason] ?? l.reason}</div>
                {l.note && <div className="truncate text-[11px] text-faint">{l.note}</div>}
              </div>
              <span className="num shrink-0 text-[11.5px] text-muted">{muDate(l.createdAt)}</span>
              <span className={`num w-14 shrink-0 text-right text-[13px] font-bold ${l.delta >= 0 ? "text-mint" : "text-rose"}`}>
                {l.delta >= 0 ? "+" : ""}
                {l.delta}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
