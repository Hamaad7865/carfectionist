"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Single reference-date picker wired to the URL (?ref=) — drives the Cash Flow
 *  History section. Preserves every other param (tab, from/to). */
export function RefDatePicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setRef(next: string) {
    const p = new URLSearchParams(sp.toString());
    if (next) p.set("ref", next);
    else p.delete("ref");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Reference date</span>
      <input
        type="date"
        aria-label="Reference date"
        value={value}
        onChange={(e) => setRef(e.target.value)}
        className="h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand [color-scheme:light]"
      />
    </label>
  );
}
