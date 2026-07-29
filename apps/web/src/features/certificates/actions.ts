"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";

const ROLES = ["owner", "manager", "cashier", "technician"] as const;
type Result = { ok: true; number: string } | { ok: false; error: string };
type VoidResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  jobId: z.string().min(1),
  productId: z.string().nullable().optional(),
  warrantyMonths: z.number().int().positive(),
  appliedAt: z.string().min(1), // yyyy-mm-dd
  notes: z.string().optional(),
});

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().slice(0, 10);
}

export async function createCertificateAction(input: z.infer<typeof schema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a completed job, warranty period and date." };
  const sb = await createClient();

  // The job — and, through it, customer/vehicle — is never taken from the
  // client. It's re-derived here from a job row the caller merely points at,
  // so a certificate can't be minted for work that isn't this tenant's.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: job } = await (sb as any)
    .from("jobs")
    .select("id, customer_id, vehicle_id, status")
    .eq("id", p.data.jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: "Unknown job." };
  if (job.status !== "delivered") return { ok: false, error: "Certificates can only be issued for a completed (delivered) job." };

  // A completed job isn't enough on its own — the invoice for it must be
  // settled in full, not merely issued or part-paid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (sb as any)
    .from("documents")
    .select("id, status")
    .eq("job_id", job.id)
    .eq("doc_type", "invoice")
    .eq("status", "paid")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "This job has no fully paid invoice — settle the invoice before issuing a certificate." };

  if (p.data.productId && !(await existsInTenant(sb, "products", p.data.productId))) return { ok: false, error: "Unknown treatment." };

  const expiresAt = addMonths(p.data.appliedAt, p.data.warrantyMonths);
  // Stamp who issued the certificate (the column existed but was never written).
  const { data: me } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdBy = (me as any)?.id ?? null;

  // App-assigned CERT number; retry on the (tenant, number) unique collision.
  // Order by NUMBER (not applied_at) so a backdated cert can't hide the true max,
  // and take only the top row (no row cap) — CERT-000N pads to 4 so it sorts numerically.
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: top } = await sb
      .from("certificates")
      .select("number")
      .not("number", "is", null)
      .order("number", { ascending: false })
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = /(\d+)\s*$/.exec(((top?.[0] as any)?.number as string) ?? "");
    const maxN = m ? parseInt(m[1], 10) : 0;
    const number = `CERT-${String(maxN + 1 + attempt).padStart(4, "0")}`;
    const { error } = await sb.from("certificates").insert({
      tenant_id: ctx.tenantId,
      number,
      created_by: createdBy,
      customer_id: job.customer_id,
      vehicle_id: job.vehicle_id,
      job_id: job.id,
      invoice_id: invoice.id,
      product_id: p.data.productId || null,
      applied_at: p.data.appliedAt,
      warranty_months: p.data.warrantyMonths,
      expires_at: expiresAt,
      notes: p.data.notes || null,
    });
    if (!error) {
      revalidatePath("/certificates");
      return { ok: true, number };
    }
    if (!/duplicate key|unique/i.test(error.message)) return { ok: false, error: error.message };
  }
  return { ok: false, error: "Could not assign a certificate number — please retry." };
}

/** Revoke a certificate after its invoice was credited (or issued in error).
 *  The RPC is definer-scoped and does the actual state transition + stamping;
 *  this action is just role gating + plumbing. Voiding, not deleting: the
 *  certificate stays visible everywhere it's already been referenced. */
export async function voidCertificateAction(certificateId: string, reason: string): Promise<VoidResult> {
  await requireRole("owner", "manager");
  const clean = reason.trim();
  if (!clean) return { ok: false, error: "A reason is required to void a certificate." };
  const sb = await createClient();
  const { error } = await sb.rpc("void_certificate" as never, { p_certificate_id: certificateId, p_reason: clean } as never);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/certificates");
  return { ok: true };
}
