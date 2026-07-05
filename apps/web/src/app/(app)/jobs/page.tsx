import Link from "next/link";
import { getJobsBoard, getIntakeRef, JOB_COLUMNS } from "@/lib/supabase/queries/jobs";
import { NewJobForm } from "@/features/jobs/NewJobForm";

export default async function JobsPage() {
  const [board, intake] = await Promise.all([getJobsBoard(), getIntakeRef()]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Jobs board</h2>
        <NewJobForm intake={intake} />
      </div>

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
                    </div>
                    <div className="mt-2 text-[14px] font-bold leading-tight text-ink-strong">{j.vehicle ?? "—"}</div>
                    <div className="num text-[12px] text-muted">{j.plate ?? ""}</div>
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
    </div>
  );
}
