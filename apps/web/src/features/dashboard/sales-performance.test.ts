import { describe, expect, it } from 'vitest';

import {
  buildSalesPerformance,
  formatCompactMUR,
  normalizeSalesPeriodInput,
  resolveSalesPeriod,
  salesQuerySpec,
  settleSalesPerformance,
  unavailableSalesPerformance,
  type SalesDocumentRow, isWorkshopSale } from './sales-performance';

const NOW = Date.parse('2026-07-13T08:00:00.000Z'); // 12:00 in Mauritius

describe('resolveSalesPeriod', () => {
  it('normalizes raw Next search parameters to scalar sales inputs', () => {
    expect(
      normalizeSalesPeriodInput({
        salesRange: 'custom',
        salesFrom: ['2026-01-01', '2026-02-01'],
        salesTo: '2026-01-31',
        unrelated: 'keep',
      }),
    ).toEqual({
      salesRange: 'custom',
      salesFrom: undefined,
      salesTo: '2026-01-31',
    });
  });

  it('defaults to the current Mauritius month through today', () => {
    expect(resolveSalesPeriod({}, NOW)).toMatchObject({
      range: 'month',
      bucket: 'day',
      from: '2026-07-01',
      to: '2026-07-13',
      startIso: '2026-06-30T20:00:00.000Z',
      endExclusiveIso: '2026-07-13T20:00:00.000Z',
      label: '1\u201313 July 2026',
    });
  });

  it('resolves Today to 24 Mauritius-hour buckets', () => {
    expect(resolveSalesPeriod({ salesRange: 'today' }, NOW)).toMatchObject({
      range: 'today',
      bucket: 'hour',
      from: '2026-07-13',
      to: '2026-07-13',
    });
  });

  it('resolves Last 7 days inclusively', () => {
    expect(resolveSalesPeriod({ salesRange: 'last7' }, NOW)).toMatchObject({
      range: 'last7',
      from: '2026-07-07',
      to: '2026-07-13',
    });
  });

  it('accepts a valid custom range', () => {
    expect(
      resolveSalesPeriod(
        {
          salesRange: 'custom',
          salesFrom: '2026-06-01',
          salesTo: '2026-06-30',
        },
        NOW,
      ),
    ).toMatchObject({
      range: 'custom',
      from: '2026-06-01',
      to: '2026-06-30',
      label: '1\u201330 June 2026',
    });
  });

  it.each([
    { salesRange: 'custom', salesFrom: 'bad', salesTo: '2026-06-30' },
    {
      salesRange: 'custom',
      salesFrom: '2026-13-01',
      salesTo: '2026-06-30',
    },
    {
      salesRange: 'custom',
      salesFrom: '2026-07-02',
      salesTo: '2026-07-01',
    },
    {
      salesRange: 'custom',
      salesFrom: '2026-01-01',
      salesTo: '2026-07-13',
    },
  ])('falls back to This month for invalid custom input %#', (input) => {
    expect(resolveSalesPeriod(input, NOW).range).toBe('month');
  });
});

function row(overrides: Partial<SalesDocumentRow> = {}): SalesDocumentRow {
  return {
    id: crypto.randomUUID(),
    doc_type: 'invoice',
    status: 'issued',
    total_incl: 100,
    origin: 'standalone',
    job_id: null,
    issued_at: '2026-07-12T20:30:00.000Z', // 13 Jul 00:30 MU
    ...overrides,
  };
}

