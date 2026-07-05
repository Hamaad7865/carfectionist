"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { createStaffAction, setRoleAction, setActiveAction } from "./team-actions";
import type { TeamMember } from "@/lib/supabase/queries/settings";

const ROLES = ["owner", "manager", "cashier", "technician", "accountant"] as const;
const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", technician: "Technician", accountant: "Accountant" };

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

export function TeamPanel({ members, canManage }: { members: TeamMember[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [f, setF] = useState({ displayName: "", email: "", password: "", role: "cashier" as (typeof ROLES)[number] });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function create() {
    setError(null);
    setBusy(true);
    const r = await createStaffAction(f);
    setBusy(false);
    if (r.ok) { setOpen(false); setF({ displayName: "", email: "", password: "", role: "cashier" }); router.refresh(); }
    else setError(r.error);
  }
  async function changeRole(id: string, role: string) {
    setRowError(null);
    const r = await setRoleAction({ id, role: role as (typeof ROLES)[number] });
    if (r.ok) router.refresh(); else setRowError(r.error);
  }
  async function toggleActive(id: string, active: boolean) {
    setRowError(null);
    const r = await setActiveAction(id, active);
    if (r.ok) router.refresh(); else setRowError(r.error);
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex justify-end">
          <button onClick={() => { setError(null); setOpen(true); }} className="grad-brand shadow-brand inline-flex h-10 items-center gap-2 rounded-[11px] px-4 text-[13px] font-bold text-white">
            <Plus size={16} strokeWidth={2.4} /> Add staff
          </button>
        </div>
      )}

      {rowError && <FormError error={rowError} />}

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="grid grid-cols-[1fr_150px_130px_90px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          <span>Member</span><span>Role</span><span>Status</span><span className="text-right"> </span>
        </div>
        {members.map((m) => (
          <div key={m.id} className={`grid grid-cols-[1fr_150px_130px_90px] items-center gap-3 border-b border-line px-5 py-3 ${m.active ? "" : "opacity-55"}`}>
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] font-display text-[12px] font-extrabold text-[#3f5065]" style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}>{initials(m.name)}</span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink">{m.name}{m.isSelf && <span className="ml-2 text-[10px] font-bold uppercase text-faint">you</span>}</div>
                <div className="truncate text-[11.5px] text-muted">{m.email ?? "—"}</div>
              </div>
            </div>
            {canManage ? (
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} className="h-9 rounded-[9px] border border-line-2 bg-sub px-2 text-[12.5px] font-semibold text-body outline-none focus:border-brand">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            ) : (
              <span className="text-[12.5px] font-semibold text-body">{ROLE_LABEL[m.role] ?? m.role}</span>
            )}
            <span>
              <span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold ${m.active ? "bg-[rgba(13,167,124,0.14)] text-mint" : "bg-[rgba(140,150,161,0.16)] text-muted"}`}>
                {m.active ? "Active" : "Inactive"}
              </span>
            </span>
            <span className="text-right">
              {canManage && !m.isSelf && (
                <button onClick={() => toggleActive(m.id, !m.active)} className="text-[12px] font-semibold text-link hover:underline">
                  {m.active ? "Deactivate" : "Activate"}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add staff member"
        subtitle="Creates a login and adds them to your team."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={create} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
              <UserPlus size={15} /> {busy ? "Creating…" : "Create login"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Full name"><input className={inputCls} value={f.displayName} onChange={set("displayName")} placeholder="e.g. Priya Naiko" autoFocus /></Field>
          <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} placeholder="name@carfectionist.mu" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temporary password" hint="Min 8 characters"><input className={inputCls} value={f.password} onChange={set("password")} placeholder="They can change it later" /></Field>
            <Field label="Role">
              <select className={inputCls} value={f.role} onChange={set("role")}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
