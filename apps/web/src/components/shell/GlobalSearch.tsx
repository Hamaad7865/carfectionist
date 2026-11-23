"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, User, Car, CornerDownLeft, ArrowLeft, X } from "lucide-react";
import type { SearchHit } from "@/app/api/search/route";
import { useBackToClose } from "./useBackToClose";

// The real global search: type → (after a short pause) ask /api/search → show a
// dropdown → arrow keys + Enter, or click, to go there. ⌘K / Ctrl-K focuses it.
const ICON = { invoice: FileText, customer: User, vehicle: Car };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // which row is highlighted
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // ── ⌘K / Ctrl-K focuses the box from anywhere ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── close when you click outside the box ──
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── debounce: wait 220ms after you stop typing, THEN fetch ──
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController(); // cancels an in-flight request if you keep typing
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted or failed — leave prior hits */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative hidden h-10 max-w-[420px] flex-1 md:block">
      <div className="flex h-10 items-center gap-2.5 rounded-[11px] border border-line-2 bg-white px-3 focus-within:border-brand">
        <Search size={16} className="text-faint" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search invoices, customers, vehicles…"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-faint"
        />
        <span className="num rounded-[5px] border border-line-2 px-1.5 py-0.5 text-[10px] text-fainter">⌘K</span>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[46px] z-50 overflow-hidden rounded-[13px] border border-line bg-card shadow-[0_20px_50px_-15px_rgba(15,23,32,0.35)]">
          {loading && hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-faint">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-faint">No matches for &ldquo;{q.trim()}&rdquo;</div>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {hits.map((h, i) => {
                const Icon = ICON[h.type];
                return (
                  <li key={`${h.type}-${h.id}`}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${i === active ? "bg-sub" : ""}`}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-2 bg-white text-muted">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{h.label}</span>
                        <span className="block truncate text-[11.5px] text-muted">{h.sub}</span>
                      </span>
                      {i === active && <CornerDownLeft size={14} className="shrink-0 text-faint" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Phone search: a magnifier in the topbar that opens a full-screen search.
 *  Same endpoint and results as the desktop box; hidden from md up. */
export function MobileSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // The last answer and the term it answers. Hits and "searching…" are derived
  // from it, so typing never has to reset state from inside the effect.
  const [result, setResult] = useState<{ term: string; hits: SearchHit[] }>({ term: "", hits: [] });
  const term = q.trim();
  const hits = term.length < 2 ? [] : result.hits;
  const loading = term.length >= 2 && result.term !== term;
  const inputRef = useRef<HTMLInputElement>(null);
  // Back closes the search sheet instead of leaving the page; every other way
  // out goes through `leave`, which pops the sheet's history entry first.
  const leave = useBackToClose(open, () => {
    setOpen(false);
    setQ("");
  });

  useEffect(() => {
    if (!open) return;
    // Focus after paint so the phone keyboard opens with the sheet.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, leave]);

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = (await res.json()) as { hits: SearchHit[] };
        setResult({ term, hits: data.hits ?? [] });
      } catch {
        // Aborted: a newer term is on its way. Failed: stop "searching…", keep prior hits.
        if (!controller.signal.aborted) setResult((r) => ({ term, hits: r.hits }));
      }
    }, 220);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [term]);

  function close() {
    leave();
  }

  // Pop the sheet's entry, then open the hit — Back from there returns in one press.
  function go(hit: SearchHit) {
    leave(() => router.push(hit.href));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-card text-muted md:hidden"
      >
        <Search size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="fixed inset-0 z-[80] flex flex-col bg-app md:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-3 py-2.5">
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close search"
              className="grid size-10 shrink-0 place-items-center rounded-[10px] text-body"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-line-2 bg-sub px-3 focus-within:border-brand">
              <Search size={17} className="shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hits[0]) {
                    e.preventDefault();
                    go(hits[0]);
                  }
                }}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Invoice, customer, plate…"
                className="min-w-0 flex-1 bg-transparent text-[16px] font-medium text-ink outline-none placeholder:text-faint"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid size-8 shrink-0 place-items-center text-faint">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {term.length < 2 ? (
              <p className="px-6 py-10 text-center text-[13.5px] text-faint">Type at least two letters — an invoice number, a name, a phone or a number plate.</p>
            ) : loading && hits.length === 0 ? (
              <p className="px-6 py-10 text-center text-[13.5px] text-faint">Searching…</p>
            ) : hits.length === 0 ? (
              <p className="px-6 py-10 text-center text-[13.5px] text-faint">No matches for &ldquo;{term}&rdquo;</p>
            ) : (
              <ul className="divide-y divide-line bg-card">
                {hits.map((h) => {
                  const Icon = ICON[h.type];
                  return (
                    <li key={`${h.type}-${h.id}`}>
                      <button type="button" onClick={() => go(h)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sub">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-sub text-muted">
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-ink">{h.label}</span>
                          <span className="block truncate text-[12.5px] text-muted">{h.sub}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
