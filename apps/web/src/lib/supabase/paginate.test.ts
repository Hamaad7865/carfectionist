import { describe, expect, it } from 'vitest';

import { fetchAllRowsByKeyset, fixedIsoUpperBound } from './paginate';

interface FiscalRow {
  id: string;
  issued_at: string;
}

interface FiscalCursor {
  issuedAt: string;
  id: string;
}

function fiscalCursor(row: FiscalRow): FiscalCursor {
  return { issuedAt: row.issued_at, id: row.id };
}

function compareFiscalCursor(left: FiscalCursor, right: FiscalCursor): number {
  return (
    left.issuedAt.localeCompare(right.issuedAt) ||
    left.id.localeCompare(right.id)
  );
}

describe('fetchAllRowsByKeyset', () => {
  it('returns every original row exactly once when a concurrent insert would shift an OFFSET page', async () => {
    const original = Array.from({ length: 1_505 }, (_, index) => ({
      id: String(index + 1).padStart(6, '0'),
      issued_at: new Date(
        Date.parse('2026-07-01T00:00:00.000Z') + Math.floor(index / 5) * 1_000,
      ).toISOString(),
    }));
    const fixedStart = '2026-07-01T00:00:00.000Z';
    const fixedCutoff = '2026-07-01T01:00:00.000Z';
    const liveRows = [...original];
    let pageReads = 0;

    const rows = await fetchAllRowsByKeyset<FiscalRow, FiscalCursor>(
      (after) => ({
        range: async (from: number, to: number) => {
          expect(from).toBe(0);
          pageReads += 1;
          if (pageReads === 2) {
            liveRows.push(
              {
                id: '000000',
                issued_at: fixedStart,
              },
              {
                id: 'concurrent-after-fixed-cutoff',
                issued_at: '2026-07-01T01:00:00.001Z',
              },
            );
          }

          const data = liveRows
            .filter(
              (row) =>
                row.issued_at >= fixedStart && row.issued_at < fixedCutoff,
            )
            .filter(
              (row) =>
                after === null ||
                compareFiscalCursor(fiscalCursor(row), after) > 0,
            )
            .sort((left, right) =>
              compareFiscalCursor(fiscalCursor(left), fiscalCursor(right)),
            )
            .slice(from, to + 1);

          return { data, error: null };
        },
      }),
      fiscalCursor,
      compareFiscalCursor,
    );

    expect(rows.map((row) => row.id)).toEqual(original.map((row) => row.id));
    expect(new Set(rows.map((row) => row.id)).size).toBe(original.length);
    expect(pageReads).toBe(2);
  });

  it('fails instead of looping when a query returns a non-advancing cursor', async () => {
    const repeatedPage = Array.from({ length: 1_000 }, (_, index) => index);

    await expect(
      fetchAllRowsByKeyset<number, number>(
        () => ({
          range: async () => ({ data: repeatedPage, error: null }),
        }),
        (row) => row,
        (left, right) => left - right,
      ),
    ).rejects.toThrow('Keyset pagination cursor did not advance');
  });

  it('continues beyond the former one-million-row backstop', async () => {
    const total = 1_002_001;

    const rows = await fetchAllRowsByKeyset<number, number>(
      (after) => ({
        range: async (from: number, to: number) => {
          const start = (after ?? -1) + 1 + from;
          const end = Math.min((after ?? -1) + 1 + to, total - 1);
          const data =
            start > end
              ? []
              : Array.from({ length: end - start + 1 }, (_, index) => start + index);
          return { data, error: null };
        },
      }),
      (row) => row,
      (left, right) => left - right,
    );

    expect(rows).toHaveLength(total);
    expect(rows.at(-1)).toBe(total - 1);
  });
});

describe('fixedIsoUpperBound', () => {
  it('freezes an open period at the current time', () => {
    expect(
      fixedIsoUpperBound(
        '2026-07-13T20:00:00.000Z',
        Date.parse('2026-07-13T08:00:00.000Z'),
      ),
    ).toBe('2026-07-13T08:00:00.000Z');
  });

  it('preserves the selected end for a completed period', () => {
    expect(
      fixedIsoUpperBound(
        '2026-06-30T20:00:00.000Z',
        Date.parse('2026-07-13T08:00:00.000Z'),
      ),
    ).toBe('2026-06-30T20:00:00.000Z');
  });
});
