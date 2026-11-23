"use client";

import { useState } from "react";
import Link from "next/link";
import { JOB_COLUMNS } from "./columns";
import type { JobCardSummary } from "@/lib/supabase/queries/jobs";

type Status = (typeof JOB_COLUMNS)[number]["status"];

/** The board's opening column on a phone: where the work is right now. */
function firstBusy(board: Record<string, JobCardSummary[]>): Status {
  const order: Status[] = ["in_progress", "ready", "scheduled", "delivered"];
  return order.find((s) => (board[s] ?? []).length > 0) ?? "in_progress";
}

/** The jobs board. md and up: the four columns side by side. A phone shows one
 *  column at a time behind a row of status tabs, so a busy day is not one
 *  endless scroll through every stage. */
export function JobsBoard({ board }: { board: Record<string, JobCardSummary[]> }) {
  const [picked, setPicked] = useState<Status>(() => firstBusy(board));

  return (
    <>
      <div role="tablist" aria-label="Job stage" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:hidden">
        {JOB_COLUMNS.map((col) => {
          const on = picked === col.status;
          const n = (board[col.status] ?? []).length;
          return (
            <button
              key={col.status}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPicked(col.status)}
              className={`flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-bold ${
                on ? "border-transparent bg-ink text-card" : "border-line-2 bg-card text-body"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: col.dot }} />
              {col.label}
              <span className={`num text-[12px] ${on ? "opacity-70" : "text-faint"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        {JOB_COLUMNS.map((col) => {
          const jobs = board[col.status] ?? [];
          return (
            <div
              key={col.status}
              className={`rounded-[16px] border border-line bg-sub p-3 ${picked === col.status ? "" : "hidden md:block"}`}
            >
              <div className="hidden items-center gap-2 px-1.5 pb-3 pt-1 md:flex">
                <span className="size-2.5 rounded-full" style={{ background: col.dot }} />
                <span className="text-[13px] font-bold text-ink">{col.label}</span>
                <span className="num ml-auto text-[12px] text-faint">{jobs.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {jobs.length === 0 && (
                  <div className="rounded-[12px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">
                    <span className="md:hidden">No cars {col.label.toLowerCase()}</span>
                    <span className="hidden md:inline">—</span>
                  </div>
                )}
                {jobs.map((j) => (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-[13px] border border-line bg-card p-3.5 hover:border-brand active:border-brand">
                    <div className="flex items-center justify-between">
                      <span className="num text-[11px] font-bold text-link">JOB-{j.id.slice(0, 4).toUpperCase()}</span>
                      {j.running && <span className="flex items-center gap-1.5 text-[11px] font-bold text-mint"><span className="size-1.5 rounded-full bg-mint" />running</span>}
                      {j.paused && <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-ink"><span className="size-1.5 rounded-full bg-[#ff9f1a]" />paused</span>}
                    </div>
                    <div className="mt-2 text-[14px] font-bold leading-tight text-ink-strong">{j.vehicle ?? "—"}</div>
                    <div className="num text-[12px] text-muted">{j.plate ?? ""}</div>
                    {j.department && <span className="mt-2 inline-block rounded-[6px] bg-[rgba(43,140,255,0.1)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-link">{j.department}</span>}
                    {j.service && <div className="mt-2 text-[12.5px] text-body">{j.service}</div>}
                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
                      <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-band font-display text-[10px] font-extrabold text-th">{j.technicianInitials ?? "–"}</span>
                      <span className="min-w-0 truncate text-[12px] text-muted">{j.technician ?? "Unassigned"}</span>
                      <span className="ml-auto min-w-0 truncate text-[12px] text-faint">{j.customer ?? ""}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
