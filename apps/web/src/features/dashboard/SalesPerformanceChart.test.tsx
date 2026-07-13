import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesPerformanceChart } from './SalesPerformanceChart';
import { SalesPeriodControls } from './SalesPeriodControls';
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
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('renders zero buckets with an honest empty message', () => {
    const html = renderToStaticMarkup(
      <SalesPerformanceChart data={buildSalesPerformance(period, [])} />,
    );

    expect(html).toContain('No issued sales in this period.');
    expect(html).toContain('Rs 0.00');
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
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Sales chart from date"');
    expect(html).toContain('aria-label="Sales chart to date"');
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

  it('switches to a complete custom range when either date changes', () => {
    navigation.query = 'customer=vip&salesRange=month';
    const month = resolveSalesPeriod({}, NOW);
    const elements = flattenElements(SalesPeriodControls({ period: month }));
    const fromInput = elements.find(
      (element) =>
        element.type === 'input' &&
        (element.props as { 'aria-label'?: string })['aria-label'] ===
          'Sales chart from date',
    );

    expect(fromInput).toBeDefined();
    (
      fromInput?.props as {
        onChange: (event: ChangeEvent<HTMLInputElement>) => void;
      }
    ).onChange({ target: { value: '2026-07-05' } } as ChangeEvent<HTMLInputElement>);
    expect(navigation.replace).toHaveBeenCalledWith(
      '/dashboard?customer=vip&salesRange=custom&salesFrom=2026-07-05&salesTo=2026-07-13',
      { scroll: false },
    );
  });
});
