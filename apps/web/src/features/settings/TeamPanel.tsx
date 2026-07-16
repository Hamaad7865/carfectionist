"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserPlus, KeyRound, SlidersHorizontal, Trash2, RotateCcw, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import {
  createStaffAction, setRoleAction, setActiveAction, setStaffPinAction, clearStaffPinAction,
  setModulesAction, resetPasswordAction, deleteStaffAction, updateStaffIdentityAction,
} from "./team-actions";
import { TOGGLEABLE_MODULES, effectiveModules, type Role } from "@/lib/auth/roles";
import type { TeamMember } from "@/lib/supabase/queries/settings";

const ROLES = ["owner", "manager", "cashier", "technician", "accountant"] as const;
const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", technician: "Technician", accountant: "Accountant" };

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

const GRID = "grid-cols-[1fr_140px_100px_120px_96px]";

export function TeamPanel({ members, canManage }: { members: TeamMember[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [f, setF] = useState({ displayName: "", email: "", password: "", role: "cashier" as (typeof ROLES)[number], pin: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  // per-row PIN editor
  const [pinFor, setPinFor] = useState<TeamMember | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // per-row Manage (access + security)
  const [manage, setManage] = useState<TeamMember | null>(null);
  const [modSel, setModSel] = useState<string[]>([]);
  const [pw, setPw] = useState("");
  const [mBusy, setMBusy] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mMsg, setMMsg] = useState<string | null>(null);
  // identity draft (name + login email), seeded when the dialog opens
  const [idName, setIdName] = useState("");
  const [idEmail, setIdEmail] = useState("");

  async function create() {
    setError(null);
    setBusy(true);
    const r = await createStaffAction(f);
    setBusy(false);
    if (r.ok) { setOpen(false); setF({ displayName: "", email: "", password: "", role: "cashier", pin: "" }); router.refresh(); }
    else setError(r.error);
  }
  async function changeRole(id: string, role: string) {
    setRowError(null);
    const r = await setRoleAction({ id, role: role as (typeof ROLES)[number] });
    if (r.ok) router.refresh(); else setRowError(r.error);
  }
  function openPin(m: TeamMember) { setPinFor(m); setPinDraft(""); setPinError(null); }
  async function savePin() {
    if (!pinFor) return;
    setPinError(null); setPinBusy(true);
    const r = await setStaffPinAction({ id: pinFor.id, pin: pinDraft });
    setPinBusy(false);
    if (r.ok) { setPinFor(null); router.refresh(); } else setPinError(r.error);
  }
  async function clearPin() {
    if (!pinFor) return;
    setPinBusy(true);
    const r = await clearStaffPinAction(pinFor.id);
    setPinBusy(false);
    if (r.ok) { setPinFor(null); router.refresh(); } else setPinError(r.error);
  }

  // ── Manage modal ──
  const isOwnerMember = manage?.role === "owner";
  function openManage(m: TeamMember) {
    setManage(m);
    setModSel(effectiveModules(m.role as Role, m.modules).filter((h) => TOGGLEABLE_MODULES.some((t) => t.href === h)));
    setPw(""); setMError(null); setMMsg(null);
    setIdName(m.name); setIdEmail(m.email ?? "");
  }
  function toggleMod(href: string) {
    setModSel((s) => (s.includes(href) ? s.filter((h) => h !== href) : [...s, href]));
  }
  async function saveModules(reset = false) {
    if (!manage) return;
    setMError(null); setMMsg(null); setMBusy(true);
    const r = await setModulesAction({ id: manage.id, modules: reset ? null : modSel });
    setMBusy(false);
    if (r.ok) { setMMsg(reset ? "Access reset to role default." : "Module access saved."); router.refresh(); } else setMError(r.error);
  }
  async function saveActive(active: boolean) {
    if (!manage) return;
    setMError(null); setMBusy(true);
    const r = await setActiveAction(manage.id, active);
    setMBusy(false);
    if (r.ok) { setManage({ ...manage, active }); router.refresh(); } else setMError(r.error);
  }
  async function savePassword() {
    if (!manage) return;
    setMError(null); setMMsg(null); setMBusy(true);
    const r = await resetPasswordAction({ id: manage.id, password: pw });
    setMBusy(false);
    if (r.ok) { setPw(""); setMMsg("Password updated."); } else setMError(r.error);
  }
  async function saveIdentity() {
    if (!manage) return;
    setMError(null); setMMsg(null); setMBusy(true);
    const r = await updateStaffIdentityAction({ id: manage.id, displayName: idName, email: idEmail });
    setMBusy(false);
    if (r.ok) {
      // Keep the open dialog honest — its header still shows the old name.
      setManage({ ...manage, name: idName, email: idEmail });
      setMMsg("Name and email saved.");
      router.refresh();
    } else setMError(r.error);
  }
  const identityDirty = !!manage && (idName.trim() !== manage.name || idEmail.trim() !== (manage.email ?? ""));
  async function del() {
    if (!manage) return;
    if (!confirm(`Delete ${manage.name}? This removes their login permanently.`)) return;
    setMError(null); setMBusy(true);
    const r = await deleteStaffAction(manage.id);
    setMBusy(false);
    if (r.ok) { setManage(null); router.refresh(); } else setMError(r.error);
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

      <div className="overflow-x-auto rounded-[14px] border border-line bg-card">
        <div className={`grid ${GRID} min-w-[600px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th`}>
          <span>Member</span><span>Role</span><span>Status</span><span>Tablet PIN</span><span className="text-right"> </span>
        </div>
        {members.map((m) => (
          <div key={m.id} className={`grid ${GRID} min-w-[600px] items-center gap-3 border-b border-line px-5 py-3 ${m.active ? "" : "opacity-55"}`}>
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] font-display text-[12px] font-extrabold text-[#3f5065]" style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}>{initials(m.name)}</span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink">{m.name}{m.isSelf && <span className="ml-2 text-[10px] font-bold uppercase text-faint">you</span>}</div>
                <div className="truncate text-[11.5px] text-muted">{m.email ?? "—"}</div>
              </div>
            </div>
            {canManage && m.role !== "owner" ? (
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
              {m.modules != null && m.role !== "owner" && <span className="ml-1.5 text-[10px] font-semibold text-link" title="Custom module access">·custom</span>}
            </span>
            <span>
              {canManage ? (
                <button onClick={() => openPin(m)} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line-2 bg-sub px-2.5 py-1.5 text-[11.5px] font-semibold text-body hover:border-brand">
                  <KeyRound size={13} className={m.hasPin ? "text-mint" : "text-faint"} />
                  {m.hasPin ? "•••• Change" : "Set PIN"}
                </button>
              ) : (
                <span className="text-[11.5px] text-muted">{m.hasPin ? "Set" : "—"}</span>
              )}
            </span>
            <span className="text-right">
              {canManage && (
                <button onClick={() => openManage(m)} className="inline-flex items-center gap-1.5 rounded-[8px] border border-line-2 bg-card px-2.5 py-1.5 text-[11.5px] font-semibold text-body hover:border-brand">
                  <SlidersHorizontal size={13} /> Manage
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Add staff */}
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
          <Field label="Tablet PIN" hint="Optional · 4 digits for the POS tablet login">
            <input className={inputCls} value={f.pin} onChange={set("pin")} inputMode="numeric" maxLength={4} placeholder="e.g. 4821" />
          </Field>
        </div>
      </Modal>

      {/* PIN */}
      <Modal
        open={!!pinFor}
        onClose={() => setPinFor(null)}
        title={pinFor ? `Tablet PIN — ${pinFor.name}` : "Tablet PIN"}
        subtitle="The 4-digit code this person taps in on the POS tablet."
        footer={
          <div className="flex items-center justify-between gap-2">
            {pinFor?.hasPin ? (
              <button onClick={clearPin} disabled={pinBusy} className="text-[12.5px] font-semibold text-rose hover:underline disabled:opacity-50">Remove PIN</button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => setPinFor(null)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
              <button onClick={savePin} disabled={pinBusy || !/^[0-9]{4}$/.test(pinDraft)} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-50">
                <KeyRound size={15} /> {pinBusy ? "Saving…" : "Save PIN"}
              </button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={pinError} />
          <Field label="4-digit PIN">
            <input className={`${inputCls} num text-center text-[22px] tracking-[0.5em]`} value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} autoFocus placeholder="••••" />
          </Field>
        </div>
      </Modal>

      {/* Manage — access + security */}
      <Modal
        open={!!manage}
        onClose={() => setManage(null)}
        title={manage ? `Manage — ${manage.name}` : "Manage"}
        subtitle={manage ? `${ROLE_LABEL[manage.role]} · ${manage.email ?? ""}` : undefined}
        footer={<div className="flex justify-end"><button onClick={() => setManage(null)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Done</button></div>}
      >
        {manage && (
          <div className="flex flex-col gap-5">
            {mError && <FormError error={mError} />}
            {mMsg && <p className="rounded-[9px] bg-[rgba(13,167,124,0.1)] px-3 py-2 text-[12.5px] font-semibold text-mint">{mMsg}</p>}

            {/* Name & login email */}
            <section>
              <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Name &amp; login</span>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Display name">
                  <input className={inputCls} value={idName} onChange={(e) => setIdName(e.target.value)} maxLength={60} />
                </Field>
                <Field label="Login email">
                  <input className={inputCls} value={idEmail} onChange={(e) => setIdEmail(e.target.value)} type="email" autoComplete="off" spellCheck={false} />
                </Field>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-[11px] text-faint">
                  {manage.isSelf
                    ? "This is your own login — changing the email changes how YOU sign in."
                    : "They sign in with this email. It changes straight away; no confirmation email is sent."}
                </p>
                <button
                  onClick={saveIdentity}
                  disabled={mBusy || !identityDirty || idName.trim() === "" || idEmail.trim() === ""}
                  className="grad-brand shadow-brand inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold text-white disabled:opacity-50"
                >
                  Save details
                </button>
              </div>
            </section>

            {/* Module access */}
            <section className="border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Module access</span>
                {isOwnerMember ? (
                  <span className="text-[11.5px] font-semibold text-mint">Owner · full access</span>
                ) : (
                  <button onClick={() => saveModules(true)} disabled={mBusy} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-link hover:underline disabled:opacity-50">
                    <RotateCcw size={12} /> Reset to role default
                  </button>
                )}
              </div>
              {isOwnerMember ? (
                <p className="text-[12.5px] text-muted">Owners always have access to every module.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TOGGLEABLE_MODULES.map((mod) => {
                      const on = modSel.includes(mod.href);
                      return (
                        <button key={mod.href} onClick={() => toggleMod(mod.href)} className={`flex items-center gap-2 rounded-[9px] border px-2.5 py-2 text-left text-[12.5px] font-semibold ${on ? "border-brand bg-[rgba(43,140,255,0.06)] text-ink" : "border-line-2 bg-sub text-muted"}`}>
                          <span className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${on ? "bg-brand text-white" : "border border-line-2 bg-card"}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                          {mod.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <p className="text-[11px] text-faint">Dashboard is always available. Financial data stays limited by role.</p>
                    <button onClick={() => saveModules(false)} disabled={mBusy} className="grad-brand shadow-brand inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold text-white disabled:opacity-50">Save access</button>
                  </div>
                </>
              )}
            </section>

            {/* Reset password */}
            <section className="border-t border-line pt-4">
              <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Reset web password</span>
              <div className="mt-2 flex gap-2">
                <input className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8)" type="text" />
                <button onClick={savePassword} disabled={mBusy || pw.length < 8} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] border border-line-2 bg-sub px-4 text-[13px] font-bold text-body hover:border-brand disabled:opacity-50">
                  <KeyRound size={15} /> Set password
                </button>
              </div>
            </section>

            {/* Activate / delete */}
            {!manage.isSelf && (
              <section className="flex items-center justify-between border-t border-line pt-4">
                <button onClick={() => saveActive(!manage.active)} disabled={mBusy} className="inline-flex h-10 items-center rounded-[11px] border border-line-2 bg-sub px-4 text-[13px] font-semibold text-body hover:border-brand disabled:opacity-50">
                  {manage.active ? "Deactivate user" : "Activate user"}
                </button>
                <button onClick={del} disabled={mBusy} className="inline-flex h-10 items-center gap-1.5 rounded-[11px] border border-[rgba(214,59,80,0.35)] bg-[rgba(214,59,80,0.06)] px-4 text-[13px] font-bold text-rose hover:border-rose disabled:opacity-50">
                  <Trash2 size={15} /> Delete
                </button>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
