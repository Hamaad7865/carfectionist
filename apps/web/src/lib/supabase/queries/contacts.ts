import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ContactVehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  category: string | null;
  vin: string | null;
  notes: string | null;
  isActive: boolean;
  isCoated: boolean;
}
export interface ContactDoc {
  id: string;
  number: string | null;
  status: string;
  date: string;
  totalCents: number;
}
export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  brn: string | null;
  vatNumber: string | null;
  notes: string | null;
  country: string;
  isCompany: boolean;
  vehicleCount: number;
  outstandingCents: number;
  pointsBalance: number;
}
export interface PointsLedgerEntry {
  id: string;
  delta: number;
  reason: string; // 'earned' | 'redeemed' | 'adjusted' | 'reversed'
  note: string | null;
  createdAt: string;
}
export interface CustomerDetail extends CustomerSummary {
  spendCents: number;
  waOptOut: boolean;
  vehicles: ContactVehicle[];
  history: ContactDoc[];
  /** What one point is worth right now (business_settings.point_value_rupees) —
   *  rides along with the customer so the panel needs no second fetch. */
  pointValueRupees: number;
  /** Newest first — every movement, same order as the ledger's own index. */
  pointsHistory: PointsLedgerEntry[];
}
export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  brn: string | null;
  vatNumber: string | null;
  notes: string | null;
}

export interface ContactsData {
  customers: CustomerSummary[];
  selected: CustomerDetail | null;
  suppliers: SupplierRow[];
}

export async function getContacts(selectedId?: string): Promise<ContactsData> {
  const sb = await createClient();
  const [custRes, vehRes, docRes, supRes, bsRes] = await Promise.all([
    sb.from("customers").select("id, name, phone, email, address, brn, vat_number, notes, country, is_company, wa_opt_out, points_balance").order("name"),
    sb.from("vehicles").select("id, customer_id, make, model, plate, color, year, category, vin, notes, is_active, is_coated"),
    sb.from("documents").select("id, customer_id, doc_type, number, status, total_incl, amount_paid, issue_date, created_at"),
    sb.from("suppliers").select("id, name, phone, email, address, brn, vat_number, notes").order("name"),
    sb.from("business_settings").select("point_value_rupees").limit(1).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vehicles = (vehRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (docRes.data ?? []) as any[];

  const outstandingByCust = new Map<string, number>();
  const spendByCust = new Map<string, number>();
  for (const d of docs) {
    if (!d.customer_id || d.doc_type !== "invoice") continue;
    if (["issued", "partly_paid", "paid"].includes(d.status)) {
      spendByCust.set(d.customer_id, (spendByCust.get(d.customer_id) ?? 0) + rupeesToCents(Number(d.total_incl)));
    }
    if (["issued", "partly_paid"].includes(d.status)) {
      outstandingByCust.set(d.customer_id, (outstandingByCust.get(d.customer_id) ?? 0) + rupeesToCents(Number(d.total_incl) - Number(d.amount_paid)));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers: CustomerSummary[] = ((custRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    brn: c.brn,
    vatNumber: c.vat_number,
    notes: c.notes,
    country: c.country ?? "MU",
    isCompany: c.is_company ?? false,
    vehicleCount: vehicles.filter((v) => v.customer_id === c.id).length,
    outstandingCents: outstandingByCust.get(c.id) ?? 0,
    pointsBalance: c.points_balance ?? 0,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const optOutById = new Map<string, boolean>(((custRes.data ?? []) as any[]).map((c) => [c.id, c.wa_opt_out ?? false]));

  const selId = selectedId && customers.some((c) => c.id === selectedId) ? selectedId : customers[0]?.id;
  let selected: CustomerDetail | null = null;
  if (selId) {
    const base = customers.find((c) => c.id === selId)!;
    // Scoped to the one customer being viewed, unlike vehicles/docs above (fetched for
    // everyone so the list can show counts) — nothing else on this page needs another
    // customer's ledger, and it can grow one row per invoice plus every reversal.
    const { data: ledgerRows } = await sb
      .from("customer_points_ledger")
      .select("id, delta, reason, note, created_at")
      .eq("customer_id", selId)
      .order("created_at", { ascending: false });
    selected = {
      ...base,
      spendCents: spendByCust.get(selId) ?? 0,
      waOptOut: optOutById.get(selId) ?? false,
      vehicles: vehicles
        .filter((v) => v.customer_id === selId)
        .map((v) => ({ id: v.id, plate: v.plate, make: v.make, model: v.model, year: v.year, color: v.color, category: v.category, vin: v.vin, notes: v.notes, isActive: v.is_active ?? true, isCoated: v.is_coated ?? false })),
      history: docs
        .filter((d) => d.customer_id === selId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((d) => ({
          id: d.id,
          number: d.number,
          status: d.status,
          date: d.issue_date ?? (d.created_at as string).slice(0, 10),
          totalCents: rupeesToCents(Number(d.total_incl)),
        })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pointValueRupees: Number((bsRes.data as any)?.point_value_rupees ?? 1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pointsHistory: ((ledgerRows ?? []) as any[]).map((l) => ({
        id: l.id,
        delta: Number(l.delta),
        reason: l.reason,
        note: l.note,
        createdAt: l.created_at,
      })),
    };
  }

  return {
    customers,
    selected,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suppliers: ((supRes.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name, phone: s.phone, email: s.email, address: s.address, brn: s.brn, vatNumber: s.vat_number, notes: s.notes })),
  };
}
