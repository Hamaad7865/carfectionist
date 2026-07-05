import { getReportsData, getExtraReports } from "@/lib/supabase/queries/reports";
import { getCashSessions } from "@/lib/supabase/queries/cash";
import { getSessionContext } from "@/lib/auth/session";

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
const rs = (cents: number) => (cents / 100).toFixed(2);

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSessionContext();
  if (!session || !["owner", "manager", "accountant"].includes(session.role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const m = url.searchParams.get("m") ?? undefined;

  let rows: (string | number)[][];
  let name = slug;

  switch (slug) {
    case "collected": {
      const d = await getReportsData(from, to, m);
      rows = [["Date", "Document", "Customer", "Method", "Amount (Rs)"], ...d.payments.map((p) => [p.date, p.number ?? "", p.customer ?? "", p.method, rs(p.amountCents)])];
      name = "payments";
      break;
    }
    case "vat": {
      const d = await getReportsData(from, to);
      rows = [["Metric", "Amount (Rs)"], ["Output VAT", rs(d.vat.outputCents)], ["Input VAT", rs(d.vat.inputCents)], ["Net VAT payable", rs(d.vat.netCents)]];
      break;
    }
    case "receivables": {
      const d = await getReportsData(from, to);
      rows = [["Age bucket", "Amount (Rs)"], ...d.aged.map((b) => [b.label, rs(b.cents)]), ["Total outstanding", rs(d.outstandingCents)]];
      break;
    }
    case "cash": {
      const d = await getCashSessions();
      rows = [["Opened", "Device", "Opening float (Rs)", "Expected (Rs)", "Counted (Rs)", "Variance (Rs)"]];
      if (d.open) rows.push([d.open.openedAt.slice(0, 10), d.open.deviceId, rs(d.open.openingFloatCents), rs(d.open.expectedCents), "OPEN", ""]);
      for (const s of d.recent) rows.push([s.openedAt.slice(0, 10), s.deviceId, rs(s.openingFloatCents), rs(s.expectedCents), rs(s.countedCents), rs(s.varianceCents)]);
      name = "cash-up";
      break;
    }
    case "pnl": {
      const d = await getExtraReports(from, to);
      rows = [
        ["Line", "Amount (Rs)"],
        ["Revenue invoiced", rs(d.pnl.revenueCents)],
        ["Cost of goods sold", rs(-d.pnl.cogsCents)],
        ["Gross profit", rs(d.pnl.grossCents)],
        ["Operating expenses", rs(-d.pnl.expensesCents)],
        ["Net profit", rs(d.pnl.netCents)],
      ];
      break;
    }
    case "bestsellers": {
      const d = await getExtraReports(from, to);
      rows = [["Item", "Qty", "Revenue (Rs)"], ...d.bestSellers.map((b) => [b.name, b.qty, rs(b.revenueCents)])];
      name = "best-sellers";
      break;
    }
    case "technician": {
      const d = await getExtraReports(from, to);
      rows = [["Technician", "Jobs", "Revenue (Rs)"], ...d.byTechnician.map((t) => [t.name, t.jobs, rs(t.revenueCents)])];
      name = "revenue-by-technician";
      break;
    }
    default:
      return new Response("Unknown report", { status: 404 });
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
    },
  });
}
