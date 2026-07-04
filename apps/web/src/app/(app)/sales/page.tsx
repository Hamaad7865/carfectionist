import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listDocuments } from "@/lib/supabase/queries/documents";
import { DocumentsFilterBar } from "@/features/documents/DocumentsFilterBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";

const rs = (v: string) => formatMUR(Math.round(Number(v) * 100));

function docTypeLabel(t: string) {
  return t === "quote" ? "Quote" : t === "credit_note" ? "Credit note" : "Invoice";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const rows = await listDocuments({
    type: pick("type"),
    status: pick("status"),
    from: pick("from"),
    to: pick("to"),
    customer: pick("customer"),
  });

  return (
    <div className="p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.15em] text-graphite-500">Sales</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-graphite-100">Quotes &amp; Invoices</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sales/new?type=quote"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal px-3 text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright"
            >
              <Plus size={15} /> New quote
            </Link>
            <Link
              href="/sales/new?type=invoice"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-850 px-3 text-[13px] font-medium text-graphite-100 hover:border-graphite-600"
            >
              <Plus size={15} /> New invoice
            </Link>
          </div>
        </div>

        <div className="mt-6">
          <Suspense fallback={null}>
            <DocumentsFilterBar />
          </Suspense>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-graphite-700">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-graphite-850 text-left text-[11px] uppercase tracking-wider text-graphite-500">
                <th className="px-4 py-2.5 font-medium">Number</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-graphite-500">
                    No documents yet. Create your first quote or invoice.
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id} className="border-t border-graphite-700 hover:bg-graphite-900">
                    <td className="px-4 py-2.5">
                      <Link href={`/sales/${d.id}`} className="num text-graphite-100 hover:text-teal">
                        {d.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-graphite-300">{docTypeLabel(d.doc_type)}</td>
                    <td className="px-4 py-2.5 text-graphite-300">{d.customerName ?? "—"}</td>
                    <td className="px-4 py-2.5 num text-graphite-400">
                      {d.issue_date ?? d.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={d.status} />
                    </td>
                    <td className="px-4 py-2.5 num text-right text-graphite-100">{rs(d.total_incl)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
