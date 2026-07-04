"use client";

import { usePathname } from "next/navigation";
import { titleForPath } from "@/lib/auth/roles";

export function Topbar({ tradingName }: { tradingName: string }) {
  const pathname = usePathname();
  const title = titleForPath(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-graphite-700 bg-graphite-950/80 px-6 backdrop-blur">
      <h1 className="font-display text-[15px] font-semibold tracking-wide text-graphite-100">
        {title}
      </h1>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-graphite-700 bg-graphite-900 px-2.5 py-1 text-[11px] text-graphite-400">
        <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px] shadow-success/70" />
        {tradingName} · MUR
      </span>
    </header>
  );
}