describe('buildSalesPerformance', () => {
  it('accepts PostgREST numeric strings and ignores rows outside the selected buckets', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const data = buildSalesPerformance(period, [
      row({ total_incl: '123.45' }),
      row({
        id: 'outside',
        total_incl: '999',
        issued_at: '2026-07-11T10:00:00.000Z',
      }),
    ]);

    expect(data.totalCents).toBe(12_345);
  });

  it('creates 24 zero-filled buckets for Today', () => {
    const data = buildSalesPerformance(
      resolveSalesPeriod({ salesRange: 'today' }, NOW),
      [],
    );
    expect(data.points).toHaveLength(24);
    expect(data.points[0]).toMatchObject({
      key: '2026-07-13T00',
      axisLabel: '00:00',
      totalCents: 0,
    });
    expect(data.points[23]).toMatchObject({
      key: '2026-07-13T23',
      axisLabel: '23:00',
      totalCents: 0,
    });
    expect(data.hasSales).toBe(false);
  });

  it('zero-fills an inclusive daily range', () => {
    const period = resolveSalesPeriod(
      {
        salesRange: 'custom',
        salesFrom: '2026-07-10',
        salesTo: '2026-07-13',
      },
      NOW,
    );
    expect(
      buildSalesPerformance(period, []).points.map((point) => point.key),
    ).toEqual(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']);
  });

  it('uses Mauritius midnight and separates origins', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const data = buildSalesPerformance(period, [
      row(),
      row({
        id: 'job',
        origin: 'from_job',
        total_incl: '250.50',
        issued_at: '2026-07-13T05:15:00.000Z',
      }),
    ]);
    expect(data.points[0]).toMatchObject({
      counterCents: 10_000,
      workshopCents: 0,
      totalCents: 10_000,
    });
    expect(data.points[9]).toMatchObject({
      counterCents: 0,
      workshopCents: 25_050,
      totalCents: 25_050,
    });
    expect(data.totalCents).toBe(35_050);
  });

  it('counts an intake sale (job_id set, origin still standalone) as Workshop', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const data = buildSalesPerformance(period, [
      row({
        id: 'intake',
        origin: 'standalone', // intake path leaves origin standalone…
        job_id: 'job-1', // …but links a job, so it's a workshop sale
        total_incl: 300,
        issued_at: '2026-07-13T05:15:00.000Z',
      }),
    ]);
    expect(data.points[9]).toMatchObject({ counterCents: 0, workshopCents: 30_000 });
  });

  it('includes live invoice statuses and excludes draft and void rows', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const rows = [
      row({ id: 'issued', status: 'issued' }),
      row({ id: 'part', status: 'partly_paid' }),
      row({ id: 'paid', status: 'paid' }),
      row({ id: 'draft', status: 'draft' }),
      row({ id: 'void', status: 'void' }),
    ];
    expect(buildSalesPerformance(period, rows).totalCents).toBe(30_000);
  });

  it('subtracts issued credit notes in their issue bucket and preserves a negative day', () => {
    const period = resolveSalesPeriod(
      {
        salesRange: 'custom',
        salesFrom: '2026-07-12',
        salesTo: '2026-07-13',
      },
      NOW,
    );
    const data = buildSalesPerformance(period, [
      row({
        id: 'invoice',
        total_incl: 50,
        issued_at: '2026-07-12T10:00:00.000Z',
      }),
      row({
        id: 'credit',
        doc_type: 'credit_note',
        status: 'issued',
        total_incl: 75,
        issued_at: '2026-07-13T10:00:00.000Z',
      }),
      row({
        id: 'void-credit',
        doc_type: 'credit_note',
        status: 'void',
        total_incl: 20,
        issued_at: '2026-07-13T11:00:00.000Z',
      }),
    ]);
    expect(data.points.map((point) => point.totalCents)).toEqual([
      5_000,
      -7_500,
    ]);
    expect(data.totalCents).toBe(-2_500);
  });

  it('keeps fiscal activity visible when an invoice and credit note cancel exactly', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const data = buildSalesPerformance(period, [
      row({ id: 'invoice', total_incl: 75 }),
      row({
        id: 'credit',
        doc_type: 'credit_note',
        status: 'issued',
        total_incl: 75,
      }),
    ]);

    expect(data.totalCents).toBe(0);
    expect(data.hasSales).toBe(true);
  });

  it('always reconciles the total line to both bar series', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);
    const data = buildSalesPerformance(period, [
      row(),
      row({ id: 'job', origin: 'from_job', total_incl: 40 }),
    ]);
    for (const point of data.points) {
      expect(point.totalCents).toBe(
        point.counterCents + point.workshopCents,
      );
    }
  });
});

describe('salesQuerySpec', () => {
  it('describes the exact paginated fiscal query window', () => {
    const period = resolveSalesPeriod({ salesRange: 'today' }, NOW);

    expect(salesQuerySpec(period)).toEqual({
      columns: 'id, doc_type, status, total_incl, origin, job_id, issued_at, document_lines(products(kind))',
      docTypes: ['invoice', 'credit_note'],
      statuses: ['issued', 'partly_paid', 'paid'],
      startIso: '2026-07-12T20:00:00.000Z',
      endExclusiveIso: '2026-07-13T20:00:00.000Z',
    });
  });
});

