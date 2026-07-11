"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type SessionContext } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";
import { logAudit } from "@/lib/supabase/audit";
import * as rpc from "@/lib/supabase/rpc";

const ROLES = ["owner", "manager", "cashier", "technician"] as const;
type Ok<T = undefined> = { ok: true; data?: T };
type Result<T = undefined> = Ok<T> | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function appUserId(sb: any, authUserId: string): Promise<string | null> {
  const { data } = await sb.from("app_users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  return data?.id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jobAudit(sb: any, ctx: SessionContext, eventType: string, jobId: string, payload: Record<string, unknown> = {}) {
  await logAudit(sb, { tenantId: ctx.tenantId, actorId: await appUserId(sb, ctx.userId), eventType, refType: "job", refId: jobId, payload });
}

const DEFAULT_CHECKLIST = [
  { label: "Intake photos & damage check", done: false },
  { label: "Wash & prep", done: false },
  { label: "Service work", done: false },
  { label: "Final inspection", done: false },
];

const createSchema = z.object({
  customerId: z.string().optional(),
  vehicleId: z.string().optional(),
  newCustomerName: z.string().trim().optional(),
  newCustomerPhone: z.string().trim().optional(),
  newVehiclePlate: z.string().trim().optional(),
  newVehicleMake: z.string().trim().optional(),
  service: z.string().optional(),
  technicianId: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
});

export async function createJobAction(input: z.input<typeof createSchema>): Promise<Result<{ id: string }>> {
  await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid job details." };
  const sb = await createClient();

  // One atomic RPC resolves-or-creates the customer + vehicle and inserts the job
  // in a single transaction — no orphan customer/vehicle if anything fails.
  try {
    const job = await rpc.createJob(sb, {
      customerId: p.data.customerId || null,
      newCustomerName: p.data.newCustomerName ?? null,
      newCustomerPhone: p.data.newCustomerPhone ?? null,
      vehicleId: p.data.vehicleId || null,
      newVehiclePlate: p.data.newVehiclePlate ?? null,
      newVehicleMake: p.data.newVehicleMake ?? null,
      service: p.data.service ?? null,
      technicianId: p.data.technicianId || null,
      department: p.data.department || null,
      checklist: DEFAULT_CHECKLIST,
    });
    revalidatePath("/jobs");
    return { ok: true, data: { id: job.id } };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: /duplicate|unique/i.test(msg) ? "A vehicle with that plate already exists." : msg };
  }
}

const DOC_ROLES = ["owner", "manager", "cashier"] as const;

export async function createDocumentFromJobAction(
  jobId: string,
  docType: "quote" | "invoice",
): Promise<Result<{ id: string }>> {
  await requireRole(...DOC_ROLES);
  if (docType !== "quote" && docType !== "invoice") return { ok: false, error: "Invalid document type." };
  const sb = await createClient();
  try {
    const doc = await rpc.createDocumentFromJob(sb, jobId, docType);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/sales");
    return { ok: true, data: { id: doc.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setJobDepartmentAction(jobId: string, department: string | null): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { error } = await sb.from("jobs").update({ department }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function assignTechnicianAction(jobId: string, technicianId: string | null): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const sb = await createClient();
  if (technicianId && !(await existsInTenant(sb, "app_users", technicianId))) return { ok: false, error: "Unknown technician." };
  const { error } = await sb.from("jobs").update({ technician_id: technicianId }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  let tech = "Unassigned";
  if (technicianId) {
    const { data } = await sb.from("app_users").select("display_name").eq("id", technicianId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tech = (((data as any)?.display_name ?? "") as string).replace(/\s*\(.*\)\s*$/, "").trim() || "a technician";
  }
  await jobAudit(sb, ctx, "technician_assigned", jobId, { tech });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function setJobStatusAction(jobId: string, status: "scheduled" | "in_progress" | "ready" | "delivered"): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { status };
  if (status === "in_progress") patch.started_at = new Date().toISOString();
  if (status === "delivered") patch.delivered_at = new Date().toISOString();
  const { error } = await sb.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  if (status === "in_progress") await jobAudit(sb, ctx, "job_started", jobId);
  else if (status === "delivered") await jobAudit(sb, ctx, "job_delivered", jobId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function toggleTimerAction(jobId: string): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const sb = await createClient();
  const { data: open } = await sb.from("job_timers").select("id").eq("job_id", jobId).is("stopped_at", null).maybeSingle();
  if (open) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sb.from("job_timers").update({ stopped_at: new Date().toISOString() }).eq("id", (open as any).id);
  } else {
    const { data: job } = await sb.from("jobs").select("technician_id, status").eq("id", jobId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const techId = (job as any)?.technician_id ?? (await appUserId(sb, ctx.userId));
    if (!techId) return { ok: false, error: "Assign a technician before starting the timer." };
    const { error } = await sb.from("job_timers").insert({ tenant_id: ctx.tenantId, job_id: jobId, technician_id: techId });
    if (error) return { ok: false, error: error.message };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((job as any)?.status === "scheduled") await sb.from("jobs").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", jobId);
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/**
 * Pause when running, resume when paused — same bookkeeping as the POS:
 * pausing stamps paused_at; resuming clears it with the finished pause folded
 * into paused_ms. Only a job in progress has a clock to pause.
 */
export async function toggleJobPauseAction(jobId: string): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const sb = await createClient();
  const { data } = await sb.from("jobs").select("status, paused_at, paused_ms").eq("id", jobId).maybeSingle();
  if (!data) return { ok: false, error: "Unknown job." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = data;
  if (j.status !== "in_progress") return { ok: false, error: "Only a job in progress can be paused." };

  const now = Date.now();
  const pausing = j.paused_at == null;
  const since = pausing ? NaN : Date.parse(j.paused_at);
  const patch = pausing
    ? { paused_at: new Date(now).toISOString() }
    : { paused_at: null, paused_ms: (j.paused_ms ?? 0) + (Number.isNaN(since) ? 0 : Math.max(0, now - since)) };
  const { error } = await sb.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  await jobAudit(sb, ctx, pausing ? "timer_paused" : "timer_resumed", jobId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function updateChecklistAction(jobId: string, checklist: { label: string; done: boolean }[]): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { error } = await sb.from("jobs").update({ checklist }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

const completeSchema = z.object({
  jobId: z.string(),
  consumptions: z.array(z.object({ productId: z.string(), qty: z.number().positive() })),
});

export async function completeJobAction(input: z.infer<typeof completeSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = completeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid consumption" };
  const sb = await createClient();
  // stop any running timer first
  const { data: open } = await sb.from("job_timers").select("id").eq("job_id", p.data.jobId).is("stopped_at", null).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (open) await sb.from("job_timers").update({ stopped_at: new Date().toISOString() }).eq("id", (open as any).id);
  // A job completed while paused keeps its clock stopped at the pause, not at
  // collection — fold the open pause first (mirrors the POS's markReady).
  const { data: pj } = await sb.from("jobs").select("paused_at, paused_ms").eq("id", p.data.jobId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pjj: any = pj;
  if (pjj?.paused_at) {
    const since = Date.parse(pjj.paused_at);
    const folded = (pjj.paused_ms ?? 0) + (Number.isNaN(since) ? 0 : Math.max(0, Date.now() - since));
    await sb.from("jobs").update({ paused_at: null, paused_ms: folded }).eq("id", p.data.jobId);
  }
  try {
    await rpc.completeJob(sb, p.data.jobId, p.data.consumptions.map((c) => ({ product_id: c.productId, qty: c.qty })));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath(`/jobs/${p.data.jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}
