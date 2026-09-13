import { Suspense } from "react";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { TicketPopup } from "./TicketPopup";
import { EmailReceiptButton } from "./EmailReceiptButton";

/**
 * Receipt popup with its own data fetch, so the page behind it never waits
 * for the receipt. Clicking a ticket used to re-render the whole list
 * server-side AND block its first byte on getReceipt (8+ round-trips plus a
 * storage signing) — the list visibly hung before the popup appeared. Now the
 * caller renders `<Suspense><TicketPopupLoader/></Suspense>`: the list paints
 * immediately and the popup streams in when its queries land.
 */
export async function TicketPopupLoader({ docId, param = "t" }: { docId: string; param?: string }) {
  const r = await getReceipt(docId);
  if (!r) return null;
  return (
    <TicketPopup
      r={r}
      docId={docId}
      param={param}
      emailSlot={<EmailReceiptButton docId={docId} defaultEmail={r.customerEmail} />}
    />
  );
}

/** The Suspense boundary callers wrap the loader in (one import, no thinking). */
export function TicketPopupBoundary({ docId, param = "t" }: { docId: string; param?: string }) {
  return (
    <Suspense fallback={null}>
      <TicketPopupLoader docId={docId} param={param} />
    </Suspense>
  );
}
