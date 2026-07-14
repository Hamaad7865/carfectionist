import { getStatementProps } from "@/lib/supabase/queries/render";
import { getSessionContext } from "@/lib/auth/session";
import { renderStatementPdf } from "@/lib/pdf/statement-pdf";
import { PdfConfigError } from "@/lib/pdf/render";

export async function GET(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;

  // Auth (defense in depth; RLS is the real boundary on the query below).
  const session = await getSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const props = await getStatementProps(customerId);
  if (!props) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderStatementPdf(props, new URL(req.url).origin);
    const safe = props.customerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="statement-${safe}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof PdfConfigError) {
      return new Response(`PDF generation is not configured yet. ${e.message}`, { status: 503, headers: { "Content-Type": "text/plain" } });
    }
    return new Response(`PDF error: ${(e as Error).message}`, { status: 500 });
  }
}
