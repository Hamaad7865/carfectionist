"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/supabase/rpc";

const markerSchema = z.object({
  x: z.number(),
  y: z.number(),
  type: z.enum(["scratch", "dent", "chip", "swirl"]),
  note: z.string().optional(),
});
const photoSchema = z.object({ path: z.string().min(1), caption: z.string().optional() });

const intakeSchema = z.object({
  customerId: z.string().optional(),
  newCustomerName: z.string().optional(),
  newCustomerPhone: z.string().optional(),
  vehicleId: z.string().optional(),
  newVehiclePlate: z.string().optional(),
  newVehicleMake: z.string().optional(),
  service: z.string().optional(),
  markers: z.array(markerSchema).default([]),
  photos: z.array(photoSchema).default([]),
});

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function createIntakeQuoteAction(input: z.input<typeof intakeSchema>): Promise<Result<{ id: string }>> {
  await requireRole("owner", "manager", "cashier", "technician");
  const p = intakeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid intake" };
  if (!p.data.customerId && !(p.data.newCustomerName ?? "").trim()) return { ok: false, error: "Pick a customer or add a new one." };
  if (!p.data.vehicleId && !(p.data.newVehiclePlate ?? "").trim()) return { ok: false, error: "Pick a vehicle or add one." };
  const sb = await createClient();
  try {
    const doc = await rpc.createIntakeQuote(sb, {
      customerId: p.data.customerId || null,
      newCustomerName: p.data.newCustomerName ?? null,
      newCustomerPhone: p.data.newCustomerPhone ?? null,
      vehicleId: p.data.vehicleId || null,
      newVehiclePlate: p.data.newVehiclePlate ?? null,
      newVehicleMake: p.data.newVehicleMake ?? null,
      service: p.data.service ?? null,
      markers: p.data.markers,
      photos: p.data.photos,
    });
    revalidatePath("/jobs");
    revalidatePath("/sales"); // the new draft quote also appears under Sales
    return { ok: true, data: { id: doc.id } };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, error: /duplicate|unique/i.test(msg) ? "A vehicle with that plate already exists." : msg };
  }
}

export async function createJobFromDocumentAction(documentId: string): Promise<Result<{ jobId: string }>> {
  await requireRole("owner", "manager", "cashier");
  const sb = await createClient();
  try {
    // A quote is ACCEPTED into its job — issued (gapless number), flipped to
    // 'accepted', linked both ways, idempotent — via the same RPC the Android
    // POS uses. Non-quote documents keep the plain job-from-document path.
    const { data: doc } = await sb.from("documents").select("doc_type").eq("id", documentId).maybeSingle();
    if (!doc) return { ok: false, error: "Document not found." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const job = (doc as any).doc_type === "quote"
      ? await rpc.convertQuoteToJob(sb, documentId)
      : await rpc.createJobFromDocument(sb, documentId);
    revalidatePath("/jobs");
    revalidatePath(`/sales/${documentId}`);
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Sign the quote off WITHOUT starting the job — a quote accepted today for
 *  work booked next month should not put a car on tonight's board. "Accept →
 *  create job" (createJobFromDocumentAction) stays the other choice; same
 *  two-way split as the tablet's "signed, come back later" toggle. */
export async function acceptQuoteOnlyAction(documentId: string): Promise<Result> {
  await requireRole("owner", "manager", "cashier");
  const sb = await createClient();
  try {
    await rpc.acceptQuote(sb, documentId);
    revalidatePath("/sales");
    revalidatePath(`/sales/${documentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const addPhotoSchema = z.object({
  jobId: z.string().min(1),
  path: z.string().min(1),
  phase: z.enum(["before", "after"]),
  caption: z.string().optional(),
});

export async function addJobPhotoAction(input: z.input<typeof addPhotoSchema>): Promise<Result> {
  const ctx = await requireRole("owner", "manager", "cashier", "technician");
  const p = addPhotoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid photo" };
  // The object key must live under our tenant folder (mirrors the storage RLS).
  if (!p.data.path.startsWith(`${ctx.tenantId}/`)) return { ok: false, error: "Invalid photo path" };
  const sb = await createClient();
  const { data: job } = await sb.from("jobs").select("id").eq("id", p.data.jobId).maybeSingle();
  if (!job) return { ok: false, error: "Unknown job" };
  const { error } = await sb.from("job_photos").insert({
    tenant_id: ctx.tenantId,
    job_id: p.data.jobId,
    storage_path: p.data.path,
    phase: p.data.phase,
    caption: p.data.caption || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${p.data.jobId}`);
  return { ok: true };
}
