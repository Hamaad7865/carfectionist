"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { chipRail } from "./rail";

/** A sideways-scrolling row of tabs or chips (phones) that opens with the current
 *  one — the child marked aria-current="page" — scrolled into view, so a tab at
 *  the far end never loads off-screen. From md up it wraps like a normal row,
 *  unless `className` overrides the layout. */
export function ChipRail({ children, className = chipRail }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current || el.scrollWidth <= el.clientWidth) return;
    const left = current.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    el.scrollLeft = Math.max(0, left - (el.clientWidth - current.offsetWidth) / 2);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
