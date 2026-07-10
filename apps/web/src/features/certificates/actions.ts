"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";

const ROLES = ["owner", "manager", "cashier", "technician"] as const;
type Result = { ok: true; number: string } | { ok: false; error: string };

const schema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
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
  if (!p.success) return { ok: false, error: "Pick a customer, vehicle, warranty period and date." };
  const sb = await createClient();

  // Client-supplied FKs must belong to the caller's tenant.
  if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
  if (!(await existsInTenant(sb, "vehicles", p.data.vehicleId))) return { ok: false, error: "Unknown vehicle." };
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
      customer_id: p.data.customerId,
      vehicle_id: p.data.vehicleId,
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
