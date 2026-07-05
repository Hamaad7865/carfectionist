"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * From/To date range wired to the URL (?from=&to=). Preserves every other
 * search param, so it composes with the report/type/status/method filters.
 */
export function DateRangeFilter({ label = true }: { label?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  function setDates(next: { from?: string; to?: string }) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  const cls =
    "h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand [color-scheme:light]";

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">From</span>}
      <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setDates({ from: e.target.value })} className={cls} />
      <span className="text-[12px] text-faint">→</span>
      <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setDates({ to: e.target.value })} className={cls} />
      {(from || to) && (
        <button onClick={() => setDates({ from: "", to: "" })} className="h-9 px-2 text-[12px] font-semibold text-muted hover:text-body">
          Clear
        </button>
      )}
    </div>
  );
}
