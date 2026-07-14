"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export interface DateRangeFilterProps {
  label?: boolean;
  displayRange?: Readonly<{ from: string; to: string }>;
}

/**
 * From/To date range wired to the URL (?from=&to=). Preserves every other
 * search param, so it composes with the report/type/status/method filters.
 */
export function DateRangeFilter({
  label = true,
  displayRange,
}: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const from = displayRange?.from ?? sp.get("from") ?? "";
  const to = displayRange?.to ?? sp.get("to") ?? "";
  const hasRawRange = sp.has("from") || sp.has("to");

  function setDates(next: { from?: string; to?: string }) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  const cls =
    "h-9 w-[8.75rem] min-w-0 max-w-full rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink [color-scheme:light] focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {label && <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">From</span>}
      <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setDates({ from: e.target.value })} className={cls} />
      <span aria-hidden="true" className="text-[12px] text-faint">→</span>
      <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setDates({ to: e.target.value })} className={cls} />
      {hasRawRange && (
        <button type="button" onClick={() => setDates({ from: "", to: "" })} className="h-9 px-2 text-[12px] font-semibold text-muted hover:text-body">
          Clear
        </button>
      )}
    </div>
  );
}
