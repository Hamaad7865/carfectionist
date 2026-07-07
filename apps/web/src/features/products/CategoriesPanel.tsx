"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tags, Pencil, Check, X, GitMerge } from "lucide-react";
import type { CategoriesData } from "@/lib/supabase/queries/categories";
import { renameCategoryAction } from "./actions";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const fieldCls = "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-[13.5px] text-ink outline-none focus:border-brand";
const ghostBtn = "inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-body hover:border-brand";
const primaryBtn = "grad-brand shadow-brand inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50";
const mergeBtn = "inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[rgba(240,160,32,0.4)] bg-[rgba(240,160,32,0.08)] px-3 text-[12.5px] font-semibold text-amber-ink hover:border-amber-ink";

export function CategoriesPanel({ data }: { data: CategoriesData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(() => data.categories.map((c) => c.name), [data.categories]);

  // Flag near-duplicate spellings (case/spacing) so they can be merged with one
  // click. Canonical = the variant carrying the most products.
  const dupCanonical = useMemo(() => {
    const groups = new Map<string, { name: string; total: number }[]>();
    for (const c of data.categories) {
      const k = norm(c.name);
      const arr = groups.get(k) ?? [];
      arr.push({ name: c.name, total: c.total });
      groups.set(k, arr);
    }
    const canon = new Map<string, string>();
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      const best = arr.slice().sort((a, b) => b.total - a.total)[0].name;
      for (const x of arr) if (x.name !== best) canon.set(x.name, best);
    }
    return canon;
  }, [data.categories]);

  async function run(from: string, to: string) {
    setBusy(true);
    setError(null);
    const r = await renameCategoryAction({ from, to });
    setBusy(false);
    if (r.ok) { setEditing(null); router.refresh(); }
    else setError(r.error);
  }

  function startEdit(name: string) {
    setEditing(name);
    setDraft(name);
    setError(null);
  }

  function save(from: string) {
    const t = draft.trim();
    const existingMatch = names.find((n) => n !== from && norm(n) === norm(t));
    const to = t === "" ? "" : existingMatch ?? t;
    run(from, to);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Tags size={16} className="text-brand" />
        <span className="font-display text-[14px] font-bold text-ink-strong">Categories</span>
        <span className="text-[12.5px] text-faint">· {data.categories.length}</span>
      </div>
      <p className="-mt-2 text-[12.5px] text-muted">
        Renaming a category updates every product that uses it. Rename it to an existing name to merge them; clear the name to remove the category.
      </p>

      {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}

      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        {data.categories.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No categories yet — add one on a product in the Catalogue.</div>
        ) : (
          data.categories.map((c) => {
            const isEd = editing === c.name;
            const canonical = dupCanonical.get(c.name);
            const t = draft.trim();
            const existingMatch = names.find((n) => n !== c.name && norm(n) === norm(t));
            const willMerge = isEd && t !== "" && !!existingMatch;
            const willClear = isEd && t === "";
            const plural = c.total !== 1 ? "s" : "";
            return (
              <div key={c.name} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {isEd ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") save(c.name);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className={fieldCls}
                        placeholder="Category name (blank to clear)"
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-ink">{c.name}</span>
                        {canonical && (
                          <span className="rounded-full bg-[rgba(240,160,32,0.12)] px-2 py-0.5 text-[10.5px] font-bold text-amber-ink">looks like “{canonical}”</span>
                        )}
                      </div>
                    )}
                    {!isEd && (
                      <div className="mt-0.5 text-[12px] text-muted">
                        {c.total} product{plural}
                        {c.archived > 0 && <span className="text-faint"> · {c.archived} archived</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isEd ? (
                      <>
                        <button onClick={() => save(c.name)} disabled={busy} className={primaryBtn}>
                          <Check size={15} /> Save
                        </button>
                        <button onClick={() => setEditing(null)} className={ghostBtn} aria-label="Cancel">
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        {canonical && (
                          <button onClick={() => run(c.name, canonical)} disabled={busy} className={mergeBtn}>
                            <GitMerge size={15} /> Merge
                          </button>
                        )}
                        <button onClick={() => startEdit(c.name)} className={ghostBtn}>
                          <Pencil size={14} /> Rename
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isEd && (
                  <div className="mt-2 text-[12px]">
                    {willMerge ? (
                      <span className="text-amber-ink">↪ Merges into “{existingMatch}” — {c.total} product{plural} reassigned.</span>
                    ) : willClear ? (
                      <span className="text-rose">Clears the category from {c.total} product{plural}.</span>
                    ) : (
                      <span className="text-faint">Renames {c.total} product{plural}.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {data.uncategorised > 0 && (
        <p className="text-[12.5px] text-faint">
          <span className="font-semibold text-muted">Uncategorised</span> · {data.uncategorised} product{data.uncategorised !== 1 ? "s" : ""} with no category. Assign one on the product in the Catalogue.
        </p>
      )}
    </div>
  );
}
