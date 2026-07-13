import Link from "next/link";
import { Check, X } from "lucide-react";
import type { FlowStep } from "@/lib/supabase/queries/flow";

// The car's journey, at a glance: Intake → Quote → Client signs → Job →
// Invoice. Server-rendered, pure props — mounted on the quote/invoice pages
// and above the job card so the owner sees the same five steps everywhere.
//
// The connector rail lives in its own overlay layer (below), painted ABOVE the
// per-step hover cards, so hovering a step never hides the lines running into
// or out of it.

function Node({ s }: { s: FlowStep }) {
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

  // min-w-0 keeps every column an equal flex-1 width (the nowrap detail line
  // would otherwise inflate its column and skew the rail). The hover card fills
  // its column and fades in; the rail (z-10, below) paints over it, so hovering
  // never hides the lines.
  return (
    <div className="min-w-0 flex-1 sm:text-center">
      {s.href ? (
        <Link
          href={s.href}
          className="block rounded-[11px] px-2 py-2 transition-colors duration-150 ease-out hover:bg-sub"
        >
          {body}
        </Link>
      ) : (
        <div className="px-2 py-2">{body}</div>
      )}
    </div>
  );
}

export function FlowStepper({ steps }: { steps: FlowStep[] }) {
  const n = steps.length;
  return (
    <div className="rounded-[15px] border border-line bg-card px-4 py-3.5">
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
        {/* connector rail — one segment per gap, painted above the hover cards
            (z-10) so a hovered step can't cover the lines. Pointer-events off so
            it never eats a click. Columns are equal (flex-1), so segment i runs
            from column i's centre +18px to column i+1's centre −18px. */}
        <div className="pointer-events-none absolute inset-0 z-10 hidden sm:block" aria-hidden>
          {steps.slice(0, -1).map((s, i) => (
            <span
              key={s.key}
              className={`absolute top-[21px] h-[2px] rounded ${s.state === "done" ? "bg-brand" : "bg-line-2"}`}
              style={{ left: `calc(${((i + 0.5) / n) * 100}% + 18px)`, width: `calc(${100 / n}% - 36px)` }}
            />
          ))}
        </div>
        {steps.map((s) => (
          <Node key={s.key} s={s} />
        ))}
      </div>
    </div>
  );
}
