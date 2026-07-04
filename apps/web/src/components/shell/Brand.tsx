import { Car } from "lucide-react";

/** Logo tile + wordmark, per the handoff (blue→purple gradient tile). */
export function Brand({ showWordmark = true, subtitle = "BACK OFFICE" }: { showWordmark?: boolean; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grad-logo shadow-brand grid size-9 place-items-center rounded-[10px]">
        <Car size={20} strokeWidth={2} className="text-white" />
      </span>
      {showWordmark && (
        <div className="leading-none">
          <div className="font-display text-[15px] font-extrabold tracking-[0.04em] text-ink-strong">CARFECTIONIST</div>
          <div className="mt-[3px] text-[8px] font-semibold tracking-[0.2em] text-fainter">{subtitle}</div>
        </div>
      )}
    </div>
  );
}
