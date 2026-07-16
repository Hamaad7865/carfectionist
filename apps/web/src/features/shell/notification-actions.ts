"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { collectNotifications } from "@/lib/supabase/queries/notifications";
import { muToday } from "@/lib/mu-date";

// Clearing an alert off your own bell. Not role-gated: everyone has a bell, and
// dismissing is not a privileged act — RLS pins each row to the person who wrote
// it, so you can only ever clear your own.

type Result = { ok: true } | { ok: false; error: string };

const dismissSchema = z.object({ key: z.string().min(1).max(40) });

/** Record "seen" for the given alerts — or all of them when keys is null.
 *
 *  The size stored is the one the SERVER computes, never a number the browser
 *  sent: an out-of-date tab claiming it saw 900 low-stock items would otherwise
 *  silence the alert for the rest of the day. If the alert has already resolved
 *  by the time the click lands there is nothing to record, and that is fine. */
async function markSeen(keys: string[] | null): Promise<Result> {
  const session = await requireSession();
  const sb = await createClient();
  const today = muToday();

  const [items, me] = await Promise.all([
    collectNotifications(sb, today),
    sb.from("app_users").select("id").eq("auth_user_id", session.userId).maybeSingle(),
  ]);

  const appUserId = me.data?.id;
  if (!appUserId) return { ok: false, error: "Could not identify you." };

  const targets = keys ? items.filter((i) => keys.includes(i.key)) : items;
  if (targets.length === 0) return { ok: true }; // already gone — nothing to remember

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).from("notification_dismissals").upsert(
    targets.map((i) => ({
      tenant_id: session.tenantId,
      app_user_id: appUserId,
      key: i.key,
      seen_count: i.count,
      dismissed_day: today,
      dismissed_at: new Date().toISOString(),
    })),
    { onConflict: "app_user_id,key" },
  );
  if (error) return { ok: false, error: "Could not clear that alert." };
  return { ok: true };
}

export async function dismissNotificationAction(input: z.infer<typeof dismissSchema>): Promise<Result> {
  const parsed = dismissSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown alert." };
  return markSeen([parsed.data.key]);
}

export async function dismissAllNotificationsAction(): Promise<Result> {
  return markSeen(null);
}
