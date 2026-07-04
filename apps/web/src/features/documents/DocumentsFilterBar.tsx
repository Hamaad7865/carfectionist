"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const STATUSES = ["draft", "issued", "accepted", "declined", "expired", "partly_paid", "paid", "void"];

const selectCls =
  "h-9 rounded-md border border-graphite-700 bg-graphite-850 px-2.5 text-[13px] text-graphite-100 outline-none focus:border-teal";

export function DocumentsFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(key: string, value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`);
  }

  const has = sp.toString().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={selectCls} value={sp.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">All types</option>
        <option value="quote">Quotes</option>
        <option value="invoice">Invoices</option>
        <option value="credit_note">Credit notes</option>
      </select>

      <select className={selectCls} value={sp.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <input
        type="date"
        aria-label="From date"
        className={selectCls}
        value={sp.get("from") ?? ""}
        onChange={(e) => set("from", e.target.value)}
      />
      <input
        type="date"
        aria-label="To date"
        className={selectCls}
        value={sp.get("to") ?? ""}
        onChange={(e) => set("to", e.target.value)}
      />

      <input
        type="search"
        placeholder="Customer…"
        aria-label="Customer"
        defaultValue={sp.get("customer") ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") set("customer", (e.target as HTMLInputElement).value);
        }}
        onBlur={(e) => set("customer", e.target.value)}
        className={`${selectCls} w-40`}
      />

      {has && (
        <button
          onClick={() => router.replace(pathname)}
          className="h-9 rounded-md px-3 text-[13px] text-graphite-400 hover:text-graphite-100"
        >
          Clear
        </button>
      )}
    </div>
  );
}
