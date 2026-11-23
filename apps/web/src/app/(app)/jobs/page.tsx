import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { getJobsBoard, getIntakeRef, listJobs } from "@/lib/supabase/queries/jobs";
import { NewJobForm } from "@/features/jobs/NewJobForm";
import { JobsList } from "@/features/jobs/JobsList";
import { JobsBoard } from "@/features/jobs/JobsBoard";
import { btn } from "@/components/ui/button";

const tabCls = (on: boolean) =>
  `h-8 rounded-[8px] px-3 text-[12px] font-bold leading-8 ${on ? "bg-card text-ink shadow-sm" : "text-muted"}`;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const sp = await searchParams;
  // A repeated ?tab=a&tab=b arrives as an array — anything that isn't exactly
  // "list" falls back to the board rather than throwing.
  const tab = sp.tab === "list" ? "list" : sp.tab === "cancelled" ? "cancelled" : "board";
  const isList = tab === "list" || tab === "cancelled";

  const [board, intake, rows] = await Promise.all([
    tab === "board" ? getJobsBoard() : Promise.resolve({} as Record<string, never[]>),
    getIntakeRef(),
    isList ? listJobs({ onlyCancelled: tab === "cancelled" }) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="hidden font-display text-[20px] font-extrabold text-ink-strong sm:block">Jobs</h2>
          <div className="flex flex-1 rounded-[10px] border border-line-2 bg-sub p-0.5 sm:flex-none [&>a]:flex-1 [&>a]:text-center sm:[&>a]:flex-none">
            <Link href="/jobs" className={tabCls(tab === "board")}>
              Board
            </Link>
            <Link href="/jobs?tab=list" className={tabCls(tab === "list")}>
              All jobs
            </Link>
            {/* Cancelled cars are finished business — kept out of the working
                list, one tap away when someone needs to look one up. */}
            <Link href="/jobs?tab=cancelled" className={tabCls(tab === "cancelled")}>
              Cancelled
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          <Link
            href="/jobs/intake"
            className={btn("ghost", "lg", "gap-2")}
          >
            <ClipboardCheck size={16} strokeWidth={2.2} /> New intake
          </Link>
          <NewJobForm intake={intake} />
        </div>
      </div>

      {isList ? (
        <JobsList rows={rows} />
      ) : (
        <JobsBoard board={board} />
      )}
    </div>
  );
}
