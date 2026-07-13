"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { normalizePhoneMU } from "@/lib/phone";
import { countVariables, renderVariables } from "./render";
import * as wa from "@/lib/whatsapp";

type Result = { ok: true } | { ok: false; error: string };
type IdResult = { ok: true; id: string } | { ok: false; error: string };

// One send invocation drains this many pending recipients. ~300ms/send on the
// Graph API keeps a batch well inside the Worker's CPU budget; the client
// re-invokes until nothing is pending, so a campaign of any size completes.
const BATCH = 25;

/* ── templates ─────────────────────────────────────────────────────────────*/

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().regex(/^[a-z0-9_]{1,120}$/, "Use lowercase letters, numbers and underscores"),
  language: z.enum(["en", "fr"]),
  body: z.string().min(1).max(1024),
});

export async function saveTemplateAction(input: z.infer<typeof templateSchema>): Promise<IdResult> {
  const ctx = await requireRole("owner");
  const p = templateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid template" };
  const sb = await createClient();
  const variableCount = countVariables(p.data.body);
  if (variableCount > 10) return { ok: false, error: "Too many variables (max 10)." };

  const row = {
    tenant_id: ctx.tenantId,
    name: p.data.name,
    language: p.data.language,
    body: p.data.body,
    variable_count: variableCount,
    status: "draft" as const,
  };

  try {
    if (p.data.id) {
      // Editing is only allowed while still a draft/rejected (approved designs are frozen).
      const { data, error } = await sb
        .from("wa_templates")
        .update({ name: row.name, language: row.language, body: row.body, variable_count: variableCount, status: "draft", reject_reason: null })
        .eq("id", p.data.id)
        .in("status", ["draft", "rejected"])
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, error: "This template can no longer be edited (already submitted)." };
      revalidatePath("/marketing");
      return { ok: true, id: data.id };
    }
    const { data, error } = await sb.from("wa_templates").insert(row).select("id").single();
    if (error) throw error;
    revalidatePath("/marketing");
    return { ok: true, id: data.id };
  } catch (e) {
    const msg = (e as { message?: string }).message ?? "Could not save template";
    if (/duplicate key/i.test(msg)) return { ok: false, error: "A template with that name and language already exists." };
    return { ok: false, error: msg };
  }
}

export async function submitTemplateAction(input: { id: string; examples: string[] }): Promise<Result> {
  await requireRole("owner");
  const sb = await createClient();
  const { data: t } = await sb.from("wa_templates").select("name, language, category, body, status").eq("id", input.id).maybeSingle();
  if (!t) return { ok: false, error: "Template not found." };
  if (t.status === "approved") return { ok: false, error: "Already approved." };

  const res = await wa.submitTemplate({
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    variableExamples: (input.examples ?? []).map((s) => s || "example"),
  });
  if (!res.ok) return res;

  await sb.from("wa_templates").update({ status: "pending", meta_template_id: res.data.id }).eq("id", input.id);
  revalidatePath("/marketing");
  return { ok: true };
}

export async function syncTemplatesAction(): Promise<Result> {
  await requireRole("owner");
  const res = await wa.fetchTemplateStatuses();
  if (!res.ok) return res;
  const sb = await createClient();
  const map: Record<string, "pending" | "approved" | "rejected"> = {
    APPROVED: "approved", PENDING: "pending", IN_APPEAL: "pending", REJECTED: "rejected", PENDING_DELETION: "pending",
  };
  for (const t of res.data) {
    const status = map[t.status];
    if (!status) continue;
    await sb.from("wa_templates").update({ status, reject_reason: status === "rejected" ? t.reason : null, meta_template_id: t.id })
      .eq("name", t.name).neq("status", status);
  }
  revalidatePath("/marketing");
  return { ok: true };
}

export async function deleteTemplateAction(id: string): Promise<Result> {
  await requireRole("owner");
  const sb = await createClient();
  const { error } = await sb.from("wa_templates").delete().eq("id", id).in("status", ["draft", "rejected"]);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/marketing");
  return { ok: true };
}

/* ── campaigns ─────────────────────────────────────────────────────────────*/

const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  templateId: z.string().min(1),
  variableMap: z.record(z.string(), z.string()),
  audience: z.object({ filter: z.string(), customerIds: z.array(z.string()) }),
});

