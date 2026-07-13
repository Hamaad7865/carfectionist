import Link from "next/link";
import { MessageCircle } from "lucide-react";

// At-a-glance: how much of the contact base a campaign can actually reach.
// A contact is reachable when it has a valid phone number and hasn't opted out
// (computed with the same normalization the sender uses). Low reach is a
// data-collection nudge, not an error — the fix is adding phone numbers.
export function ReachabilityBar({
  total,
  reachable,
  noNumber,
  optedOut,
}: {
  total: number;
  reachable: number;
  noNumber: number;
  optedOut: number;
}) {
  const pct = total > 0 ? Math.round((reachable / total) * 100) : 0;

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[rgba(13,167,124,0.12)] text-mint">
            <MessageCircle size={16} />
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="num text-[20px] font-extrabold text-ink-strong">{reachable}</span>
            <span className="text-[13px] text-muted">
              of <span className="num font-semibold text-body">{total}</span> contact{total === 1 ? "" : "s"} reachable on WhatsApp
            </span>
          </div>
        </div>
        <span className="num text-[13px] font-bold text-mint">{pct}%</span>
      </div>

      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-band">
        <div className="h-full rounded-full bg-mint transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {noNumber > 0 && (
          <span className="text-faint">
            <span className="num font-bold text-amber-ink">{noNumber}</span> without a phone number
          </span>
        )}
        {optedOut > 0 && (
          <span className="text-faint">
            <span className="num font-bold text-body">{optedOut}</span> opted out
          </span>
        )}
        {noNumber > 0 && (
          <Link href="/contacts" className="ml-auto font-semibold text-link hover:underline">
            Add numbers on Contacts →
          </Link>
        )}
      </div>
    </div>
  );
}
