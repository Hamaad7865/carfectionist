"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Filter the activity feed by actor. Preserves every other search param. */
export function PersonFilter({ actors, current }: { actors: { id: string; name: string }[]; current?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(v: string) {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set("actor", v);
    else p.delete("actor");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <select
      value={current ?? ""}
      onChange={(e) => set(e.target.value)}
      aria-label="Filter by person"
      className="h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand"
    >
      <option value="">Everyone</option>
      {actors.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}
