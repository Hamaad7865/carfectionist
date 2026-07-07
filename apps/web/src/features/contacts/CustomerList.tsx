"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatMUR } from "@/lib/money";
import type { CustomerSummary } from "@/lib/supabase/queries/contacts";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

/** Client-side searchable customer list — filters in memory (instant, no round-trip)
 *  so the owner can jump to a contact instead of scrolling. */
export function CustomerList({ customers, selectedId }: { customers: CustomerSummary[]; selectedId?: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.phone ?? "").toLowerCase().includes(s) ||
        (c.email ?? "").toLowerCase().includes(s),
    );
  }, [q, customers]);

  return (
    <div className="rounded-[14px] border border-line bg-card p-2">
      <div className="relative px-1 pb-1.5 pt-1">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${customers.length} customers…`}
          className="h-10 w-full rounded-[10px] border border-line-2 bg-sub pl-9 pr-3 text-[13px] text-ink outline-none focus:border-brand"
        />
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {customers.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-faint">No customers.</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-faint">No match for “{q}”.</div>
        ) : (
          filtered.map((c) => {
            const on = selectedId === c.id;
            return (
              <Link
                key={c.id}
                href={`/contacts?c=${c.id}`}
                className={`mb-1 flex w-full items-center gap-3 rounded-[11px] border px-3 py-2.5 ${on ? "border-link bg-[rgba(43,140,255,0.08)]" : "border-transparent hover:bg-sub"}`}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] font-display text-[12px] font-extrabold text-[#3f5065]"
                  style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}
                >
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-ink">{c.name}</div>
                  <div className="text-[11.5px] text-muted">
                    {c.vehicleCount} vehicle{c.vehicleCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className={`num text-[11px] font-semibold ${c.outstandingCents > 0 ? "text-amber-ink" : "text-faint"}`}>
                  {c.outstandingCents > 0 ? formatMUR(c.outstandingCents) : "—"}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
