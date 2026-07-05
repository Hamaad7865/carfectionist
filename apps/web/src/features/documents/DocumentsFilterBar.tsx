"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";

const TYPES = [
  { value: "", label: "All" },
  { value: "invoice", label: "Invoices" },
  { value: "quote", label: "Quotes" },
  { value: "credit_note", label: "Credit notes" },
];
const STATUSES = ["draft", "issued", "accepted", "partly_paid", "paid", "void"];

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

  const type = sp.get("type") ?? "";
  const status = sp.get("status") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* type tabs */}
      <div className="flex gap-1.5">
        {TYPES.map((t) => {
          const on = type === t.value;
          return (
            <button
              key={t.value}
              onClick={() => set("type", t.value)}
              className={`inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${
                on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body hover:border-faint"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-6 w-px bg-line-2" />

      {/* status chips */}
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => {
          const on = status === s;
          return (
            <button
              key={s}
              onClick={() => set("status", on ? "" : s)}
              className={`inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px] font-semibold capitalize ${
                on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-6 w-px bg-line-2" />

      <DateRangeFilter />

      <div className="flex-1" />

      <input
        type="search"
        placeholder="Customer…"
        aria-label="Customer"
        defaultValue={sp.get("customer") ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") set("customer", (e.target as HTMLInputElement).value);
        }}
        onBlur={(e) => set("customer", e.target.value)}
        className="h-9 w-44 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand"
      />
      {sp.toString() && (
        <button onClick={() => router.replace(pathname)} className="h-9 px-2 text-[13px] text-muted hover:text-body">
          Clear
        </button>
      )}
    </div>
  );
}
