"use client";

import { useRouter } from "next/navigation";

export function StatementPicker({
  customers,
  current,
  from,
  to,
}: {
  customers: { id: string; name: string }[];
  current?: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={current ?? ""}
      onChange={(e) => {
        const p = new URLSearchParams();
        p.set("r", "statement");
        if (e.target.value) p.set("c", e.target.value);
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        router.push(`/reports?${p.toString()}`);
      }}
      className="h-10 min-w-0 flex-1 rounded-[10px] border border-line-2 bg-card px-2.5 text-[14px] sm:h-9 sm:min-w-[220px] sm:flex-none font-semibold text-body outline-none focus:border-brand"
    >
      <option value="">Select a customer…</option>
      {customers.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
