"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORE_KEY = "reports-rail-open";

/**
 * Collapsible report rail + growing main column.
 *
 * The rail owns its width (236px open / 52px shut) and animates it with a
 * springy cubic-bezier, so the flex-1 main column stretches — with a little
 * overshoot bounce — into whatever space the rail gives up. State persists
 * in localStorage so the choice survives navigation.
 */
export function ReportsShell({
  rail,
  children,
}: {
  /** Links + explainer card — the shell provides the frame + toggle. */
  rail: React.ReactNode;
  /** Date bar + report body — rendered in the flex-1 column that grows. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return typeof localStorage === "undefined"
        ? true
        : localStorage.getItem(STORE_KEY) !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  return (
    <div className="flex h-full min-h-0">
      {open ? (
        <aside
          className="rail-spring flex min-h-0 w-[236px] shrink-0 flex-col border-r border-line bg-sub"
          aria-label="Report list"
        >
          <div className="flex items-center justify-between py-1 pl-5 pr-3 pt-2">
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-faint">
              Reports
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Collapse report list"
              aria-label="Collapse report list"
              aria-expanded={open}
              className="grid size-8 place-items-center rounded-[9px] text-faint transition-transform duration-300 hover:scale-110 hover:bg-[rgba(15,23,32,0.05)] hover:text-body active:scale-90"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{rail}</div>
        </aside>
      ) : (
        <aside
          className="rail-spring flex min-h-0 w-[52px] shrink-0 flex-col items-center gap-2 border-r border-line bg-sub py-3"
          aria-label="Report list (collapsed)"
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="Show report list"
            aria-label="Show report list"
            aria-expanded={open}
            className="rail-pop grid size-9 place-items-center rounded-[9px] text-faint transition-transform duration-300 hover:scale-110 hover:bg-[rgba(43,140,255,0.10)] hover:text-link active:scale-90"
          >
            <PanelLeftOpen size={16} />
          </button>
          <span
            aria-hidden
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-faint [writing-mode:vertical-rl]"
          >
            Reports
          </span>
        </aside>
      )}

      {/* main — flex-1 so it grows into whatever the rail gives up */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
