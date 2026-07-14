import { MessageCircle } from "lucide-react";
import { getConversations, getThread } from "@/lib/supabase/queries/inbox";
import { getMarketing } from "@/lib/supabase/queries/marketing";
import { InboxPanel } from "@/features/inbox/InboxPanel";
import { isConfigured } from "@/lib/whatsapp";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const connected = isConfigured();

  const { rows, unreadTotal } = await getConversations();
  // Templates are the only legal reply once the 24h window closes — owner-only
  // RLS means a cashier gets an empty list, which the panel handles.
  const [thread, marketing] = await Promise.all([
    sp.c ? getThread(sp.c) : Promise.resolve(null),
    getMarketing().catch(() => ({ templates: [], campaigns: [], approvedTemplateCount: 0 })),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <div className="border-l-[3px] border-mint pl-3.5">
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint">
            <MessageCircle size={13} /> WhatsApp
          </div>
          <h2 className="font-display text-[22px] font-extrabold text-ink-strong">Messages</h2>
          <div className="mt-0.5 text-[12.5px] text-muted">
            Customer replies to the studio&apos;s WhatsApp number{unreadTotal > 0 ? ` · ${unreadTotal} unread` : ""}
          </div>
        </div>
      </div>

      {!connected && (
        <div className="rounded-[12px] border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.08)] px-4 py-3 text-[12.5px] text-amber-ink">
          <span className="font-bold">WhatsApp isn&apos;t connected yet.</span> Once the Meta credentials are set, every message a customer sends to the studio&apos;s number lands here — photos included — and any of your staff can reply.
        </div>
      )}

      <InboxPanel conversations={rows} thread={thread} templates={marketing.templates} connected={connected} />
    </div>
  );
}
