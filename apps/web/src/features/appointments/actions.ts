"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";
import * as rpc from "@/lib/supabase/rpc";
import { isTyreShop } from "@/lib/auth/roles";
import { TYRE_CHECKLIST, DETAILING_CHECKLIST } from "@/features/jobs/checklist";
import { legacyAppointmentNotes, missingAppointmentAlignmentColumns } from "@/lib/appointments/alignment";

const ROLES = ["owner", "manager", "cashier"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type ConvertResult = { ok: true; data: { jobId: string }; warning?: string } | { ok: false; error: string };

const STATUSES = ["scheduled", "confirmed", "arrived", "done", "cancelled", "no_show"] as const;

const createSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  service: z.string().trim().optional(),
  department: z.string().nullable().optional(),
  technicianId: z.string().nullable().optional(),
  scheduledAt: z.string().min(1, "Pick a date & time"),
  notes: z.string().trim().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),
  alignedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid alignment date.").nullable().optional(),
  alignedAtKm: z.coerce.number().int().min(0).nullable().optional(),
  nextAtKm: z.coerce.number().int().min(0).nullable().optional(),
});

type AppointmentInsert = z.output<typeof createSchema>;

async function insertAppointment(
  sb: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  input: AppointmentInsert,
  historicalDepartment = false,
): Promise<{ message: string } | null> {
  const when = new Date(input.scheduledAt);
  const alignedOn = input.alignedOn?.trim() || null;
  const alignedAtKm = input.alignedAtKm ?? null;
  const nextAtKm = input.nextAtKm ?? null;
  if (Number.isNaN(when.getTime())) return { message: "Invalid date & time." };
  if (isTyreShop(tenantId) && (!alignedOn || alignedAtKm == null || nextAtKm == null)) {
    return { message: "Enter the alignment date, aligned mileage and next mileage." };
  }
  if (alignedAtKm != null && nextAtKm != null && nextAtKm <= alignedAtKm) {
    return { message: "Next mileage must be greater than aligned mileage." };
  }
  const department = input.department?.trim() || null;
  if (department && !historicalDepartment) {
    const { data: place } = await sb.from("work_places").select("id").eq("name", department).maybeSingle();
    if (!place) return { message: "Choose a current place of work." };
  }

  const base = {
    tenant_id: tenantId,
    customer_id: input.customerId,
    vehicle_id: input.vehicleId,
    service: input.service || null,
    department,
    technician_id: input.technicianId || null,
    scheduled_at: when.toISOString(),
    duration_minutes: input.durationMinutes ?? null,
    notes: input.notes || null,
    status: "scheduled",
  };
  let error: { message: string } | null = null;
  if (alignedOn && alignedAtKm != null && nextAtKm != null) {
    const extended = await sb.from("appointments").insert({
      ...base,
      aligned_on: alignedOn,
      aligned_at_km: alignedAtKm,
      next_at_km: nextAtKm,
    });
    error = extended.error;
    if (missingAppointmentAlignmentColumns(error)) {
      const legacy = await sb.from("appointments").insert({
        ...base,
        notes: legacyAppointmentNotes(input.notes, { alignedOn, alignedAtKm, nextAtKm }),
      });
      error = legacy.error;
    }
  } else {
    const insert = await sb.from("appointments").insert(base);
    error = insert.error;
  }
  return error;
}

export async function createAppointmentAction(input: z.input<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid appointment" };
  const sb = await createClient();
  if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
  const { data: veh } = await sb.from("vehicles").select("id").eq("id", p.data.vehicleId).eq("customer_id", p.data.customerId).maybeSingle();
  if (!veh) return { ok: false, error: "That vehicle does not belong to the selected customer." };
  if (p.data.technicianId && !(await existsInTenant(sb, "app_users", p.data.technicianId))) return { ok: false, error: "Unknown technician." };
  const error = await insertAppointment(sb, ctx.tenantId, p.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  return { ok: true };
}

export async function setAppointmentStatusAction(id: string, status: (typeof STATUSES)[number]): Promise<Result> {
  await requireRole(...ROLES);
  if (!STATUSES.includes(status)) return { ok: false, error: "Invalid status" };
  const sb = await createClient();
  const { error } = await sb.from("appointments").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  return { ok: true };
}

const FROM_JOB_SCHEMA = z.object({
  jobId: z.string().uuid(),
  scheduledAt: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  alignedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  alignedAtKm: z.coerce.number().int().min(0).nullable().optional(),
  nextAtKm: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().trim().optional(),
});

export async function createAppointmentFromJobAction(
  input: z.input<typeof FROM_JOB_SCHEMA>,
): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = FROM_JOB_SCHEMA.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid follow-up." };
  const sb = await createClient();
  const { data: row } = await sb
    .from("jobs")
    .select("id, status, customer_id, vehicle_id, service:notes, department, technician_id")
    .eq("id", p.data.jobId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Job not found." };
  if (!["ready", "delivered"].includes(row.status)) {
    return { ok: false, error: "Finish the job before booking its next appointment." };
  }
  const error = await insertAppointment(sb, ctx.tenantId, {
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    service: row.service ?? (isTyreShop(ctx.tenantId) ? "Wheel alignment" : undefined),
    department: row.department ?? null,
    technicianId: row.technician_id ?? null,
    scheduledAt: p.data.scheduledAt,
    durationMinutes: p.data.durationMinutes,
    alignedOn: p.data.alignedOn ?? null,
    alignedAtKm: p.data.alignedAtKm ?? null,
    nextAtKm: p.data.nextAtKm ?? null,
    notes: p.data.notes,
  }, true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  revalidatePath(`/jobs/${p.data.jobId}`);
  return { ok: true };
}

export async function convertAppointmentToJobAction(
  id: string,
  mode: "schedule" | "start_now" = "schedule",
): Promise<ConvertResult> {
  const ctx = await requireRole(...ROLES);
  if (mode !== "schedule" && mode !== "start_now") return { ok: false, error: "Choose how the job should start." };
  const sb = await createClient();
  try {
    const job = await rpc.convertAppointmentToJob(
      sb,
      id,
      mode === "start_now",
      isTyreShop(ctx.tenantId) ? TYRE_CHECKLIST : DETAILING_CHECKLIST,
    );
    revalidatePath("/appointments");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
