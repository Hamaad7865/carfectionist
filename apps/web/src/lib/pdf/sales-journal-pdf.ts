import { createElement } from "react";
import { SalesJournalA4, type SalesJournalA4Props, type JournalTable } from "@/components/pdf/SalesJournalA4";
import { htmlToPdf, documentHtml } from "@/lib/pdf/render";
import { formatMUR } from "@/lib/money";
import { muDayLabel } from "@/lib/mu-date";
import type { SalesJournal } from "@/lib/supabase/queries/sales-journal";
import { rangeLabel, shortRangeLabel, type Range } from "@/features/sales-journal/periods";

// SalesJournal → the printable A4 shape. Kept out of the route (and free of any
// browser) so the mapping can be unit-tested: the PDF has to agree with the
// screen figure for figure, and the only way to know is to assert it.

const money = (c: number) => formatMUR(c);

export function toJournalTables(j: SalesJournal): JournalTable[] {
  return [
    {
      title: "Sale methods",
      head: ["Sale method", "Tickets / Invoices", "Total excl tax", "Total incl tax"],
      rows: j.saleMethods.map((m) => ({ label: m.label, cells: [String(m.tickets), money(m.exclCents), money(m.inclCents)] })),
      total: { label: "Total", cells: [String(j.tickets), money(j.totalExclCents), money(j.totalInclCents)] },
    },
    {
      title: "Taxes",
      head: ["Label", "Rate", "Tax", "Discount", "Excluding tax", "With tax"],
      rows: j.taxes.map((t) => ({
        label: t.label,
        cells: [`${t.ratePct}%`, money(t.taxCents), t.discountCents ? money(t.discountCents) : "—", money(t.exclCents), money(t.inclCents)],
      })),
      total: {
        label: "Total",
        cells: [null, money(j.vatCents), money(j.taxes.reduce((a, t) => a + t.discountCents, 0)), money(j.totalExclCents), money(j.totalInclCents)],
      },
    },
    {
      title: "Payments",
      head: ["Payment method", "Quantity", "Amount"],
      rows: j.payments.map((p) => ({ label: p.label, cells: [String(p.n), money(p.cents)] })),
      note: { label: "Subtotal (excl credits)", cells: [null, money(j.paymentsSubtotalCents)] },
      total: { label: "Total", cells: [null, money(j.paymentsTotalCents)] },
    },
    {
      title: "Categories",
      head: ["Label", "Quantity", "%", "Excluding tax", "With tax"],
      rows: j.categories.map((c) => ({
        label: c.label,
        cells: [
          Number.isInteger(c.qty) ? String(c.qty) : c.qty.toFixed(2),
          `${c.pct.toFixed(2)}%`,
          money(c.exclCents),
          money(c.inclCents),
        ],
      })),
      total: { label: "Total", cells: [null, null, money(j.totalExclCents), money(j.totalInclCents)] },
    },
    {
      title: "User logs",
      head: ["Label", "Tickets / Invoices", "Excluding tax", "With tax"],
      rows: j.users.map((u) => ({ label: u.label, cells: [String(u.tickets), money(u.exclCents), money(u.inclCents)] })),
      total: { label: "Total", cells: [String(j.tickets), money(j.totalExclCents), money(j.totalInclCents)] },
    },
  ];
}

export function toJournalPdfProps(j: SalesJournal, businessName: string, priorRange?: Range | null): SalesJournalA4Props {
  return {
    businessName,
    periodLabel: rangeLabel({ from: j.from, to: j.to }),
    comparedWith: priorRange ? shortRangeLabel(priorRange) : null,
    tickets: j.tickets,
    totalInclLabel: money(j.totalInclCents),
    avgLabel: `Avg ${money(j.avgInclCents)}`,
    clients: j.clients,
    clientsSubLabel: `${money(j.clientInclCents)} · Avg ${money(j.clientAvgInclCents)}`,
    tables: toJournalTables(j),
  };
}

/** "Generated on Wednesday 29 July 2026" — Cashmag's "Édité le …" footer. */
export function footerLine(nowIso: string): string {
  return `Generated on ${muDayLabel(nowIso)}`;
}

export async function renderSalesJournalPdf(
  props: SalesJournalA4Props,
  nowIso: string,
  baseHref?: string,
): Promise<ArrayBuffer> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = documentHtml(renderToStaticMarkup(createElement(SalesJournalA4, props)), baseHref);
  return htmlToPdf(html, { footerLeft: footerLine(nowIso) });
}
