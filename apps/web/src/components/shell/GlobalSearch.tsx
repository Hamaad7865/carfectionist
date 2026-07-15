"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, User, Car, CornerDownLeft } from "lucide-react";
import type { SearchHit } from "@/app/api/search/route";

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