export async function createCampaignAction(input: z.infer<typeof createCampaignSchema>): Promise<IdResult> {
  const ctx = await requireRole("owner");
  const p = createCampaignSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid campaign" };
  if (p.data.audience.customerIds.length === 0) return { ok: false, error: "Pick at least one recipient." };
  const sb = await createClient();

  const { data: tpl } = await sb.from("wa_templates").select("id, variable_count, status").eq("id", p.data.templateId).maybeSingle();
  if (!tpl) return { ok: false, error: "Template not found." };
  if (tpl.status !== "approved") return { ok: false, error: "That template isn't approved by WhatsApp yet." };

  // Load the chosen contacts (RLS-scoped) and render each one's variables.
  const { data: contacts } = await sb.from("customers").select("id, name, phone, wa_opt_out").in("id", p.data.audience.customerIds);
  const rows = (contacts ?? []) as { id: string; name: string; phone: string | null; wa_opt_out: boolean }[];

  const { data: campaign, error: cErr } = await sb
    .from("campaigns")
    .insert({ tenant_id: ctx.tenantId, name: p.data.name, wa_template_id: p.data.templateId, variable_map: p.data.variableMap, audience: p.data.audience, status: "draft" })
    .select("id")
    .single();
  if (cErr) return { ok: false, error: cErr.message };

  const recipients = rows.map((c) => {
    const phone = normalizePhoneMU(c.phone);
    const optedOut = c.wa_opt_out;
    return {
      tenant_id: ctx.tenantId,
      campaign_id: campaign.id,
      customer_id: c.id,
      phone_e164: phone,
      variables: renderVariables(p.data.variableMap, tpl.variable_count, { name: c.name }),
      status: optedOut ? "skipped" : phone ? "pending" : "invalid",
      error: optedOut ? "Opted out of WhatsApp" : phone ? null : "No valid phone number",
    };
  });
  if (recipients.length > 0) {
    const { error: rErr } = await sb.from("campaign_recipients").insert(recipients);
    if (rErr) return { ok: false, error: rErr.message };
  }

  revalidatePath("/marketing");
  return { ok: true, id: campaign.id };
}

/** Send the next batch of pending recipients. Returns how many still remain so
 *  the client can call again until zero. Restartable — state is in the rows. */
export async function sendBatchAction(campaignId: string): Promise<{ ok: true; remaining: number; sentNow: number } | { ok: false; error: string }> {
  await requireRole("owner");
  if (!wa.isConfigured()) return { ok: false, error: "WhatsApp isn't connected yet — add the Meta Cloud API credentials to this deployment." };
  const sb = await createClient();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, status, wa_templates(name, language)")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tpl = (campaign as any).wa_templates as { name: string; language: string };

  await sb.from("campaigns").update({ status: "sending" }).eq("id", campaignId).eq("status", "draft");

  const { data: batch } = await sb
    .from("campaign_recipients")
    .select("id, phone_e164, variables")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .limit(BATCH);
  const pending = (batch ?? []) as { id: string; phone_e164: string | null; variables: string[] }[];

  let sentNow = 0;
  for (const r of pending) {
    if (!r.phone_e164) {
      await sb.from("campaign_recipients").update({ status: "invalid", error: "No valid phone number" }).eq("id", r.id);
      continue;
    }
    const res = await wa.sendTemplate(r.phone_e164, tpl.name, tpl.language, r.variables ?? []);
    if (res.ok) {
      await sb.from("campaign_recipients").update({ status: "sent", wa_message_id: res.data.messageId, sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
      sentNow++;
    } else {
      await sb.from("campaign_recipients").update({ status: "failed", error: res.error }).eq("id", r.id);
    }
  }

  const { count: remaining } = await sb
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  const left = remaining ?? 0;

  if (left === 0) {
    // Any failures → campaign 'failed', else 'done'.
    const { count: failed } = await sb.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed");
    await sb.from("campaigns").update({ status: (failed ?? 0) > 0 ? "failed" : "done" }).eq("id", campaignId);
  }

  revalidatePath(`/marketing/${campaignId}`);
  return { ok: true, remaining: left, sentNow };
}

export async function archiveCampaignAction(id: string): Promise<Result> {
  await requireRole("owner");
  const sb = await createClient();
  const { error } = await sb.from("campaigns").update({ status: "archived" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/marketing");
  return { ok: true };
}

/* ── contact opt-out ───────────────────────────────────────────────────────*/

export async function setWaOptOutAction(customerId: string, optOut: boolean): Promise<Result> {
  await requireRole("owner", "manager");
  const sb = await createClient();
  const { error } = await sb.from("customers").update({ wa_opt_out: optOut }).eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contacts/${customerId}`);
  return { ok: true };
}
