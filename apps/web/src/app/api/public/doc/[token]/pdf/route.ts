import { verifyDocToken } from "@/lib/receipt-token";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { renderDocumentPdf } from "@/lib/pdf/document-pdf";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, tokenized document PDF — the link inside document emails and the URL
// Meta's servers fetch for the WhatsApp DOCUMENT header. No session exists on
// either, so possession of a valid HMAC token IS the authorisation (same model
// as the /t/[token] ticket page); the query runs on the service role only
// AFTER the token verifies.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const docId = await verifyDocToken(decodeURIComponent(token));
  if (!docId) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();
  const props = await getDocumentProps(docId, admin);
  if (!props || !props.number) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentPdf(props, new URL(req.url).origin);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${props.number}.pdf"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return new Response(`PDF error: ${(e as Error).message}`, { status: 500 });
  }
}
