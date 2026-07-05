"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

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

  const expiresAt = addMonths(p.data.appliedAt, p.data.warrantyMonths);

  // App-assigned CERT number; retry on the (tenant, number) unique collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: rows } = await sb.from("certificates").select("number").order("applied_at", { ascending: false }).limit(200);
    let maxN = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (rows ?? []) as any[]) {
      const m = /(\d+)\s*$/.exec(r.number ?? "");
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    const number = `CERT-${String(maxN + 1 + attempt).padStart(4, "0")}`;
    const { error } = await sb.from("certificates").insert({
      tenant_id: ctx.tenantId,
      number,
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
