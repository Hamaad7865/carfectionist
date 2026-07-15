import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Global search: the browser calls GET /api/search?q=… as you type, and this
// looks across invoices/quotes, customers and vehicles. It runs the query as the
// logged-in user, so row-level security limits results to their own tenant — we
// never have to filter by tenant ourselves.
export const dynamic = "force-dynamic";

export interface SearchHit {
  type: "invoice" | "customer" | "vehicle";
  id: string;
  label: string;
  sub: string;
  href: string;
}

export async function GET(req: Request) {
  // 1. Must be signed in.
  const session = await getSessionContext();
  if (!session) return new Response("unauthorized", { status: 401 });

  // 2. Read the query. Strip characters that would break PostgREST's .or()
  //    filter syntax (commas, parens, wildcards) — this both prevents the query
  //    from breaking AND stops filter injection.
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const q = raw.replace(/[,()%*\\]/g, " ").trim();
  if (q.length < 2) return Response.json({ hits: [] }); // one letter matches everything — not useful

  const like = `%${q}%`;
  const plate = q.toUpperCase().replace(/[^A-Z0-9]/g, ""); // matches plate_normalized
  const sb = await createClient();

  // 3. Three lookups at once (Promise.all = run in parallel, not one-after-another).
  const [docs, customers, vehicles] = await Promise.all([
    sb
      .from("documents")
      .select("id, number, doc_type, status, customers(name)")
      .not("number", "is", null)
      .ilike("number", like)
      .order("created_at", { ascending: false })
      .limit(6),
    sb
      .from("customers")
      .select("id, name, phone, email, is_company")
      .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .limit(6),
    plate.length >= 2
      ? sb
          .from("vehicles")
          .select("id, plate, make, model, customer_id")
          .ilike("plate_normalized", `%${plate}%`)
          .limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  // 4. Fold the three shapes into one common result shape the UI can render.
  const hits: SearchHit[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (docs.data ?? []) as any[]) {
    hits.push({
      type: "invoice",
      id: d.id,
      label: d.number,
      sub: `${d.doc_type === "quote" ? "Quote" : d.doc_type === "credit_note" ? "Credit note" : "Invoice"} · ${d.customers?.name ?? "—"}`,
      href: `/sales/${d.id}`,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (customers.data ?? []) as any[]) {
    hits.push({
      type: "customer",
      id: c.id,
      label: c.name,
      sub: [c.is_company ? "Company" : "Customer", c.phone, c.email].filter(Boolean).join(" · "),
      href: `/contacts?c=${c.id}`,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (vehicles.data ?? []) as any[]) {
    hits.push({
      type: "vehicle",
      id: v.id,
      label: v.plate,
      sub: [v.make, v.model].filter(Boolean).join(" ") || "Vehicle",
      href: `/contacts?c=${v.customer_id}`,
    });
  }

  return Response.json({ hits });
}
