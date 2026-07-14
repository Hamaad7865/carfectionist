"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, X } from "lucide-react";
// Type-only (erased at build) — the VALUE import must come from the client-safe
// columns module, or the Supabase server client follows it into the browser bundle.
import type { JobListRow } from "@/lib/supabase/queries/jobs";
import { JOB_COLUMNS } from "./columns";
import { haystack, matches } from "./job-search";
import { formatMUR } from "@/lib/money";

const COLS = "grid-cols-[92px_1fr_150px_128px_150px_150px_36px]";

const STATUS = Object.fromEntries(JOB_COLUMNS.map((c) => [c.status, c])) as Record<string, { label: string; dot: string }>;

/** Job statuses are the board's four — StatusPill only knows document statuses. */
function JobStatus({ status }: { status: string }) {
  const known = STATUS[status];
  // The curated labels are already cased ("In progress") — Tailwind's `capitalize` would
  // repaint them "In Progress" and disagree with the very filter chip above. Only the
  // fallback, built from a raw enum value, needs re-casing.
  const s = known ?? { label: status.replace(/_/g, " "), dot: "#8c96a1" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold text-body ${known ? "" : "capitalize"}`}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

/** A quote or invoice as it appears on a job row: number, state, and what's still owed. */
function DocChip({ doc, kind }: { doc: JobListRow["quote"]; kind: "quote" | "invoice" }) {
  if (!doc) {
    return <span className="text-[12px] text-faint">{kind === "quote" ? "No quote" : "Not invoiced"}</span>;
  }
  const void_ = doc.status === "void";
  const owed = doc.outstandingCents > 0;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span
        className={`num truncate text-[12.5px] font-bold ${void_ ? "text-faint line-through" : kind === "quote" ? "text-[#6f5cd9]" : "text-link"}`}
      >
        {doc.number ?? "Draft"}
      </span>
      <span className="truncate text-[11px] capitalize text-muted">
        {owed ? (
          <span className="font-bold text-amber-ink">{formatMUR(doc.outstandingCents)} due</span>
        ) : (
          doc.status.replace(/_/g, " ")
        )}
      </span>
    </span>
  );
}

export function JobsList({ rows }: { rows: JobListRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  // The haystack is built once per row, not once per keystroke.
  const indexed = useMemo(
    () =>
      rows.map((r) => ({
        row: r,
        hay: haystack({
          ref: `JOB-${r.id.slice(0, 4).toUpperCase()}`,
          plate: r.plate,
          vehicle: r.vehicle,
          customer: r.customer,
          phone: r.phone,
          service: r.service,
          technician: r.technician,
          department: r.department,
          docNumbers: r.docNumbers,
        }),
      })),
    [rows],
  );

  const filtered = useMemo(
    () => indexed.filter((r) => (status ? r.row.status === status : true) && matches(r.hay, q)).map((r) => r.row),
    [indexed, q, status],
  );

  const owed = filtered.reduce((s, r) => s + r.outstandingCents, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* search + status filter */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[280px] flex-1 sm:max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search a car, customer, plate, quote or invoice…"
            aria-label="Search jobs"
            className="h-10 w-full rounded-[10px] border border-line-2 bg-card pl-9 pr-9 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-faint hover:text-body"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {JOB_COLUMNS.map((c) => {
            const on = status === c.status;
            return (
              <button
                key={c.status}
                onClick={() => setStatus(on ? "" : c.status)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold ${
                  on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"
                }`}
              >
                <span className="size-1.5 rounded-full" style={{ background: c.dot }} />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className={`hidden xl:grid ${COLS} gap-3.5 border-b border-line bg-band px-5 py-3`}>
          {["Job", "Vehicle", "Customer", "Status", "Quote", "Invoice"].map((h) => (
            <span key={h} className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-th">
              {h}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No jobs yet. Start one from an intake.</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">
            {q ? <>No job matches “{q}”.</> : <>No {STATUS[status]?.label.toLowerCase()} jobs.</>}
          </div>
        ) : (
          filtered.map((r) => (
            <Link key={r.id} href={`/jobs/${r.id}`} className="block border-b border-line last:border-b-0 hover:bg-sub">
              {/* Card — phones through to a narrow desktop window; carries everything the
                  wide grid does, so nothing is hidden by the size of the window. */}
              <div className="flex flex-col gap-1.5 px-4 py-3 xl:hidden">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[11px] font-bold text-link">JOB-{r.id.slice(0, 4).toUpperCase()}</span>
                  <JobStatus status={r.status} />
                </div>
                <div className="text-[14px] font-bold leading-tight text-ink-strong">{r.vehicle ?? "—"}</div>
                <div className="num text-[12px] text-muted">{r.plate ?? ""}</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[12.5px] text-body">{r.customer ?? "—"}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">{r.technician ?? "Unassigned"}</span>
                </div>
                <div className="mt-1 flex items-start gap-5 border-t border-line pt-2">
                  <DocChip doc={r.quote} kind="quote" />
                  <span className="flex min-w-0 flex-col">
                    <DocChip doc={r.invoice} kind="invoice" />
                    {r.invoiceCount > 1 && <span className="text-[10.5px] text-faint">+{r.invoiceCount - 1} more</span>}
                  </span>
                </div>
              </div>

              {/* Desktop grid */}
              <div className={`hidden xl:grid ${COLS} items-center gap-3.5 px-5 py-3`}>
                <span className="num text-[12px] font-bold text-link">JOB-{r.id.slice(0, 4).toUpperCase()}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-bold text-ink-strong">{r.vehicle ?? "—"}</span>
                  <span className="num truncate text-[11.5px] text-muted">{r.plate ?? ""}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-body">{r.customer ?? "—"}</span>
                  <span className="block truncate text-[11.5px] text-faint">{r.technician ?? "Unassigned"}</span>
                </span>
                <span className="min-w-0">
                  <JobStatus status={r.status} />
                </span>
                <span className="min-w-0">
                  <DocChip doc={r.quote} kind="quote" />
                </span>
                <span className="min-w-0">
                  <DocChip doc={r.invoice} kind="invoice" />
                  {r.invoiceCount > 1 && <span className="block text-[10.5px] text-faint">+{r.invoiceCount - 1} more</span>}
                </span>
                <span className="flex justify-end text-faint">
                  <ChevronRight size={16} />
                </span>
              </div>
            </Link>
          ))
        )}

        <div className="flex items-center justify-between gap-2 bg-band px-4 py-3 sm:px-5">
          <span className="text-[12px] font-semibold text-th">
            {filtered.length === rows.length
              ? `${rows.length} job${rows.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${rows.length} jobs`}
          </span>
          {owed > 0 && (
            <span className="text-[13px] font-bold text-body">
              Outstanding <span className="num text-amber-ink">{formatMUR(owed)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
