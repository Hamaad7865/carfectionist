import { createClient } from "@/lib/supabase/server";
import { muDateTime } from "@/lib/mu-date";
import { normalizePhoneMU } from "@/lib/phone";

// ─── Marketing module queries (WhatsApp campaigns) ───────────────────────────
// Owner-only (RLS enforces it too). Templates are Meta-approved message designs;
// campaigns pair an approved template with a variable mapping + an audience.

export interface WaTemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variableCount: number;
  status: "draft" | "pending" | "approved" | "rejected";
  rejectReason: string | null;
  createdAt: string;
}

export interface CampaignRow {
  id: string;
  name: string;
  templateName: string;
  templateBody: string;
  status: "draft" | "sending" | "done" | "failed" | "archived";
  createdAt: string;
  total: number;
  sent: number; // sent + delivered + read
  failed: number;
}

export interface MarketingData {
  templates: WaTemplateRow[];
  campaigns: CampaignRow[];
  approvedTemplateCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getMarketing(): Promise<MarketingData> {
  const sb = await createClient();
  const [tplRes, cmpRes] = await Promise.all([
    sb.from("wa_templates").select("id, name, language, category, body, variable_count, status, reject_reason, created_at").order("created_at", { ascending: false }),
    sb.from("campaigns").select("id, name, status, created_at, wa_templates(name, body), campaign_recipients(status)").order("created_at", { ascending: false }),
  ]);

  const templates: WaTemplateRow[] = ((tplRes.data ?? []) as any[]).map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    variableCount: t.variable_count,
    status: t.status,
    rejectReason: t.reject_reason,
    createdAt: muDateTime(t.created_at),
  }));

  const campaigns: CampaignRow[] = ((cmpRes.data ?? []) as any[]).map((c) => {
    const recips = (c.campaign_recipients ?? []) as { status: string }[];
    const sent = recips.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length;
    const failed = recips.filter((r) => ["failed", "invalid"].includes(r.status)).length;
    return {
      id: c.id,
      name: c.name,
      templateName: c.wa_templates?.name ?? "—",
      templateBody: c.wa_templates?.body ?? "",
      status: c.status,
      createdAt: muDateTime(c.created_at),
      total: recips.length,
      sent,
      failed,
    };
  });

  return { templates, campaigns, approvedTemplateCount: templates.filter((t) => t.status === "approved").length };
}

export interface AudienceContact {
  id: string;
  name: string;
  isCompany: boolean;
  phoneRaw: string | null;
  phoneE164: string | null; // null → invalid/unreachable
  optedOut: boolean;
}

/** Every contact with the info the audience picker needs; phone pre-normalized. */
export async function getAudience(): Promise<AudienceContact[]> {
  const sb = await createClient();
  const { data } = await sb.from("customers").select("id, name, phone, is_company, wa_opt_out").order("name");
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    isCompany: c.is_company ?? false,
    phoneRaw: c.phone ?? null,
    phoneE164: normalizePhoneMU(c.phone),
    optedOut: c.wa_opt_out ?? false,
  }));
}

export interface CampaignRecipientRow {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  error: string | null;
  sentAt: string | null;
}

export interface CampaignDetail {
  id: string;
  name: string;
  status: "draft" | "sending" | "done" | "failed" | "archived";
  templateName: string;
  templateBody: string;
  templateLanguage: string;
  createdAt: string;
  counts: Record<string, number>;
  recipients: CampaignRecipientRow[];
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  const sb = await createClient();
  const { data: c } = await sb
    .from("campaigns")
    .select("id, name, status, created_at, wa_templates(name, body, language), campaign_recipients(id, phone_e164, status, error, sent_at, customers(name))")
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;
  const cc = c as any;

  const recipients: CampaignRecipientRow[] = ((cc.campaign_recipients ?? []) as any[])
    .map((r) => ({
      id: r.id,
      name: r.customers?.name ?? "—",
      phone: r.phone_e164 ?? null,
      status: r.status,
      error: r.error ?? null,
      sentAt: r.sent_at ? muDateTime(r.sent_at) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts: Record<string, number> = {};
  for (const r of recipients) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return {
    id: cc.id,
    name: cc.name,
    status: cc.status,
    templateName: cc.wa_templates?.name ?? "—",
    templateBody: cc.wa_templates?.body ?? "",
    templateLanguage: cc.wa_templates?.language ?? "en",
    createdAt: muDateTime(cc.created_at),
    counts,
    recipients,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
