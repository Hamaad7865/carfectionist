"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PeriodDatePicker, type DateRangeValue } from "./PeriodDatePicker";

/**
 * From/To date range wired to the URL (?from=&to=). Preserves every other
 * search param, so it composes with the report/type/status/method filters.
 *
 * Cashmag-style single "Period date" field: picking stages locally and only
 * the Validate button navigates — one server round-trip for the whole gesture
 * instead of one per keystroke.
 */
export function DateRangeFilter({ label = true }: { label?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  function apply(next: DateRangeValue) {
    const p = new URLSearchParams(sp.toString());
    if (next.from) p.set("from", next.from);
    else p.delete("from");
    if (next.to) p.set("to", next.to);
    else p.delete("to");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">From</span>}
      <PeriodDatePicker from={from} to={to} onValidate={apply} />
      {(from || to) && (
        <button onClick={() => apply({ from: "", to: "" })} className="h-9 px-2 text-[12px] font-semibold text-muted hover:text-body">
          Clear
        </button>
      )}
    </div>
  );
}
