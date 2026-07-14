"use server";

import { requireRole } from "@/lib/auth/session";
import { normalizePhoneMU } from "@/lib/phone";
import * as wa from "@/lib/whatsapp";

/** Fire Meta's own canonical test message (the pre-approved `hello_world`
 *  template) at a number. If this arrives, the whole sending chain — token,
 *  phone id, permissions, billing — is genuinely working. */
export async function sendTestMessageAction(to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("owner", "manager");
  const phone = normalizePhoneMU(to);
  if (!phone) return { ok: false, error: "That phone number doesn't look right." };
  if (!wa.isConfigured()) return { ok: false, error: "Add the WhatsApp credentials first." };

  const r = await wa.sendHelloWorld(phone);
  if (!r.ok) {
    // Translate the two failures you actually hit while setting up.
    if (/131030|not in allowed list|recipient/i.test(r.error)) {
      return { ok: false, error: "That number isn't on the test number's allow-list — add it in Meta (WhatsApp → API Setup → Manage phone number list)." };
    }
    if (/hello_world|template.*not exist|132001/i.test(r.error)) {
      return { ok: false, error: "Meta's hello_world test template isn't on this account. Send a real document instead to test." };
    }
    return r;
  }
  return { ok: true };
}

/** Ask Meta which WhatsApp account(s) and number(s) this token can use, so the
 *  operator never has to hunt for the two IDs in Meta's console. */
export async function discoverIdsAction(): Promise<
  { ok: true; data: wa.DiscoveredWaba[] } | { ok: false; error: string }
> {
  await requireRole("owner");
  return wa.discoverIds();
}
