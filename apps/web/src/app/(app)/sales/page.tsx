import { Suspense } from "react";
import Link from "next/link";
import { Plus, ChevronRight, Store } from "lucide-react";
import { listDocuments } from "@/lib/supabase/queries/documents";
import { DocumentsFilterBar } from "@/features/documents/DocumentsFilterBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";

const rs = (v: string) => formatMUR(Math.round(Number(v) * 100));
const COLS = "grid-cols-[120px_1fr_90px_90px_120px_130px_36px]";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const { rows, count, totalCents } = await listDocuments({
    type: pick("type"),
    status: pick("status"),
    from: pick("from"),
    to: pick("to"),
    customer: pick("customer"),
  });

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-[19px] font-extrabold text-ink-strong sm:text-[20px]">Quotes &amp; Invoices</h2>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/counter"
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] border border-line-2 bg-card px-4 text-[13.5px] font-bold text-body hover:border-brand sm:flex-none"
          >
            <Store size={16} strokeWidth={2.2} /> Counter sale
          </Link>
          <Link
            href="/sales/new?type=invoice"
            className="grad-brand shadow-brand flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] px-[18px] text-[13.5px] font-bold text-white sm:flex-none"
          >
            <Plus size={16} strokeWidth={2.4} /> New document
          </Link>
        </div>
      </div>

      <Suspense fallback={null}>
        <DocumentsFilterBar />
      </Suspense>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className={`hidden md:grid ${COLS} gap-3.5 border-b border-line bg-band px-5 py-3`}>
          {["Number", "Customer", "Date", "Method", "Status", "Total"].map((h, i) => (
            <span key={h} className={`text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint ${i === 5 ? "text-right" : ""}`}>
              {h}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No documents yet. Create your first quote or invoice.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/sales/${r.id}`} className="block border-b border-line hover:bg-sub">
              {/* Mobile card */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num text-[13px] font-bold" style={{ color: r.doc_type === "quote" ? "#6f5cd9" : "#1e6fe0" }}>{r.number ?? "Draft"}</span>
                    <StatusPill status={r.status} />
                    {r.hasDiscount && <span className="rounded-[5px] bg-[rgba(245,166,35,0.16)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-ink">Disc</span>}
                  </div>
                  <div className="mt-1 truncate text-[13px] font-semibold text-body">{r.customerName ?? "—"}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{r.issue_date ?? r.created_at.slice(0, 10)} · {r.methodLabel}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[14px] font-bold text-ink-strong">{rs(r.total_incl)}</div>
                </div>
              </div>
              {/* Desktop grid */}
              <div className={`hidden md:grid ${COLS} items-center gap-3.5 px-5 py-3`}>
                <span className="num text-[12.5px] font-bold" style={{ color: r.doc_type === "quote" ? "#6f5cd9" : "#1e6fe0" }}>{r.number ?? "Draft"}</span>
                <span className="truncate text-[13px] font-semibold text-body">{r.customerName ?? "—"}</span>
                <span className="num text-[12px] text-muted">{r.issue_date ?? r.created_at.slice(0, 10)}</span>
                <span className="text-[12px] text-muted">{r.methodLabel}</span>
                <span className="flex items-center gap-1.5"><StatusPill status={r.status} />{r.hasDiscount && <span className="rounded-[5px] bg-[rgba(245,166,35,0.16)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-ink">Disc</span>}</span>
                <span className="num text-right text-[13px] font-bold text-ink-strong">{rs(r.total_incl)}</span>
                <span className="flex justify-end text-faint"><ChevronRight size={16} /></span>
              </div>
            </Link>
          ))
        )}

        <div className="flex items-center justify-between gap-2 bg-band px-4 py-3 sm:px-5">
          <span className="text-[12px] font-semibold text-muted">
            {count} document{count === 1 ? "" : "s"}
            {rows.length < count ? ` (showing ${rows.length})` : ""}
          </span>
          <span className="text-[13px] font-bold text-body">
            Total <span className="num text-ink-strong">{formatMUR(totalCents)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
