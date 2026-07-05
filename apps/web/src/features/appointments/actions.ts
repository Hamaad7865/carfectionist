"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";
import { createJobAction } from "@/features/jobs/actions";

const ROLES = ["owner", "manager", "cashier"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const STATUSES = ["scheduled", "confirmed", "arrived", "done", "cancelled", "no_show"] as const;

const createSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  service: z.string().trim().optional(),
  department: z.string().nullable().optional(),
  technicianId: z.string().nullable().optional(),
  scheduledAt: z.string().min(1, "Pick a date & time"),
  notes: z.string().trim().optional(),
});

export async function createAppointmentAction(input: z.input<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid appointment" };
  const sb = await createClient();
  if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
  const { data: veh } = await sb.from("vehicles").select("id").eq("id", p.data.vehicleId).eq("customer_id", p.data.customerId).maybeSingle();
  if (!veh) return { ok: false, error: "That vehicle does not belong to the selected customer." };
  if (p.data.technicianId && !(await existsInTenant(sb, "app_users", p.data.technicianId))) return { ok: false, error: "Unknown technician." };

  // datetime-local is a naive wall-clock string — convert to a real UTC instant
  // so it stores/compares correctly (matches every other timestamp write).
  const when = new Date(p.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date & time." };

  const { error } = await sb.from("appointments").insert({
    tenant_id: ctx.tenantId,
    customer_id: p.data.customerId,
    vehicle_id: p.data.vehicleId,
    service: p.data.service || null,
    department: p.data.department || null,
    technician_id: p.data.technicianId || null,
    scheduled_at: when.toISOString(),
    notes: p.data.notes || null,
    status: "scheduled",
  });
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

export async function convertAppointmentToJobAction(id: string): Promise<Result<{ jobId: string }>> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { data: apt } = await sb
    .from("appointments")
    .select("customer_id, vehicle_id, service, department, technician_id, job_id")
    .eq("id", id)
    .maybeSingle();
  if (!apt) return { ok: false, error: "Appointment not found." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = apt as any;
  if (a.job_id) return { ok: false, error: "This appointment is already a job." };

  const job = await createJobAction({
    customerId: a.customer_id,
    vehicleId: a.vehicle_id,
    service: a.service ?? undefined,
    technicianId: a.technician_id ?? null,
    department: a.department ?? null,
  });
  if (!job.ok || !job.data) return { ok: false, error: job.ok ? "Could not create the job." : job.error };

  const { error } = await sb.from("appointments").update({ job_id: job.data.id, status: "arrived" }).eq("id", id);
  if (error) {
    // Link failed — roll back the just-created job so we don't leave an orphan
    // (or allow a duplicate job when the user retries).
    await sb.from("jobs").delete().eq("id", job.data.id);
    return { ok: false, error: error.message };
  }
  revalidatePath("/appointments");
  revalidatePath("/jobs");
  return { ok: true, data: { jobId: job.data.id } };
}
