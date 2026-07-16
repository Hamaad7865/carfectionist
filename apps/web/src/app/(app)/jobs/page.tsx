import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { getJobsBoard, getIntakeRef, listJobs } from "@/lib/supabase/queries/jobs";
import { JOB_COLUMNS } from "@/features/jobs/columns";
import { NewJobForm } from "@/features/jobs/NewJobForm";
import { JobsList } from "@/features/jobs/JobsList";
import { btn } from "@/components/ui/button";

const tabCls = (on: boolean) =>
  `h-8 rounded-[8px] px-3 text-[12px] font-bold leading-8 ${on ? "bg-card text-ink shadow-sm" : "text-muted"}`;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const sp = await searchParams;
  // A repeated ?tab=a&tab=b arrives as an array — anything that isn't exactly
  // "list" falls back to the board rather than throwing.
  const tab = sp.tab === "list" ? "list" : "board";

  const [board, intake, rows] = await Promise.all([
    tab === "board" ? getJobsBoard() : Promise.resolve({} as Record<string, never[]>),
    getIntakeRef(),
    tab === "list" ? listJobs() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Jobs</h2>
          <div className="flex rounded-[10px] border border-line-2 bg-sub p-0.5">
            <Link href="/jobs" className={tabCls(tab === "board")}>
              Board
            </Link>
            <Link href="/jobs?tab=list" className={tabCls(tab === "list")}>
              All jobs
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/jobs/intake"
            className={btn("ghost", "lg", "gap-2")}
          >
            <ClipboardCheck size={16} strokeWidth={2.2} /> New intake
          </Link>
          <NewJobForm intake={intake} />
        </div>
      </div>

      {tab === "list" ? (
        <JobsList rows={rows} />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {JOB_COLUMNS.map((col) => {
            const jobs = board[col.status] ?? [];
            return (
              <div key={col.status} className="rounded-[16px] border border-line bg-sub p-3">
                <div className="flex items-center gap-2 px-1.5 pb-3 pt-1">
                  <span className="size-2.5 rounded-full" style={{ background: col.dot }} />
                  <span className="text-[13px] font-bold text-ink">{col.label}</span>
                  <span className="num ml-auto text-[12px] text-faint">{jobs.length}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {jobs.length === 0 && <div className="rounded-[12px] border border-dashed border-line-2 p-4 text-center text-[12px] text-faint">—</div>}
                  {jobs.map((j) => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-[13px] border border-line bg-card p-3.5 hover:border-brand">
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
                        <span className="grid size-6 place-items-center rounded-[7px] bg-band font-display text-[10px] font-extrabold text-[#3f5065]">{j.technicianInitials ?? "–"}</span>
                        <span className="text-[12px] text-muted">{j.technician ?? "Unassigned"}</span>
                        <span className="ml-auto text-[12px] text-faint">{j.customer ?? ""}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
