import {
  Children,
  isValidElement,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { YAxis } from 'recharts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveSalesAxisDomain,
  SalesPerformanceChart,
} from './SalesPerformanceChart';
import {
  buildCustomSalesRangeUpdate,
  SalesPeriodControls,
} from './SalesPeriodControls';
import {
  buildSalesPerformance,
  resolveSalesPeriod,
  unavailableSalesPerformance,
  type SalesDocumentRow,
} from './sales-performance';

const navigation = vi.hoisted(() => ({
  pathname: '/dashboard',
  query: '',
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

const NOW = Date.parse('2026-07-13T08:00:00.000Z');
const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
const invoice: SalesDocumentRow = {
  id: 'invoice',
  doc_type: 'invoice',
  status: 'issued',
  total_incl: 123.45,
  origin: 'standalone',
  issued_at: '2026-07-12T20:30:00.000Z',
};

function flattenElements(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return [
    node,
    ...Children.toArray(children).flatMap((child) => flattenElements(child)),
  ];
}

describe('resolveSalesAxisDomain', () => {
  it.each([
    [0, 0, [0, 100]],
    [-5_000, -1_000, [-5_000, 0]],
    [1_000, 5_000, [0, 5_000]],
    [-5_000, 4_000, [-5_000, 4_000]],
  ])(
    'resolves [%d, %d] to a useful zero-inclusive domain',
    (dataMin, dataMax, expected) => {
      expect(resolveSalesAxisDomain(dataMin, dataMax)).toEqual(expected);
    },
  );
});

describe('SalesPerformanceChart', () => {
  it('renders the period total and an accessible table with exact MUR values', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <SalesPerformanceChart
        data={buildSalesPerformance(period, [invoice])}
      />,
    );

    expect(html).toContain('Sales performance');
    expect(html).toContain('Total incl. VAT');
    expect(html).toContain('Rs 123.45');
    expect(html).toContain(
      'Sales including VAT by period and sales mode',
    );
    expect(html).toContain('Counter or direct');
    expect(html).toContain('Workshop jobs');
    expect(html).toContain('aria-labelledby="sales-performance-title"');
    expect(html).toMatch(/^<figure[^>]*><figcaption[^>]*>/);
    expect(html).toContain('<div class="sr-only"><table>');
    expect(html).not.toContain('<table class="sr-only">');
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('renders zero buckets with an honest empty message', () => {
    const emptyData = buildSalesPerformance(period, []);
    const html = renderToStaticMarkup(
      <SalesPerformanceChart data={emptyData} />,
    );
    const yAxis = flattenElements(
      SalesPerformanceChart({ data: emptyData }),
    ).find((element) => element.type === YAxis);
    const yAxisProps = yAxis?.props as
      | {
          domain: (bounds: [number, number]) => [number, number];
          tickCount: number;
          tickFormatter: (cents: number) => string;
        }
      | undefined;

    expect(html).toContain('No issued sales in this period.');
    expect(html).toContain('Rs 0.00');
    expect(yAxisProps?.domain([0, 0])).toEqual([0, 100]);
    expect(yAxisProps?.tickCount).toBe(2);
    expect(yAxisProps?.tickFormatter(100)).toBe('Rs 1');
  });

  it('renders query failure as unavailable rather than zero sales', () => {
    const html = renderToStaticMarkup(
      <SalesPerformanceChart data={unavailableSalesPerformance(period)} />,
    );

    expect(html).toContain('Sales chart unavailable');
    expect(html).toContain('Refresh the page to retry loading this period.');
    expect(html).not.toContain('No issued sales in this period.');
    expect(html).not.toContain('Rs 0.00');
  });

  it('keeps exact negative values available to screen readers', () => {
    const creditNote: SalesDocumentRow = {
      ...invoice,
      id: 'credit-note',
      doc_type: 'credit_note',
      total_incl: 75,
    };
    const html = renderToStaticMarkup(
      <SalesPerformanceChart
        data={buildSalesPerformance(period, [creditNote])}
      />,
    );

    expect(html).toContain('Rs -75.00');
    expect(html).toContain('Total including VAT');
  });
});

describe('SalesPeriodControls', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard';
    navigation.query = '';
    navigation.replace.mockReset();
  });

  it('exposes pressed presets and labelled custom date inputs', () => {
    const html = renderToStaticMarkup(
      <SalesPeriodControls period={period} />,
    );

    expect(html).toContain('aria-label="Sales chart period"');
    expect(html).toMatch(
      /<form[^>]*role="group"[^>]*aria-label="Sales chart period"/,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Sales chart from date"');
    expect(html).toContain('aria-label="Sales chart to date"');
    expect(html).toContain('>Apply</button>');
  });

  it('preserves unrelated parameters and clears custom dates for a preset', () => {
    navigation.query =
      'customer=vip&salesRange=custom&salesFrom=2026-07-01&salesTo=2026-07-13';
    const customPeriod = resolveSalesPeriod(
      {
        salesRange: 'custom',
        salesFrom: '2026-07-01',
        salesTo: '2026-07-13',
      },
      NOW,
    );
    const elements = flattenElements(
      SalesPeriodControls({ period: customPeriod }),
    );
    const preset = elements.find(
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === '7 days',
    );

    expect(preset).toBeDefined();
    (preset?.props as { onClick: () => void }).onClick();
    expect(navigation.replace).toHaveBeenCalledWith(
      '/dashboard?customer=vip&salesRange=last7',
      { scroll: false },
    );
  });

  it('builds a remote custom range as one URL update', () => {
    expect(
      buildCustomSalesRangeUpdate(
        '/dashboard',
        'customer=vip&salesRange=month',
        '2026-01-01',
        '2026-01-31',
      ),
    ).toEqual({
      ok: true,
      href:
        '/dashboard?customer=vip&salesRange=custom&salesFrom=2026-01-01&salesTo=2026-01-31',
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each([
    [
      '2026-02-30',
      '2026-03-01',
      'salesFrom',
      'Choose a valid start date.',
    ],
    ['2026-01-01', 'not-a-date', 'salesTo', 'Choose a valid end date.'],
    [
      '2026-01-31',
      '2026-01-01',
      'salesTo',
      'The end date must be on or after the start date.',
    ],
    [
      '2026-01-01',
      '2026-04-04',
      'salesTo',
      'Choose a range of 93 days or less.',
    ],
  ] as const)(
    'rejects invalid custom range %s to %s',
    (from, to, field, message) => {
      expect(
        buildCustomSalesRangeUpdate('/dashboard', 'customer=vip', from, to),
      ).toEqual({ ok: false, field, message });
    },
  );

  it('drafts remote endpoints and applies them together', () => {
    navigation.query = 'customer=vip&salesRange=month';
    const month = resolveSalesPeriod({}, NOW);
    const elements = flattenElements(SalesPeriodControls({ period: month }));
    const form = elements.find((element) => element.type === 'form');
    const fromInput = elements.find(
      (element) =>
        element.type === 'input' &&
        (element.props as { 'aria-label'?: string })['aria-label'] ===
          'Sales chart from date',
    );
    const toInput = elements.find(
      (element) =>
        element.type === 'input' &&
        (element.props as { 'aria-label'?: string })['aria-label'] ===
          'Sales chart to date',
    );
    const apply = elements.find(
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Apply',
    );

    expect(form).toBeDefined();
    expect(fromInput).toBeDefined();
    expect(toInput).toBeDefined();
    expect(apply).toBeDefined();
    if (!form || !fromInput || !toInput || !apply) return;

    const fromProps = fromInput.props as {
      defaultValue?: string;
      value?: string;
      min?: string;
      max?: string;
      required?: boolean;
      onChange?: unknown;
    };
    const toProps = toInput.props as typeof fromProps;
    expect(fromProps).toMatchObject({
      defaultValue: month.from,
      required: true,
    });
    expect(toProps).toMatchObject({ defaultValue: month.to, required: true });
    expect(fromProps.value).toBeUndefined();
    expect(toProps.value).toBeUndefined();
    expect(fromProps.min).toBeUndefined();
    expect(fromProps.max).toBeUndefined();
    expect(toProps.min).toBeUndefined();
    expect(toProps.max).toBeUndefined();
    expect(fromProps.onChange).toBeUndefined();
    expect(toProps.onChange).toBeUndefined();
    expect((apply.props as { type?: string }).type).toBe('submit');
    expect(navigation.replace).not.toHaveBeenCalled();

    const controls = {
      salesFrom: {
        value: '2026-01-01',
        setCustomValidity: vi.fn(),
        reportValidity: vi.fn(),
      },
      salesTo: {
        value: '2026-01-31',
        setCustomValidity: vi.fn(),
        reportValidity: vi.fn(),
      },
    };
    const preventDefault = vi.fn();
    (
      form.props as {
        onSubmit: (event: FormEvent<HTMLFormElement>) => void;
      }
    ).onSubmit({
      preventDefault,
      currentTarget: {
        elements: {
          namedItem: (name: string) =>
            controls[name as keyof typeof controls] ?? null,
        },
      },
    } as unknown as FormEvent<HTMLFormElement>);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      '/dashboard?customer=vip&salesRange=custom&salesFrom=2026-01-01&salesTo=2026-01-31',
      { scroll: false },
    );
  });
});
