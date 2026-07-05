"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";

const enquirySchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  vehicleInfo: z.string().optional(),
  message: z.string().optional(),
});

export type SubmitResult = { ok: true } | { ok: false; error: string };

/** Public: unauthenticated visitors submit via the service-role client. */
export async function submitEnquiryAction(input: z.infer<typeof enquirySchema>): Promise<SubmitResult> {
  const parsed = enquirySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please enter your name." };
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: bs } = await admin.from("business_settings").select("id").limit(1).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantId = (bs as any)?.id;
  if (!tenantId) return { ok: false, error: "Unable to submit right now." };

  const { error } = await admin.from("enquiries").insert({
    tenant_id: tenantId,
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    vehicle_info: d.vehicleInfo || null,
    message: d.message || null,
    source: "web",
    status: "new",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ConvertResult = { ok: true; customerId: string } | { ok: false; error: string };

/** Convert an enquiry into a customer (owner/manager). */
export async function convertEnquiryAction(enquiryId: string): Promise<ConvertResult> {
  const ctx = await requireRole("owner", "manager");
  const sb = await createClient();
  const { data: e } = await sb.from("enquiries").select("*").eq("id", enquiryId).maybeSingle();
  if (!e) return { ok: false, error: "Enquiry not found" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enq: any = e;
  if (enq.converted_customer_id) return { ok: true, customerId: enq.converted_customer_id };

  const { data: cust, error } = await sb
    .from("customers")
    .insert({ tenant_id: ctx.tenantId, name: enq.name, phone: enq.phone, email: enq.email })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerId = (cust as any).id;

  await sb.from("enquiries").update({ status: "converted", converted_customer_id: customerId }).eq("id", enquiryId);
  revalidatePath("/enquiries");
  return { ok: true, customerId };
}
