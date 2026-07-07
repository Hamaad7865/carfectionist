import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { toCsv, type CsvColumn } from "@/lib/csv";

const COLS: CsvColumn[] = [
  { key: "name", header: "name" },
  { key: "is_company", header: "is_company" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "address", header: "address" },
  { key: "brn", header: "brn" },
  { key: "vat_number", header: "vat_number" },
  { key: "country", header: "country" },
  { key: "notes", header: "notes" },
];

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const sb = await createClient();
  const data = await fetchAllRows(
    () => sb.from("customers").select("name, is_company, email, phone, address, brn, vat_number, notes, country").order("name"),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data as any[]).map((c) => ({
    name: c.name ?? "",
    is_company: c.is_company ? "yes" : "no",
    email: c.email ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    brn: c.brn ?? "",
    vat_number: c.vat_number ?? "",
    country: c.country ?? "MU",
    notes: c.notes ?? "",
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, COLS), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${stamp}.csv"`,
    },
  });
}
