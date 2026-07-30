"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getProductActivityAction } from "./actions";
import { toActivityView, type ActivityRow, type ActivityView } from "./activity";

const TONE: Record<ActivityView["tone"], string> = {
  out: "text-rose",
  in: "text-mint",
  none: "text-muted",
};

function Line({ v }: { v: ActivityView }) {
  return (
    <li className="flex items-baseline gap-2 px-4 py-[5px] text-[11.5px] sm:gap-3 sm:px-5">
      <span className="num w-[74px] shrink-0 text-faint">{v.when}</span>
      <span className={`num w-[42px] shrink-0 text-right font-bold ${TONE[v.tone]}`}>{v.qty}</span>
      <span className="hidden w-[86px] shrink-0 truncate text-muted sm:block" title={v.locationName ?? undefined}>
        {v.locationName ?? ""}
      </span>
      {v.href ? (
        <Link href={v.href} className="num shrink-0 font-bold text-link hover:underline">
          {v.label}
        </Link>
      ) : (
        <span className="shrink-0 font-semibold text-body">{v.label}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-muted" title={v.detail ?? undefined}>
        {v.detail ?? ""}
      </span>
      {v.actorName && <span className="hidden shrink-0 text-faint md:block">{v.actorName}</span>}
    </li>
  );
}

/**
 * The history that opens under a catalogue row. Kept mounted while collapsed so
 * the fetch survives a close-and-reopen, and so the open/close can be animated by
 * the row track rather than by a height nobody can measure ahead of time.
 */
export function ProductActivity({ productId, open }: { productId: string; open: boolean }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    getProductActivityAction(productId)
      .then((res) => (res.ok ? setRows(res.data ?? []) : setError(res.error)))
      .catch(() => setError("Couldn’t load history."))
      .finally(() => setBusy(false));
  }, [productId]);

  // Nothing is fetched until the row is actually opened — 397 products' worth of
  // ledger is not worth loading for a page you mostly visit to check a price. The
  // ref, not the state, guards the second run: state changes while the request is
  // in flight, and re-reading it here would cancel the fetch it is reporting on.
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    load();
  }, [open, load]);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        <div className="border-t border-line bg-band py-1.5">
          {busy && (
            <ul className="animate-pulse">
              {[0, 1, 2].map((i) => (
                <li key={i} className="px-4 py-[5px] sm:px-5">
                  <span className="block h-[11px] rounded-[3px] bg-line-2" style={{ width: `${72 - i * 14}%` }} />
                </li>
              ))}
            </ul>
          )}
          {!busy && error && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-[11.5px] text-muted sm:px-5">
              <span>Couldn’t load history.</span>
              <button onClick={load} className="font-semibold text-link hover:underline">
                Try again
              </button>
            </div>
          )}
          {!busy && !error && rows?.length === 0 && (
            <div className="px-4 py-1.5 text-[11.5px] text-faint sm:px-5">No movements recorded yet.</div>
          )}
          {!busy && !error && !!rows?.length && (
            <ol>
              {rows.map((r) => (
                <Line key={r.eventId} v={toActivityView(r)} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
