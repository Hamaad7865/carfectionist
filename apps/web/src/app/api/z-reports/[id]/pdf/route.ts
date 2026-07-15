import { getZReportProps } from "@/lib/supabase/queries/render";
import { getSessionContext } from "@/lib/auth/session";
import { renderZReportPdf } from "@/lib/pdf/zreport-pdf";
import { PdfConfigError } from "@/lib/pdf/render";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const props = await getZReportProps(id);
  if (!props) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderZReportPdf(props, new URL(req.url).origin);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${props.number}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof PdfConfigError) return new Response(`PDF generation is not configured yet. ${e.message}`, { status: 503, headers: { "Content-Type": "text/plain" } });
    return new Response(`PDF error: ${(e as Error).message}`, { status: 500 });
  }
}
