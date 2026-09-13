"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PeriodDatePicker, type DateRangeValue } from "@/components/ui/PeriodDatePicker";
import {
  PRESETS, COMPARISONS, rangeForPreset, presetForRange, comparisonRange, shortRangeLabel,
  type PresetKey, type CompareKey, type Range,
} from "./periods";

/**
 * Cashmag's two dropdowns — "Period" and "In comparison to" — plus the
 * Cashmag-style "Period date" field, all writing straight to the URL. Native
 * selects on purpose: they are keyboard- and screen-reader-correct for free,
 * and the comparison options need to carry their resolved dates as text
 * ("Previous period — 26 Jul – 27 Jul 2026"), which a native option renders
 * fine.
 *
 * The date field stages locally and only its Validate button navigates, so a
 * from+to gesture costs one server round-trip instead of two.
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
    "h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[13.5px] font-semibold text-ink outline-none focus:border-brand";

  function onValidateRange(next: DateRangeValue) {
    // Validate only ever hands back complete ranges; an emptied one means the
    // user cleared the period, which falls back to today.
    if (!next.from || !next.to) {
      const r = rangeForPreset("today", today);
      push({ from: r.from, to: r.to });
      return;
    }
    const [from, to] = next.from <= next.to ? [next.from, next.to] : [next.to, next.from];
    push({ from, to });
  }

  return (
    <>
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Period</span>
        <select value={preset} onChange={(e) => onPreset(e.target.value as PresetKey)} className={select} aria-label="Period">
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key} disabled={p.key === "custom" && preset !== "custom"}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <PeriodDatePicker from={range.from} to={range.to} onValidate={onValidateRange} />

      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Compare</span>
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
