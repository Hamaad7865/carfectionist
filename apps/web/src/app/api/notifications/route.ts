import { getSessionContext } from "@/lib/auth/session";
import { getNotifications } from "@/lib/supabase/queries/notifications";

// The bell's alerts, fetched by the client so they stay LIVE.
//
// They used to be computed in the app layout — but a layout does not re-run on
// client-side navigation, so the badge froze at whatever it said when the page
// was first loaded. Restock the shop and it still claimed you were low, until a
// hard refresh. Now the bell asks this route on mount, on every navigation, and
// on a slow timer, so it reflects what is actually true.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionContext();
  if (!session) return new Response("unauthorized", { status: 401 });
  try {
    return Response.json({ items: await getNotifications() });
  } catch {
    // The bell must never be the reason a page breaks.
    return Response.json({ items: [] });
  }
}
