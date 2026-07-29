"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  PRESETS, COMPARISONS, rangeForPreset, presetForRange, comparisonRange, shortRangeLabel,
  type PresetKey, type CompareKey, type Range,
} from "./periods";

/**
 * Cashmag's two dropdowns — "Period" and "In comparison to" — plus the from/to
 * inputs, all writing straight to the URL. Native selects on purpose: they are
 * keyboard- and screen-reader-correct for free, and the comparison options need
 * to carry their resolved dates as text ("Previous period — 26 Jul – 27 Jul 2026"),
 * which a native option renders fine.
 *
 * There is no Validate button: changing a control navigates. Cashmag needs one
 * because its filters post a form; ours are URL state, so a round-trip through
 * "now press Validate" would be friction with nothing behind it.
 */
export function PeriodPicker({ range, today, compare }: { range: Range; today: string; compare: CompareKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function push(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  const preset = presetForRange(range, today);

  function onPreset(key: PresetKey) {
    if (key === "custom") return; // "Custom period" is a state, not an action
    const r = rangeForPreset(key, today);
    push({ from: r.from, to: r.to });
  }

  const select =
    "h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-brand";
  const date =
    "h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand [color-scheme:light]";

  return (
    <>
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Period</span>
        <select value={preset} onChange={(e) => onPreset(e.target.value as PresetKey)} className={select} aria-label="Period">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key} disabled={p.key === "custom" && preset !== "custom"}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          aria-label="From date"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && push({ from: e.target.value })}
          className={date}
        />
        <span className="text-[12px] text-faint">→</span>
        <input
          type="date"
          aria-label="To date"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && push({ to: e.target.value })}
          className={date}
        />
      </div>

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Compare</span>
        <select
          value={compare}
          onChange={(e) => push({ cmp: e.target.value === "none" ? undefined : e.target.value })}
          className={select}
          aria-label="In comparison to"
        >
          {COMPARISONS.map((c) => {
            const r = comparisonRange(c.key, range);
            return (
              <option key={c.key} value={c.key}>
                {c.label}
                {r ? ` — ${shortRangeLabel(r)}` : ""}
              </option>
            );
          })}
        </select>
      </label>
    </>
  );
}
