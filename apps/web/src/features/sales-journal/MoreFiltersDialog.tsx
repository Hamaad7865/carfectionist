"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { btn } from "@/components/ui/button";
import { labelCls } from "@/components/ui/form";
import type { JournalFacets } from "@/lib/supabase/queries/sales-journal";

/**
 * Cashmag's "More filters" modal. Its five dropdowns collapse to three here:
 *   • Point of sale — the shop. Carfectionist is single-shop, so it would only
 *     ever offer one choice; dropped rather than shipped as decoration.
 *   • Sale method — the journal reports ONE sale method (the shop), so filtering
 *     by it would be a no-op. What is actually worth narrowing to is the
 *     terminal, which is this Device dropdown: each till by name, plus
 *     "Back office" for anything invoiced at the desk off a job or a quote.
 * The time window and the remaining dropdowns map straight across.
 *
 * Unlike the period controls this does apply on Validate: several fields change
 * together, and navigating on every keystroke of a time field would thrash.
 */
export interface JournalFilterState {
  device: string;
  service: string;
  user: string;
  timeFrom: string;
  timeTo: string;
}

const BLANK: JournalFilterState = { device: "", service: "", user: "", timeFrom: "", timeTo: "" };
const FULL_DAY = { timeFrom: "00:00", timeTo: "23:59" };

/** How many filters are actually narrowing the period — drives the button badge. */
export function activeCount(f: JournalFilterState): number {
  let n = 0;
  if (f.device) n++;
  if (f.service) n++;
  if (f.user) n++;
  if ((f.timeFrom && f.timeFrom !== FULL_DAY.timeFrom) || (f.timeTo && f.timeTo !== FULL_DAY.timeTo)) n++;
  return n;
}

const selectCls =
  "h-9 w-full rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand";
const timeCls =
  "h-9 rounded-[10px] border border-line-2 bg-card px-2.5 text-[12.5px] text-ink outline-none focus:border-brand [color-scheme:light]";

/** Hoisted, not defined inside the dialog: a component created during render is a
 *  new type every keystroke, so React would remount the select and drop focus. */
function Picker({ label, value, options, allLabel, onChange }: {
  label: string; value: string; options: string[]; allLabel: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export function MoreFiltersDialog({ facets, current }: { facets: JournalFacets; current: JournalFilterState }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JournalFilterState>(current);

  const n = activeCount(current);

  function show() {
    setDraft(current); // always open on what is actually applied
    setOpen(true);
  }

  function apply(next: JournalFilterState) {
    const p = new URLSearchParams(sp.toString());
    const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
    set("dev", next.device);
    set("svc", next.service);
    set("usr", next.user);
    // A full day is the default, so it never needs to sit in the URL.
    set("t0", next.timeFrom === FULL_DAY.timeFrom ? "" : next.timeFrom);
    set("t1", next.timeTo === FULL_DAY.timeTo ? "" : next.timeTo);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
    setOpen(false);
  }

  return (
    <>
      <button onClick={show} className={btn(n ? "subtle" : "ghost", "sm")}>
        <SlidersHorizontal size={14} />
        More filters
        {n > 0 && <span className="ml-0.5 grid size-[17px] place-items-center rounded-full bg-brand text-[10px] font-bold text-white">{n}</span>}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="More filters"
        subtitle="Narrows whole tickets, so every section still adds up."
        wide
        footer={
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => apply(BLANK)} className={btn("quiet", "md")}>Clear all</button>
            <div className="flex items-center gap-2">
              <button onClick={() => setOpen(false)} className={btn("quiet", "md")}>Back</button>
              <button onClick={() => apply(draft)} className={btn("primary", "md")}>Validate</button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Picker
            label="Device / till"
            allLabel="All devices"
            value={draft.device}
            options={facets.devices}
            onChange={(device) => setDraft((d) => ({ ...d, device }))}
          />
          <Picker
            label="User log"
            allLabel="All user logs"
            value={draft.user}
            options={facets.users}
            onChange={(user) => setDraft((d) => ({ ...d, user }))}
          />
          <Picker
            label="Service"
            allLabel="All services"
            value={draft.service}
            options={facets.services}
            onChange={(service) => setDraft((d) => ({ ...d, service }))}
          />
          <div>
            <span className={labelCls}>Time of day</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                aria-label="From time"
                value={draft.timeFrom || FULL_DAY.timeFrom}
                onChange={(e) => setDraft((d) => ({ ...d, timeFrom: e.target.value }))}
                className={timeCls}
              />
              <span className="text-[12px] text-faint">→</span>
              <input
                type="time"
                aria-label="To time"
                value={draft.timeTo || FULL_DAY.timeTo}
                onChange={(e) => setDraft((d) => ({ ...d, timeTo: e.target.value }))}
                className={timeCls}
              />
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          A ticket is kept or dropped as a whole. Filtering to a service keeps the tickets that
          contain it, including their other lines — otherwise the sections would stop agreeing
          with each other.
        </p>
      </Modal>
    </>
  );
}
