import Link from "next/link";
import { Check, Download } from "lucide-react";
import { formatMUR } from "@/lib/money";
import type { DailySummary, DailySummaryRow } from "@/lib/supabase/queries/daily-summary";
import { SECTIONS, ALL_SECTIONS, columnDefs, groupSpans, type SectionKey } from "./daily-summary-sections";
import { btn } from "@/components/ui/button";

// The Cashmag "Synthèse quotidienne" table: a two-row grouped header, one row per
// business day, a totals row, and five sections you can switch off. Sections are
// URL state (not client state) so a view is shareable and the page stays server-
// rendered like every other report here. Columns come from the shared module the
// Excel export uses, so screen and sheet can never disagree.

export { parseSections, ALL_SECTIONS, SECTIONS, type SectionKey } from "./daily-summary-sections";

const money = (c: number) => formatMUR(c);

/** Render one cell: money formatted, counts plain, text as-is. */
function cellText(c: ReturnType<typeof columnDefs>[number], r: DailySummaryRow): string {
  if (c.text) return c.text(r);
  if (c.cents) return money(c.cents(r));
  return c.count ? String(c.count(r)) : "";
}
const isNum = (c: ReturnType<typeof columnDefs>[number]) => !c.text;

export function DailySummaryTable({
  summary,
  sections,
  hrefFor,
  exportHref,
}: {
  summary: DailySummary;
  sections: Set<SectionKey>;
  hrefFor: (next: SectionKey[]) => string;
  exportHref: string;
}) {
  const cols = columnDefs(summary, sections);
  const groups = groupSpans(cols);

  return (
    <div className="flex flex-col gap-3">
      {/* section toggles — Cashmag's checkbox row */}
      <div className="flex flex-wrap items-center gap-2">
        {SECTIONS.map((s) => {
          const on = sections.has(s.key);
          const next = on ? ALL_SECTIONS.filter((k) => sections.has(k) && k !== s.key) : [...ALL_SECTIONS.filter((k) => sections.has(k)), s.key];
          return (
            <Link
              key={s.key}
              href={hrefFor(next)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-2.5 text-[12px] font-semibold ${on ? "border-brand bg-[rgba(43,140,255,0.08)] text-link" : "border-line-2 bg-card text-muted"}`}
            >
              <span className={`grid size-[14px] place-items-center rounded-[4px] border ${on ? "border-brand bg-brand text-white" : "border-line-2"}`}>
                {on && <Check size={10} strokeWidth={3.5} />}
              </span>
              {s.label}
            </Link>
          );
        })}
        <div className="flex-1" />
        <a
          href={exportHref}
          className={btn("ghost", "sm")}
        >
          <Download size={14} /> Excel file
        </a>
      </div>

      {/* the sheet — wide, so it scrolls in its own container */}
      <div className="overflow-x-auto rounded-[13px] border border-line bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {groups.map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span}
                  className={`whitespace-nowrap border-b border-line bg-band px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-th ${i > 0 ? "border-l border-line" : ""}`}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={`${c.head}-${i}`}
                  className={`whitespace-nowrap border-b border-line bg-sub px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint ${isNum(c) ? "text-right" : "text-left"}`}
                >
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.day} className="border-b border-line-2 last:border-0 hover:bg-sub">
                {cols.map((c, i) => (
                  <td key={i} className={`whitespace-nowrap px-3 py-2 ${isNum(c) ? "num text-right" : "font-semibold text-body"} ${r.tickets === 0 ? "text-faint" : "text-body"}`}>
                    {cellText(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-band">
              {cols.map((c, i) => (
                <td key={i} className={`whitespace-nowrap px-3 py-2.5 font-bold text-ink-strong ${isNum(c) ? "num text-right" : ""}`}>
                  {i === 0 ? "Total" : cellText(c, summary.totals)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {summary.rows.length === 0 && (
        <p className="rounded-[11px] border border-line bg-card px-4 py-8 text-center text-[13px] text-faint">Pick a date range to see the summary.</p>
      )}
    </div>
  );
}
