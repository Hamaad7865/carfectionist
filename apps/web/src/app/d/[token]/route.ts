import { verifyDocToken } from "@/lib/receipt-token";

// Short public link to a document PDF: /d/<token> → the tokenised PDF route.
// Exists because a WhatsApp template's URL button only allows its variable as a
// suffix at the very END of the URL — /api/public/doc/<token>/pdf can't fit
// that shape, /d/<token> can. Possession of a valid token IS the authorisation.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const docId = await verifyDocToken(token);
  if (!docId) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(`/api/public/doc/${encodeURIComponent(token)}/pdf`, req.url), 302);
}
