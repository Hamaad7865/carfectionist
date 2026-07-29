import { getSalesJournal, getTradingName } from "@/lib/supabase/queries/sales-journal";
import { getSessionContext } from "@/lib/auth/session";
import { hasModule } from "@/lib/auth/roles";
import { renderSalesJournalPdf, toJournalPdfProps } from "@/lib/pdf/sales-journal-pdf";
import { PdfConfigError } from "@/lib/pdf/render";
import { parseParams, type RawParams } from "@/features/sales-journal/params";
import { comparisonRange } from "@/features/sales-journal/periods";

/** The Sales Journal as a filed A4 report. Reads the SAME query string as the
 *  screen, so a PDF always matches the view it was printed from. */
export async function GET(req: Request) {
  // Auth (defense in depth; RLS is the real boundary on the queries below).
  const session = await getSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });
  // Same gate as the page layout: the role floor plus the owner's per-user
  // module override — a link to this endpoint must not route around either.
  if (!["owner", "manager", "accountant"].includes(session.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!hasModule(session.role, session.modules, "/sales-journal")) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams) as RawParams;
  const { range, compare, filters } = parseParams(raw);
  const prior = comparisonRange(compare, range);

  const [journal, businessName] = await Promise.all([
    getSalesJournal(range.from, range.to, filters),
    getTradingName(),
  ]);

  try {
    const pdf = await renderSalesJournalPdf(
      toJournalPdfProps(journal, businessName, prior),
      new Date().toISOString(),
      url.origin,
    );
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="sales-journal-${range.from}_${range.to}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof PdfConfigError) {
      return new Response(`PDF generation is not configured yet. ${e.message}`, { status: 503, headers: { "Content-Type": "text/plain" } });
    }
    return new Response(`PDF error: ${(e as Error).message}`, { status: 500 });
  }
}
