import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/session";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { WhatsAppPanel } from "@/features/settings/WhatsAppPanel";
import { getMarketing } from "@/lib/supabase/queries/marketing";
import { secretState, probeConnection, isConfigured, webhookVerifyToken } from "@/lib/whatsapp";

// Connection page: it asks Meta whether the credentials genuinely work rather
// than merely checking that values exist — so on setup day the app itself tells
// you exactly what's missing instead of failing somewhere downstream.
export default async function WhatsAppSettingsPage() {
  await requireRole("owner"); // credentials + test sends = owner territory

  const secrets = secretState();
  const [probe, marketing] = await Promise.all([
    isConfigured() ? probeConnection() : Promise.resolve(null),
    getMarketing().catch(() => ({ templates: [], campaigns: [], approvedTemplateCount: 0 })),
  ]);

  const host = (await headers()).get("host") ?? "app-carfectionist.com";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="whatsapp" />
        <div className="mb-5">
          <h2 className="font-display text-[20px] font-extrabold text-ink-strong">WhatsApp connection</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Send quotations, invoices and campaigns from the studio&apos;s WhatsApp number — and receive every customer reply in Messages.
          </p>
        </div>
        <WhatsAppPanel
          secrets={secrets}
          probe={probe}
          templates={marketing.templates}
          webhookUrl={`${proto}://${host}/api/whatsapp/webhook`}
          verifyToken={webhookVerifyToken() ?? null}
        />
      </div>
    </div>
  );
}
