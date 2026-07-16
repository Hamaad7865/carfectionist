import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Where the link in the reset email lands.
//
// This is a Route Handler and not a page on purpose: redeeming the token has to
// SET the session cookie, and a Server Component render can't set cookies (see
// the swallowed throw in lib/supabase/server.ts). So the token is spent here,
// the cookie is written, and the browser is sent on to the form.
//
// The redirect afterwards matters too. A recovery token is single-use, so if the
// form lived at this URL a refresh — or a mail client that pre-fetches links —
// would spend the token and lock the person out of their own reset. Landing them
// on a clean /update-password means the page they can actually reload is not the
// page that consumes anything.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tokenHash = new URL(req.url).searchParams.get("token_hash");
  if (!tokenHash) redirect("/forgot-password?expired=1");

  const sb = await createClient();
  const { error } = await sb.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  // Expired, already spent, or tampered with — all the same dead end, and the
  // page it lands on offers a fresh link rather than an apology.
  if (error) redirect("/forgot-password?expired=1");

  redirect("/update-password");
}
