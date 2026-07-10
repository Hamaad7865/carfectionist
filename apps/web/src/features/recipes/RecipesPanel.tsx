"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, FlaskConical } from "lucide-react";
import type { RecipesData } from "@/lib/supabase/queries/recipes";
import { addRecipeComponentAction, deleteRecipeComponentAction } from "./actions";

const field = "h-10 rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";

export function RecipesPanel({ data }: { data: RecipesData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [svc, setSvc] = useState(data.services[0]?.id ?? "");
  const [comp, setComp] = useState(data.components[0]?.id ?? "");
  const [qty, setQty] = useState("");

  async function add() {
    setError(null);
    const q = parseFloat(qty);
    if (!(q > 0)) return setError("Enter a quantity greater than zero.");
    setBusy(true);
    const r = await addRecipeComponentAction({ serviceProductId: svc, componentProductId: comp, expectedQty: q });
    setBusy(false);
    if (r.ok) {
      setQty("");
      router.refresh();
    } else setError(r.error);
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    const r = await deleteRecipeComponentAction(id);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <FlaskConical size={15} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">Add to a recipe</span>
        </div>
        <p className="mb-4 text-[12.5px] text-muted">Bills of materials pre-fill the consumables deducted when a job for this service completes.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Service</span>
            <select className={`${field} w-full sm:w-auto sm:min-w-[220px]`} value={svc} onChange={(e) => setSvc(e.target.value)}>
              {data.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Consumes</span>
            <select className={`${field} w-full sm:w-auto sm:min-w-[200px]`} value={comp} onChange={(e) => setComp(e.target.value)}>
              {data.components.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unit})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Qty</span>
            <input className={`${field} w-[100px] text-right`} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="0" />
          </label>
          <button onClick={add} disabled={busy} className="grad-brand shadow-brand flex h-10 items-center gap-1.5 rounded-[11px] px-4 text-[13px] font-bold text-white disabled:opacity-50">
            <Plus size={15} /> Add
          </button>
        </div>
      </div>

      {data.recipes.length === 0 ? (
        <div className="rounded-[15px] border border-line bg-card p-8 text-center text-[13px] text-muted">No recipes yet. Add the first component above.</div>
      ) : (
        data.recipes.map((r) => (
          <div key={r.serviceProductId} className="overflow-hidden rounded-[15px] border border-line bg-card">
            <div className="border-b border-line px-5 py-3 font-display text-[14px] font-bold text-ink-strong">{r.serviceName}</div>
            <div className="divide-y divide-line">
              {r.components.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                  <span className="flex-1 text-body">{c.name}</span>
                  <span className="num text-muted">
                    {Number.isInteger(c.expectedQty) ? c.expectedQty : c.expectedQty} {c.unit}
                  </span>
                  <button onClick={() => remove(c.id)} disabled={busy} className="text-faint hover:text-rose disabled:opacity-50">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
