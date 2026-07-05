import { getReportsData } from "@/lib/supabase/queries/reports";
import { getSessionContext } from "@/lib/auth/session";

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const session = await getSessionContext();
  if (!session || !["owner", "manager", "accountant"].includes(session.role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const data = await getReportsData(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);

  const rows: (string | number)[][] = [
    ["Date", "Document", "Customer", "Method", "Amount (Rs)"],
    ...data.payments.map((p) => [p.date, p.number ?? "", p.customer ?? "", p.method, (p.amountCents / 100).toFixed(2)]),
  ];
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="payments.csv"',
    },
  });
}
