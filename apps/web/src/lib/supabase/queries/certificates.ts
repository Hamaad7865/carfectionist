import { createClient } from "@/lib/supabase/server";

export interface CertificateRow {
  id: string;
  number: string;
  customerName: string;
  vehicle: string; // "make model"
  plate: string | null;
  colour: string | null;
  productName: string | null;
  appliedBy: string | null;
  appliedAt: string;
  expiresAt: string;
  warrantyMonths: number;
  jobRef: string | null;
  jobId: string | null; // → /jobs/[id], where the full flow stepper lives
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
  studioName: string;
}

export async function getCertificates(todayISO: string): Promise<CertificatesData> {
  const sb = await createClient();
  const [certRes, custRes, vehRes, prodRes, bsRes, usersRes] = await Promise.all([
    sb
      .from("certificates")
      .select("id, number, applied_at, expires_at, warranty_months, created_by, job_id, customers(name), vehicles(plate, make, model, color), products(name)")
      .order("applied_at", { ascending: false })
      .limit(100),
    sb.from("customers").select("id, name").order("name"),
    sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate"),
    sb.from("products").select("id, name").eq("kind", "service").eq("is_active", true).order("name"),
    sb.from("business_settings").select("trading_name").limit(1).maybeSingle(),
    sb.from("app_users").select("id, display_name"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const userName = new Map<string, string>();
  for (const u of (usersRes.data ?? []) as any[]) userName.set(u.id, (u.display_name ?? "").replace(/\s*\(.*\)\s*$/, "").trim());

  const certRows = (certRes.data ?? []) as any[];
  const certificates: CertificateRow[] = certRows.map((c) => ({
    id: c.id,
    number: c.number,
    customerName: c.customers?.name ?? "—",
    vehicle: [c.vehicles?.make, c.vehicles?.model].filter(Boolean).join(" ") || "Vehicle",
    plate: c.vehicles?.plate ?? null,
    colour: c.vehicles?.color ?? null,
    productName: c.products?.name ?? null,
    appliedBy: c.created_by ? userName.get(c.created_by) ?? null : null,
    appliedAt: c.applied_at,
    expiresAt: c.expires_at,
    warrantyMonths: c.warranty_months,
    jobRef: c.job_id ? `JOB-${String(c.job_id).slice(0, 4).toUpperCase()}` : null,
    jobId: c.job_id ?? null,
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
  const studioName = (bsRes.data as any)?.trading_name ?? "Carfectionist";
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Next CERT number: highest numeric suffix + 1 (app-assigned, not the fiscal seam).
  let maxN = 0;
  for (const c of certRows) {
    const m = /(\d+)\s*$/.exec(c.number ?? "");
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const nextNumber = `CERT-${String(maxN + 1).padStart(4, "0")}`;

  return { certificates, customers, products, nextNumber, studioName };
}

export async function getCertificate(id: string, todayISO: string): Promise<{ cert: CertificateRow; studioName: string } | null> {
  const sb = await createClient();
  const { data: c } = await sb
    .from("certificates")
    .select("id, number, applied_at, expires_at, warranty_months, created_by, job_id, customers(name), vehicles(plate, make, model, color), products(name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cc = c as any;
  const [bsRes, userRes] = await Promise.all([
    sb.from("business_settings").select("trading_name").limit(1).maybeSingle(),
    cc.created_by ? sb.from("app_users").select("display_name").eq("id", cc.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cert: CertificateRow = {
    id: cc.id,
    number: cc.number,
    customerName: cc.customers?.name ?? "—",
    vehicle: [cc.vehicles?.make, cc.vehicles?.model].filter(Boolean).join(" ") || "Vehicle",
    plate: cc.vehicles?.plate ?? null,
    colour: cc.vehicles?.color ?? null,
    productName: cc.products?.name ?? null,
    appliedBy: (userRes.data as any)?.display_name ? String((userRes.data as any).display_name).replace(/\s*\(.*\)\s*$/, "").trim() : null,
    appliedAt: cc.applied_at,
    expiresAt: cc.expires_at,
    warrantyMonths: cc.warranty_months,
    jobRef: cc.job_id ? `JOB-${String(cc.job_id).slice(0, 4).toUpperCase()}` : null,
    jobId: cc.job_id ?? null,
    expired: cc.expires_at < todayISO,
  };
  const studioName = (bsRes.data as any)?.trading_name ?? "Carfectionist";
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { cert, studioName };
}
