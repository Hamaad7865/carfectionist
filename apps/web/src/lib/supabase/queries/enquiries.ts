import { createClient } from "@/lib/supabase/server";

export interface EnquiryRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  vehicleInfo: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  convertedCustomerId: string | null;
}

export async function getEnquiries(): Promise<{ rows: EnquiryRow[]; newCount: number }> {
  const sb = await createClient();
  const { data } = await sb.from("enquiries").select("*").order("created_at", { ascending: false }).limit(50);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: EnquiryRow[] = ((data ?? []) as any[]).map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone,
    email: e.email,
    vehicleInfo: e.vehicle_info,
    message: e.message,
    status: e.status,
    createdAt: e.created_at,
    convertedCustomerId: e.converted_customer_id,
  }));
  return { rows, newCount: rows.filter((r) => r.status === "new").length };
}
