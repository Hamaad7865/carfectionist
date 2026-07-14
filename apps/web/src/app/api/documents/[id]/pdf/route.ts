import { getDocumentProps } from "@/lib/supabase/queries/render";
import { getSessionContext } from "@/lib/auth/session";
import { renderDocumentPdf } from "@/lib/pdf/document-pdf";
import { PdfConfigError } from "@/lib/pdf/render";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Auth (defense in depth; RLS is the real boundary on the query below).
  const session = await getSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const props = await getDocumentProps(id);
  if (!props) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentPdf(props, new URL(req.url).origin);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${props.number ?? "document"}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof PdfConfigError) {
      return new Response(
        `PDF generation is not configured yet. ${e.message}\n\n` +
          `A faithful printable view is available at /print/doc/${id} (use the browser's Print → Save as PDF).`,
        { status: 503, headers: { "Content-Type": "text/plain" } },
      );
    }
    return new Response(`PDF error: ${(e as Error).message}`, { status: 500 });
  }
}
