import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  applyDayClick,
  applyMonthClick,
  daysInMonthYMD,
  firstWeekday,
  formatDMY,
  formatRangeLabel,
  isValidISODate,
  monthIndex,
  monthIndexOf,
  pendingToRange,
  PeriodDatePicker,
  placePopover,
  stepMonth,
} from './PeriodDatePicker';

describe('isValidISODate', () => {
  it.each([
    ['2026-09-04', true],
    ['2026-02-29', false], // 2026 is not a leap year
    ['2024-02-29', true],
    ['2026-13-01', false],
    ['2026-09-31', false],
    ['4/9/2026', false],
    ['', false],
  ])('validates %s as %s', (value, expected) => {
    expect(isValidISODate(value)).toBe(expected);
  });
});

describe('formatting', () => {
  it('renders Cashmag day/month/year with no leading zeros', () => {
    expect(formatDMY('2026-09-04')).toBe('4/9/2026');
  });

  it('labels a range like the Cashmag field', () => {
    expect(formatRangeLabel('2026-09-04', '2026-09-04')).toBe('4/9/2026 - 4/9/2026');
    expect(formatRangeLabel('2026-06-03', '2026-06-09')).toBe('3/6/2026 - 9/6/2026');
  });

  it('returns null for an empty range', () => {
    expect(formatRangeLabel('', '')).toBeNull();
  });
});

describe('calendar maths', () => {
  it('knows month lengths without a timezone', () => {
    expect(daysInMonthYMD(2026, 2)).toBe(28);
    expect(daysInMonthYMD(2024, 2)).toBe(29);
    expect(daysInMonthYMD(2026, 9)).toBe(30);
  });

  it('steps months across year boundaries', () => {
    expect(stepMonth(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(stepMonth(2025, 12, 1)).toEqual({ y: 2026, m: 1 });
  });

  it('orders months without a Date', () => {
    expect(monthIndex(2026, 4) < monthIndex(2026, 6)).toBe(true);
    expect(monthIndexOf('2026-06-01') > monthIndexOf('2026-04-30')).toBe(true);
  });

  it('finds the weekday of the 1st (1 Jun 2026 is a Monday)', () => {
    expect(firstWeekday(2026, 6)).toBe(1);
  });
});

describe('applyDayClick', () => {
  it('stages an anchor, closes the range on second click, restarts on third', () => {
    const first = applyDayClick({ anchor: null, end: null }, '2026-06-03');
    expect(first).toEqual({ anchor: '2026-06-03', end: null });
    expect(applyDayClick(first, '2026-06-09')).toEqual({
      anchor: '2026-06-03',
      end: '2026-06-09',
    });
    expect(applyDayClick({ anchor: '2026-06-03', end: '2026-06-09' }, '2026-06-15')).toEqual({
      anchor: '2026-06-15',
      end: null,
    });
  });

  it('swaps when the second click lands before the anchor', () => {
    expect(
      applyDayClick({ anchor: '2026-06-09', end: null }, '2026-06-03'),
    ).toEqual({ anchor: '2026-06-03', end: '2026-06-09' });
  });
});

describe('applyMonthClick', () => {
  it('stages the whole first month and drills into it', () => {
    const next = applyMonthClick({ anchor: null, end: null }, 2026, 4);
    expect(next.anchor).toBe('2026-04-01');
    expect(next.end).toBe('2026-04-30');
    expect(next.view).toEqual({ y: 2026, m: 4 });
  });

  it('stretches the staged range to a later month', () => {
    const next = applyMonthClick({ anchor: '2026-04-01', end: null }, 2026, 6);
    expect(next).toMatchObject({ anchor: '2026-04-01', end: '2026-06-30' });
  });

  it('stretches the staged range to an earlier month', () => {
    const next = applyMonthClick({ anchor: '2026-06-01', end: null }, 2026, 4);
    expect(next).toMatchObject({ anchor: '2026-04-01', end: '2026-06-01' });
  });

  it('stretches a finished range to a later month', () => {
    const next = applyMonthClick({ anchor: '2026-04-01', end: '2026-04-30' }, 2026, 6);
    expect(next).toMatchObject({ anchor: '2026-04-01', end: '2026-06-30' });
  });
});

describe('pendingToRange', () => {
  it('commits a single-day staging as a one-day range', () => {
    expect(pendingToRange({ anchor: '2026-06-03', end: null })).toEqual({
      from: '2026-06-03',
      to: '2026-06-03',
    });
  });

  it('commits nothing when nothing was staged', () => {
    expect(pendingToRange({ anchor: null, end: null })).toEqual({ from: '', to: '' });
  });
});

describe('placePopover', () => {
  // The visible area is x = 200..1000 (a sidebar on the left, the edge of the
  // scrolling page on the right); 8px is kept clear of both edges.
  const bounds = { boundLeft: 200, boundRight: 1000, margin: 8 };

  it('opens under the field, left edges lined up, when it fits', () => {
    expect(placePopover({ ...bounds, triggerLeft: 300, triggerRight: 520, width: 302 })).toEqual({
      left: 0,
      maxWidth: 784,
    });
  });

  it('lines up with the right edge of a field near the right of the page', () => {
    // Left-aligned it would end at 1052, past the edge (the dashboard bug).
    expect(placePopover({ ...bounds, triggerLeft: 750, triggerRight: 970, width: 302 })).toEqual({
      left: 220 - 302,
      maxWidth: 784,
    });
  });

  it('slides inside the page when neither edge lines up', () => {
    // A narrow page: 300 wide, field 220 wide in the middle.
    const narrow = { boundLeft: 0, boundRight: 300, margin: 8 };
    const placed = placePopover({ ...narrow, triggerLeft: 40, triggerRight: 260, width: 280 });
    expect(placed.maxWidth).toBe(284);
    // 300 - 8 - 280 = 12 on screen, i.e. 28 left of the field.
    expect(placed.left).toBe(12 - 40);
  });

  it('shrinks to the page and stops at its left margin when wider than it', () => {
    const tiny = { boundLeft: 0, boundRight: 250, margin: 8 };
    const placed = placePopover({ ...tiny, triggerLeft: 20, triggerRight: 240, width: 302 });
    expect(placed.maxWidth).toBe(234);
    expect(placed.left).toBe(8 - 20);
  });
});

describe('PeriodDatePicker', () => {
  it('renders the Cashmag closed field with the range and a Validate-free first paint', () => {
    const html = renderToStaticMarkup(
      <PeriodDatePicker from="2026-09-04" to="2026-09-04" onValidate={vi.fn()} />,
    );
    expect(html).toContain('Period date');
    expect(html).toContain('4/9/2026 - 4/9/2026');
    // The popup (and its Validate button) only exists once opened.
    expect(html).not.toContain('Validate');
  });

  it('shows a placeholder when the range is empty', () => {
    const html = renderToStaticMarkup(
      <PeriodDatePicker from="" to="" onValidate={vi.fn()} />,
    );
    expect(html).toContain('Select period');
  });
});
