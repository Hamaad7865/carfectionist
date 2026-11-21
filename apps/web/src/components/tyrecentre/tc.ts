/** Black pill primary action (spec §4) — pair with <ArrowKnob/>. Web 52px, tablet 64px. */
export function knobPill(height: 52 | 64 = 52): string {
  return `relative inline-flex w-full items-center justify-center gap-2 rounded-full bg-tc-primary font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-45 ${
    height === 64 ? "h-16 text-[17px]" : "h-[52px] text-[15px]"
  }`;
}

/** Round white icon button (refresh, scan, edit). */
export const TC_ROUND = "grid size-10 shrink-0 place-items-center rounded-full bg-white text-tc-body shadow-tc-card transition-colors hover:bg-tc-sub";

/** Mono breadcrumb / micro label (spec §3). */
export const TC_MICRO = "font-mono text-[10.5px] uppercase tracking-[0.08em] text-tc-faint";
