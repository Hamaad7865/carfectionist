"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { chipRail } from "@/components/ui/rail";

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

  // Phones: the type and status chips each scroll sideways on one line, and the
  // period and customer search share the last row. md and up: one wrapping bar.
  const rail = chipRail;
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
      {/* type tabs */}
      <div className={rail}>
        {TYPES.map((t) => {
          const on = type === t.value;
          return (
            <button
              key={t.value}
              onClick={() => set("type", t.value)}
              className={`inline-flex h-[38px] shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-4 text-[13px] font-bold ${
                on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body hover:border-faint"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mx-1 hidden h-6 w-px bg-line-2 md:block" />

      {/* status chips */}
      <div className={rail}>
        {STATUSES.map((s) => {
          const on = status === s;
          return (
            <button
              key={s}
              onClick={() => set("status", on ? "" : s)}
              className={`inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[12px] font-semibold capitalize md:h-8 ${
                on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>

      <div className="mx-1 hidden h-6 w-px bg-line-2 md:block" />

      <div className="flex flex-wrap items-center gap-2 md:contents">
        <DateRangeFilter />

        <div className="hidden flex-1 md:block" />

        <input
          type="search"
          placeholder="Customer…"
          aria-label="Customer"
          defaultValue={sp.get("customer") ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") set("customer", (e.target as HTMLInputElement).value);
          }}
          onBlur={(e) => set("customer", e.target.value)}
          enterKeyHint="search"
          className="h-10 min-w-[150px] flex-1 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-brand md:h-9 md:w-44 md:flex-none"
        />
        {sp.toString() && (
          <button onClick={() => router.replace(pathname)} className="h-10 px-2 text-[13px] text-muted hover:text-body md:h-9">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
