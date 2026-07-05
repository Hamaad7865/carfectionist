import { createClient } from "@/lib/supabase/server";

export interface CertificateRow {
  id: string;
  number: string;
  customerName: string;
  vehicle: string;
  productName: string | null;
  appliedAt: string;
  expiresAt: string;
  warrantyMonths: number;
  expired: boolean;
}
export interface CertRefCustomer {
  id: string;
  name: string;
  vehicles: { id: string; label: string }[];
}
export interface CertificatesData {
  certificates: CertificateRow[];
  customers: CertRefCustomer[];
  products: { id: string; name: string }[];
  nextNumber: string;
}

export async function getCertificates(todayISO: string): Promise<CertificatesData> {
  const sb = await createClient();
  const [certRes, custRes, vehRes, prodRes] = await Promise.all([
    sb
      .from("certificates")
      .select("id, number, applied_at, expires_at, warranty_months, customers(name), vehicles(plate, make, model), products(name)")
      .order("applied_at", { ascending: false })
      .limit(100),
    sb.from("customers").select("id, name").order("name"),
    sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate"),
    sb.from("products").select("id, name").eq("kind", "service").eq("is_active", true).order("name"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const certRows = (certRes.data ?? []) as any[];
  const certificates: CertificateRow[] = certRows.map((c) => ({
    id: c.id,
    number: c.number,
    customerName: c.customers?.name ?? "—",
    vehicle: [c.vehicles?.plate, [c.vehicles?.make, c.vehicles?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—",
    productName: c.products?.name ?? null,
    appliedAt: c.applied_at,
    expiresAt: c.expires_at,
    warrantyMonths: c.warranty_months,
    expired: c.expires_at < todayISO,
  }));

  const vehByCust = new Map<string, { id: string; label: string }[]>();
  for (const v of (vehRes.data ?? []) as any[]) {
    const label = [v.plate, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const list = vehByCust.get(v.customer_id) ?? [];
    list.push({ id: v.id, label });
    vehByCust.set(v.customer_id, list);
  }
  const customers: CertRefCustomer[] = ((custRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    vehicles: vehByCust.get(c.id) ?? [],
  }));
  const products = ((prodRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Next CERT number: highest numeric suffix + 1 (app-assigned, not the fiscal seam).
  let maxN = 0;
  for (const c of certRows) {
    const m = /(\d+)\s*$/.exec(c.number ?? "");
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const nextNumber = `CERT-${String(maxN + 1).padStart(4, "0")}`;

  return { certificates, customers, products, nextNumber };
}
