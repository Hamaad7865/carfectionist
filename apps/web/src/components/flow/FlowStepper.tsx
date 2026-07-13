import Link from "next/link";
import { Check, X } from "lucide-react";
import type { FlowStep } from "@/lib/supabase/queries/flow";

// The car's journey, at a glance: Intake → Quote → Client signs → Job →
// Invoice. Server-rendered, pure props — mounted on the quote/invoice pages
// and above the job card so the owner sees the same five steps everywhere.

function Node({ s, last }: { s: FlowStep; last: boolean }) {
  const done = s.state === "done";
  const current = s.state === "current";
  const declined = s.state === "declined";

  const circle = (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-white ${
        declined
          ? "border-rose bg-rose"
          : done
            ? "border-brand bg-brand"
            : current
              ? "border-brand bg-card"
              : "border-line-2 bg-card"
      }`}
    >
      {declined ? <X size={13} strokeWidth={3} /> : done ? <Check size={13} strokeWidth={3} /> : (
        <span className={`size-2 rounded-full ${current ? "bg-brand" : "bg-line-2"}`} />
      )}
    </span>
  );

  const body = (
    <div className="flex min-w-0 items-start gap-2.5 sm:block sm:text-center">
      <div className="flex items-center gap-2.5 sm:flex-col sm:gap-1.5">{circle}</div>
      <div className="min-w-0 sm:mt-1.5">
        <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${declined ? "text-rose" : done || current ? "text-ink" : "text-faint"}`}>
          {s.label}
        </div>
        {(s.at || s.detail) && (
          <div className="mt-0.5 text-[10.5px] leading-tight text-muted">
            {s.detail && <div className="truncate">{s.detail}</div>}
            {s.at && <div className="text-faint">{s.at}</div>}
          </div>
        )}
        {current && !s.at && !s.detail && <div className="mt-0.5 text-[10.5px] text-link">Next step</div>}
      </div>
    </div>
  );

  return (
    <div className={`relative flex-1 ${last ? "" : ""}`}>
      {/* connector to the next node (desktop) */}
      {!last && (
        <span
          className={`absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[13px] hidden h-[2px] rounded sm:block ${
            done ? "bg-brand" : "bg-line-2"
          }`}
        />
      )}
      {s.href ? (
        <Link href={s.href} className="block rounded-[10px] px-1 py-1 hover:bg-sub">
          {body}
        </Link>
      ) : (
        <div className="px-1 py-1">{body}</div>
      )}
    </div>
  );
}

export function FlowStepper({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="rounded-[15px] border border-line bg-card px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
        {steps.map((s, i) => (
          <Node key={s.key} s={s} last={i === steps.length - 1} />
        ))}
      </div>
    </div>
  );
}
