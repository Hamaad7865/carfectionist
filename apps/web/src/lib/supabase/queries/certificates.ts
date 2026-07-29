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
  voidedAt: string | null;
  voidReason: string | null;
}
/** A delivered job with a settled invoice — the only jobs a certificate can be
 *  issued against. Selecting one pins customer/vehicle/invoice server-side;
 *  the create form never lets the caller pick those independently. */
export interface CertEligibleJob {
  id: string;
  customerName: string;
  vehicle: string;
  plate: string | null;
  invoiceNumber: string | null;
}
export interface CertificatesData {
  certificates: CertificateRow[];
  jobs: CertEligibleJob[];
  products: { id: string; name: string }[];
  nextNumber: string;
  studioName: string;
}

export async function getCertificates(todayISO: string): Promise<CertificatesData> {
  const sb = await createClient();
  const [certRes, jobsRes, invRes, prodRes, bsRes, usersRes] = await Promise.all([
    sb
      .from("certificates")
      .select(
        "id, number, applied_at, expires_at, warranty_months, created_by, job_id, voided_at, void_reason, customers(name), vehicles(plate, make, model, color), products(name)",
      )
      .order("applied_at", { ascending: false })
      .limit(100),
    // Only a DELIVERED job is "work done"; only a PAID invoice on that job is
    // "work paid for" — the pair a certificate is allowed to reference.
    sb
      .from("jobs")
      .select("id, customer_id, vehicle_id, delivered_at, customers(name), vehicles(plate, make, model)")
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false })
      .limit(200),
    sb.from("documents").select("id, number, job_id").eq("doc_type", "invoice").eq("status", "paid").not("job_id", "is", null),
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
    voidedAt: c.voided_at ?? null,
    voidReason: c.void_reason ?? null,
  }));

  // First paid invoice found per job (a job that was re-invoiced after a void
  // keeps only its currently-paid one eligible).
  const invoiceByJob = new Map<string, { number: string | null }>();
  for (const inv of (invRes.data ?? []) as any[]) {
    if (inv.job_id && !invoiceByJob.has(inv.job_id)) invoiceByJob.set(inv.job_id, { number: inv.number ?? null });
  }
  const jobs: CertEligibleJob[] = ((jobsRes.data ?? []) as any[])
    .filter((j) => invoiceByJob.has(j.id))
    .map((j) => ({
      id: j.id,
      customerName: j.customers?.name ?? "—",
      vehicle: [j.vehicles?.make, j.vehicles?.model].filter(Boolean).join(" ") || "Vehicle",
      plate: j.vehicles?.plate ?? null,
      invoiceNumber: invoiceByJob.get(j.id)!.number,
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

  return { certificates, jobs, products, nextNumber, studioName };
}

export async function getCertificate(id: string, todayISO: string): Promise<{ cert: CertificateRow; studioName: string } | null> {
  const sb = await createClient();
  const { data: c } = await sb
    .from("certificates")
    .select(
      "id, number, applied_at, expires_at, warranty_months, created_by, job_id, voided_at, void_reason, customers(name), vehicles(plate, make, model, color), products(name)",
    )
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
    voidedAt: cc.voided_at ?? null,
    voidReason: cc.void_reason ?? null,
  };
  const studioName = (bsRes.data as any)?.trading_name ?? "Carfectionist";
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { cert, studioName };
}
