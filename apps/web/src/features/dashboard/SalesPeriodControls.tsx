'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { SalesPeriod, SalesRangeKey } from './sales-performance';

const PRESETS: {
  key: Exclude<SalesRangeKey, 'custom'>;
  label: string;
}[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'month', label: 'This month' },
];

export function SalesPeriodControls({ period }: { period: SalesPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function replace(update: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(update)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function choosePreset(key: Exclude<SalesRangeKey, 'custom'>) {
    replace({ salesRange: key, salesFrom: null, salesTo: null });
  }

  function chooseDate(key: 'salesFrom' | 'salesTo', value: string) {
    replace({
      salesRange: 'custom',
      salesFrom: key === 'salesFrom' ? value : period.from,
      salesTo: key === 'salesTo' ? value : period.to,
    });
  }

  const inputClass =
    'h-8 rounded-[9px] border border-line-2 bg-card px-2 text-[11.5px] font-semibold text-body outline-none [color-scheme:light] hover:border-faint focus:border-brand';

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Sales chart period"
    >
      {PRESETS.map((preset) => {
        const selected = period.range === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={selected}
            onClick={() => choosePreset(preset.key)}
            className={`h-8 rounded-[9px] px-2.5 text-[11.5px] font-bold transition-colors ${
              selected
                ? 'border border-[rgba(30,111,224,0.22)] bg-[rgba(43,140,255,0.12)] text-link'
                : 'border border-line-2 bg-card text-muted hover:border-faint hover:text-body'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
      <input
        type="date"
        aria-label="Sales chart from date"
        value={period.from}
        max={period.to}
        onChange={(event) => chooseDate('salesFrom', event.target.value)}
        className={inputClass}
      />
      <span aria-hidden="true" className="text-[11px] text-faint">
        to
      </span>
      <input
        type="date"
        aria-label="Sales chart to date"
        value={period.to}
        min={period.from}
        onChange={(event) => chooseDate('salesTo', event.target.value)}
        className={inputClass}
      />
    </div>
  );
}