describe('presentation helpers', () => {
  it.each([
    [0, 'Rs 0'],
    [99_900, 'Rs 999'],
    [100_000, 'Rs 1k'],
    [1_250_000, 'Rs 12.5k'],
    [125_000_000, 'Rs 1.25m'],
    [-5_000_000, 'Rs -50k'],
  ])('formats %d cents as %s', (cents, expected) => {
    expect(formatCompactMUR(cents)).toBe(expected);
  });

  it('creates an explicit unavailable state', () => {
    expect(
      unavailableSalesPerformance(resolveSalesPeriod({}, NOW)),
    ).toMatchObject({
      status: 'unavailable',
      points: [],
      totalCents: null,
      hasSales: false,
    });
  });

  it('turns a rejected sales query into an unavailable state rather than zero sales', async () => {
    const period = resolveSalesPeriod({}, NOW);
    await expect(
      settleSalesPerformance(
        period,
        Promise.reject(new Error('database unavailable')),
      ),
    ).resolves.toMatchObject({
      status: 'unavailable',
      totalCents: null,
      points: [],
    });
  });
});

describe('workshop vs counter', () => {
  // The studio's question is "did we DO something to a car for this money?" —
  // not "was there paperwork". A body polish rung up at the till with no intake
  // and no job card is workshop work; a speaker off the shelf is not.
  it('counts a sale off a job card as workshop', () => {
    expect(isWorkshopSale(row({ origin: 'from_job' }))).toBe(true);
  });

  it('counts a sale that reached the invoice via intake as workshop', () => {
    // the intake path leaves origin 'standalone' but sets job_id
    expect(isWorkshopSale(row({ origin: 'standalone', job_id: 'job-1' }))).toBe(true);
  });

  it('counts a counter sale CONTAINING A SERVICE as workshop', () => {
    // no intake, no job — but someone still polished a car
    expect(
      isWorkshopSale(row({ origin: 'standalone', job_id: null, document_lines: [{ products: { kind: 'service' } }] })),
    ).toBe(true);
  });

  it('leaves a pure product sale as counter revenue', () => {
    expect(
      isWorkshopSale(row({ origin: 'standalone', job_id: null, document_lines: [{ products: { kind: 'product' } }] })),
    ).toBe(false);
  });

  it('counts a mixed basket as workshop — the service decides it', () => {
    expect(
      isWorkshopSale(row({ origin: 'standalone', job_id: null, document_lines: [{ products: { kind: 'product' } }, { products: { kind: 'service' } }] })),
    ).toBe(true);
  });

  it('reads the embed whichever shape PostgREST hands back', () => {
    // products is a to-ONE FK so the row carries an object, but supabase's
    // generated types widen every embed to an array — both must work.
    expect(isWorkshopSale(row({ document_lines: [{ products: { kind: 'service' } }] }))).toBe(true);
    expect(isWorkshopSale(row({ document_lines: [{ products: [{ kind: 'service' }] }] }))).toBe(true);
    expect(isWorkshopSale(row({ document_lines: [{ products: [{ kind: 'product' }] }] }))).toBe(false);
    expect(isWorkshopSale(row({ document_lines: [{ products: [] }] }))).toBe(false);
  });

  it('treats a sale with no lines, and an ad-hoc line with no product, as counter', () => {
    expect(isWorkshopSale(row({ document_lines: [] }))).toBe(false);
    expect(isWorkshopSale(row({ document_lines: null }))).toBe(false);
    expect(isWorkshopSale(row({ document_lines: [{ products: null }] }))).toBe(false);
    expect(isWorkshopSale(row({}))).toBe(false); // field absent entirely
  });

  it('splits the chart by that rule', () => {
    const built = buildSalesPerformance(
      resolveSalesPeriod({ salesRange: 'custom', salesFrom: '2026-07-13', salesTo: '2026-07-13' }),
      [
        row({ total_incl: 100, document_lines: [{ products: { kind: 'product' } }] }),  // speaker  -> counter
        row({ total_incl: 250, document_lines: [{ products: { kind: 'service' } }] }),  // polish   -> workshop
      ],
    );
    const day = built.points[0];
    expect(day.counterCents).toBe(10_000);
    expect(day.workshopCents).toBe(25_000);
    expect(day.totalCents).toBe(35_000);
  });
});
