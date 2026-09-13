'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { PeriodDatePicker, type DateRangeValue } from '@/components/ui/PeriodDatePicker';
import type { SalesPeriod, SalesRangeKey } from './sales-performance';

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 93;
const PRESETS: {
  key: Exclude<SalesRangeKey, 'custom'>;
  label: string;
}[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'month', label: 'This month' },
];

export type CustomSalesRangeUpdate =
  | { ok: true; href: string }
  | {
      ok: false;
      field: 'salesFrom' | 'salesTo';
      message: string;
    };

function parseIsoDate(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export function buildCustomSalesRangeUpdate(
  pathname: string,
  search: string,
  from: string,
  to: string,
): CustomSalesRangeUpdate {
  const fromMs = parseIsoDate(from);
  if (fromMs === null) {
    return {
      ok: false,
      field: 'salesFrom',
      message: 'Choose a valid start date.',
    };
  }

  const toMs = parseIsoDate(to);
  if (toMs === null) {
    return {
      ok: false,
      field: 'salesTo',
      message: 'Choose a valid end date.',
    };
  }

  if (toMs < fromMs) {
    return {
      ok: false,
      field: 'salesTo',
      message: 'The end date must be on or after the start date.',
    };
  }

  const daysInclusive = Math.floor((toMs - fromMs) / DAY_MS) + 1;
  if (daysInclusive > MAX_CUSTOM_DAYS) {
    return {
      ok: false,
      field: 'salesTo',
      message: `Choose a range of ${MAX_CUSTOM_DAYS} days or less.`,
    };
  }

  const next = new URLSearchParams(search);
  next.set('salesRange', 'custom');
  next.set('salesFrom', from);
  next.set('salesTo', to);

  return { ok: true, href: `${pathname}?${next.toString()}` };
}

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

  // The picker's Validate button is this form's Apply: one navigation for the
  // whole from+to gesture. Invalid ranges never leave the popup — the message
  // reads under the staged dates instead.
  function validateCustomRange(range: DateRangeValue): string | null {
    if (!range.from || !range.to) return 'Choose a start and an end date.';
    const update = buildCustomSalesRangeUpdate(
      pathname,
      searchParams.toString(),
      range.from,
      range.to,
    );
    return update.ok ? null : update.message;
  }

  function applyCustomRange(range: DateRangeValue) {
    if (!range.from || !range.to) {
      replace({ salesRange: 'month', salesFrom: null, salesTo: null });
      return;
    }
    const update = buildCustomSalesRangeUpdate(
      pathname,
      searchParams.toString(),
      range.from,
      range.to,
    );
    if (update.ok) router.replace(update.href, { scroll: false });
  }

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
            className={`h-8 rounded-[9px] px-2.5 text-[12.5px] font-bold transition-colors ${
              selected
                ? 'border border-[rgba(30,111,224,0.22)] bg-[rgba(43,140,255,0.12)] text-link'
                : 'border border-line-2 bg-card text-muted hover:border-faint hover:text-body'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
      <PeriodDatePicker
        key={`${period.range}:${period.from}:${period.to}`}
        from={period.from}
        to={period.to}
        onValidate={applyCustomRange}
        validateRange={validateCustomRange}
      />
    </div>
  );
}
