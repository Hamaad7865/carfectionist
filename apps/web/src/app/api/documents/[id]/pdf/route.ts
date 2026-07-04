import { createElement } from "react";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { getSessionContext } from "@/lib/auth/session";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { htmlToPdf, documentHtml, PdfConfigError } from "@/lib/pdf/render";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Auth (defense in depth; RLS is the real boundary on the query below).
  const session = await getSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const props = await getDocumentProps(id);
  if (!props) return new Response("Not found", { status: 404 });

  // Dynamic import dodges Next's RSC-context guard on react-dom/server.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = documentHtml(renderToStaticMarkup(createElement(DocumentA4, props)));

  try {
    const pdf = await htmlToPdf(html);
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
