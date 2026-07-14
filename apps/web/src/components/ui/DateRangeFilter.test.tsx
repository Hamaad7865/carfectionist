import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DateRangeFilter } from './DateRangeFilter';

const navigation = vi.hoisted(() => ({
  pathname: '/point-of-sale/POS-1',
  query: '',
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

function flattenElements(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return [
    node,
    ...Children.toArray(children).flatMap((child) => flattenElements(child)),
  ];
}

function renderElements() {
  return flattenElements(
    DateRangeFilter({
      label: false,
      displayRange: { from: '2026-07-12', to: '2026-07-14' },
    }),
  );
}

function getDateInput(label: 'From date' | 'To date') {
  return renderElements().find(
    (element) =>
      element.type === 'input' &&
      (element.props as { 'aria-label'?: string })['aria-label'] === label,
  );
}

describe('DateRangeFilter', () => {
  beforeEach(() => {
    navigation.pathname = '/point-of-sale/POS-1';
    navigation.query = '';
    navigation.replace.mockReset();
  });

  it.each([
    'from=not-a-date&to=2026-07-14',
    'from=2026-07-13',
    'from=2026-07-14&to=2026-07-12',
    'from=2026-01-01&from=2026-01-02&to=2026-01-03&to=2026-01-04',
  ])('uses the normalized display range for raw query %s', (query) => {
    navigation.query = query;

    const html = renderToStaticMarkup(
      <DateRangeFilter
        label={false}
        displayRange={{ from: '2026-07-12', to: '2026-07-14' }}
      />,
    );

    expect(html).toContain('value="2026-07-12"');
    expect(html).toContain('value="2026-07-14"');
    expect(html).toContain('max="2026-07-14"');
    expect(html).toContain('min="2026-07-12"');
  });

  it('keeps raw URL dates as the backward-compatible display fallback', () => {
    navigation.query = 'from=2026-06-01&to=2026-06-30';

    const html = renderToStaticMarkup(<DateRangeFilter label={false} />);

    expect(html).toContain('value="2026-06-01"');
    expect(html).toContain('value="2026-06-30"');
  });

  it('shows Clear only when the raw URL contains a range key', () => {
    const normalizedOnly = renderToStaticMarkup(
      <DateRangeFilter
        label={false}
        displayRange={{ from: '2026-07-12', to: '2026-07-14' }}
      />,
    );

    navigation.query = 'from=&view=compact';
    const rawRange = renderToStaticMarkup(
      <DateRangeFilter
        label={false}
        displayRange={{ from: '2026-07-12', to: '2026-07-14' }}
      />,
    );

    expect(normalizedOnly).not.toContain('>Clear</button>');
    expect(rawRange).toContain('>Clear</button>');
  });

  it('renders an accessible, wrapping, min-width-safe control group', () => {
    navigation.query = 'from=2026-07-12';
    const elements = renderElements();
    const group = elements.find(
      (element) =>
        element.type === 'div' &&
        (element.props as { role?: string }).role === 'group',
    );
    const arrow = elements.find(
      (element) =>
        element.type === 'span' &&
        (element.props as { children?: ReactNode }).children === '→',
    );
    const clear = elements.find(
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Clear',
    );
    const inputs = elements.filter((element) => element.type === 'input');

    expect(group?.props).toMatchObject({
      role: 'group',
      'aria-label': 'Date range',
      className: 'flex min-w-0 flex-wrap items-center gap-1.5',
    });
    expect(arrow?.props).toMatchObject({ 'aria-hidden': 'true' });
    expect(clear?.props).toMatchObject({ type: 'button' });
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      const className = (input.props as { className?: string }).className;
      expect(className).toContain('min-w-0');
      expect(className).toContain('max-w-full');
    }
  });

  it('uses the approved width and keyboard-focus classes on both date inputs', () => {
    const approvedInputClass =
      'h-9 w-[8.75rem] min-w-0 max-w-full rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink [color-scheme:light] focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
    const inputClasses = renderElements()
      .filter((element) => element.type === 'input')
      .map(
        (input) => (input.props as { className?: string }).className,
      );

    expect(inputClasses).toEqual([approvedInputClass, approvedInputClass]);
  });

  it.each([
    {
      label: 'From date' as const,
      query:
        'tab=trace&traceCategory=payments&tag=a&tag=b&from=bad&from=older&to=2026-07-14&view=compact',
      value: '2026-07-12',
      expected:
        '/point-of-sale/POS-1?tab=trace&traceCategory=payments&tag=a&tag=b&from=2026-07-12&to=2026-07-14&view=compact',
    },
    {
      label: 'To date' as const,
      query:
        'tab=trace&traceCategory=exceptions&tag=a&tag=b&from=2026-07-12&to=bad&to=older&view=compact',
      value: '2026-07-14',
      expected:
        '/point-of-sale/POS-1?tab=trace&traceCategory=exceptions&tag=a&tag=b&from=2026-07-12&to=2026-07-14&view=compact',
    },
  ])(
    'changes only the range value controlled by $label',
    ({ label, query, value, expected }) => {
      navigation.query = query;
      const input = getDateInput(label);

      expect(input).toBeDefined();
      (
        input?.props as {
          onChange: (event: ChangeEvent<HTMLInputElement>) => void;
        }
      ).onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);

      expect(navigation.replace).toHaveBeenCalledOnce();
      expect(navigation.replace).toHaveBeenCalledWith(expected, {
        scroll: false,
      });
    },
  );

  it('clears only from and to while preserving repeated query parameters', () => {
    navigation.query =
      'tab=trace&from=bad&traceCategory=till&tag=a&to=bad&tag=b&from=older&view=compact';
    const clear = renderElements().find(
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Clear',
    );

    expect(clear).toBeDefined();
    (clear?.props as { onClick: () => void }).onClick();

    expect(navigation.replace).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith(
      '/point-of-sale/POS-1?tab=trace&traceCategory=till&tag=a&tag=b&view=compact',
      { scroll: false },
    );
  });
});
