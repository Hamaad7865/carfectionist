"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Warehouse, Store, Power, Pencil, Trash2, Star } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { saveLocationAction, deleteLocationAction } from "./location-actions";
import type { LocationAdminRow } from "@/lib/supabase/queries/stock-locations";

// Two flags do all the work here, and both are facts about the business rather
// than positions in a list:
//   • DEFAULT — where stock lands when nobody names a location
//   • TILL    — the floor a counter sale debits
// Naming them on the row is the whole point: before this, "the shop" meant
// "whichever location isn't the default", which stopped being an answer the
// moment a second warehouse existed.

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toFixed(3).replace(/\.?0+$/, ""));

function Badge({ tone, children }: { tone: "brand" | "mint" | "faint"; children: React.ReactNode }) {
  const cls = {
    brand: "bg-[rgba(43,140,255,0.12)] text-link",
    mint: "bg-[rgba(13,167,124,0.14)] text-mint",
    faint: "bg-[rgba(15,23,32,0.08)] text-faint",
  }[tone];
  return <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${cls}`}>{children}</span>;
}

const btn = "inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12px] font-bold text-body hover:border-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-2";

export function LocationsPanel({ locations, canManage }: { locations: LocationAdminRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LocationAdminRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      router.refresh();
    } else setError(r.error);
  }

  const openNew = () => { setName(""); setError(null); setCreating(true); };
  const openEdit = (l: LocationAdminRow) => { setName(l.name); setError(null); setEditing(l); };

  /** Why this location can't be switched off — answered before the click, not
   *  after. The RPC enforces all of this; this only saves the owner a refusal. */
  function blocksOff(l: LocationAdminRow): string | null {
    if (l.isDefault) return "The default location can't be switched off — make another location the default first.";
    if (l.isSalesFloor) return "The till sells from here — point the till at another location first.";
    if (l.units !== 0) return `Move the ${num(l.units)} units out first, or switching it off would strand them.`;
    return null;
  }
  function blocksDelete(l: LocationAdminRow): string | null {
    if (l.isDefault || l.isSalesFloor) return "Hand the default or the till to another location first.";
    if (l.hasHistory) return "Stock has moved through here, so the history needs it. Switch it off instead.";
    return null;
  }

  return (
    <>
      {!creating && !editing && <FormError error={error} />}

      <div className="flex flex-col gap-2.5">
        {locations.map((l) => {
          const offReason = blocksOff(l);
          const delReason = blocksDelete(l);
          const Icon = l.isSalesFloor ? Store : Warehouse;
          return (
            <div key={l.id} className={`rounded-[13px] border border-line bg-card p-4 ${l.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] ${l.isSalesFloor ? "bg-[rgba(13,167,124,0.12)] text-mint" : "bg-sub text-muted"}`}>
                  <Icon size={16} />
                </span>
                <span className="text-[14px] font-bold text-ink-strong">{l.name}</span>
                {l.isDefault && <Badge tone="brand">DEFAULT</Badge>}
                {l.isSalesFloor && <Badge tone="mint">TILL</Badge>}
                {!l.isActive && <Badge tone="faint">SWITCHED OFF</Badge>}
                <div className="flex-1" />
                <span className="num text-[12px] text-muted">
                  {l.units === 0 ? "empty" : `${num(l.products)} product${l.products === 1 ? "" : "s"} · ${num(l.units)} units`}
                </span>
              </div>

              {canManage && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button onClick={() => openEdit(l)} className={btn} disabled={busy}>
                    <Pencil size={13} /> Rename
                  </button>
                  <button
                    onClick={() => run(() => saveLocationAction({ id: l.id, name: l.name, isDefault: true }))}
                    className={btn}
                    disabled={busy || l.isDefault || !l.isActive}
                    title={l.isDefault ? "Already the default" : !l.isActive ? "Switch it back on first" : "Stock lands here when nobody names a location"}
                  >
                    <Star size={13} /> Make default
                  </button>
                  <button
                    onClick={() => run(() => saveLocationAction({ id: l.id, name: l.name, isSalesFloor: true }))}
                    className={btn}
                    disabled={busy || l.isSalesFloor || !l.isActive}
                    title={l.isSalesFloor ? "The till already sells from here" : !l.isActive ? "Switch it back on first" : "Counter sales will debit this location"}
                  >
                    <Store size={13} /> Point the till here
                  </button>
                  <button
                    onClick={() => run(() => saveLocationAction({ id: l.id, name: l.name, isActive: !l.isActive }))}
                    className={btn}
                    disabled={busy || (l.isActive && offReason !== null)}
                    title={l.isActive ? (offReason ?? "Retire it — it's empty, so nothing is lost") : "Bring it back into use"}
                  >
                    <Power size={13} /> {l.isActive ? "Switch off" : "Switch on"}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => run(() => deleteLocationAction({ id: l.id }))}
                    className={`${btn} hover:border-rose hover:text-rose`}
                    disabled={busy || delReason !== null}
                    title={delReason ?? "Delete it — nothing has ever been stored here"}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              )}

              {canManage && l.isActive && offReason && !l.isDefault && !l.isSalesFloor && (
                <p className="mt-2 text-[11.5px] text-faint">{offReason}</p>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        <button onClick={openNew} className="grad-brand shadow-brand mt-4 inline-flex h-10 items-center gap-1.5 rounded-[11px] px-4 text-[13px] font-bold text-white">
          <Plus size={15} strokeWidth={2.4} /> New location
        </button>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? "Rename location" : "New location"}
        subtitle={editing ? editing.name : "A second warehouse, another shop, a container — anywhere stock sits"}
        footer={
          <div className="flex items-center gap-2">
            <button onClick={() => { setCreating(false); setEditing(null); }} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">
              Cancel
            </button>
            <button
              onClick={() => run(() => saveLocationAction({ id: editing?.id ?? null, name }))}
              disabled={busy || name.trim() === ""}
              className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : editing ? "Save name" : "Create location"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Name" hint="What staff will call it">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouse 2" autoFocus maxLength={40} />
          </Field>
          {!editing && (
            <p className="rounded-[10px] bg-sub px-3 py-2 text-[12px] text-muted">
              It starts empty and switched on. Move stock in with a transfer; make it the default or the till&apos;s floor once it&apos;s ready.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
