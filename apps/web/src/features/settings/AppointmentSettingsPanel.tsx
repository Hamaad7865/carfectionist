"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputCls } from "@/components/ui/form";
import { btn as btnCls } from "@/components/ui/button";
import type { AppointmentSettings, WorkPlace } from "@/lib/supabase/queries/appointment-settings";
import {
  deleteWorkPlaceAction,
  saveAppointmentReminderAction,
  saveWorkPlaceAction,
} from "./appointment-settings-actions";

type ActionResult = { ok: true } | { ok: false; error: string };
const ghost = btnCls("ghost", "sm");

export function AppointmentSettingsPanel({
  settings,
  canManage,
}: {
  settings: AppointmentSettings;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderDays, setReminderDays] = useState(String(settings.reminderDays));
  const [editing, setEditing] = useState<WorkPlace | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  async function run(action: () => Promise<ActionResult>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setCreating(false);
      setEditing(null);
      router.refresh();
    } else setError(result.error);
    return result;
  }

  const openNew = () => {
    setName("");
    setEditing(null);
    setCreating(true);
    setError(null);
  };
  const openEdit = (place: WorkPlace) => {
    setName(place.name);
    setEditing(place);
    setCreating(false);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {!creating && !editing && <FormError error={error} />}

      <section className="rounded-[15px] border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(43,140,255,0.12)] text-link">
            <BellRing size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[14px] font-bold text-ink-strong">Upcoming appointment reminder</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              The notification bell will show live, scheduled appointments due in the next selected number of days.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:w-[180px] sm:flex-none">
            <Field label="Remind me for the next" hint="1 to 30 days">
              <input
                className={inputCls}
                type="number"
                min={1}
                max={30}
                step={1}
                value={reminderDays}
                disabled={!canManage}
                onChange={(e) => {
                  setReminderDays(e.target.value);
                  setSaved(false);
                }}
              />
            </Field>
          </div>
          <span className="pb-2.5 text-[13px] font-semibold text-body">day{reminderDays === "1" ? "" : "s"}</span>
          {canManage && (
            <button
              className={btnCls("primary", "lg", "w-full sm:w-auto")}
              disabled={busy || reminderDays.trim() === ""}
              onClick={() => void run(() => saveAppointmentReminderAction({ reminderDays: Number(reminderDays) }))
                .then((result) => { if (result.ok) setSaved(true); })}
            >
              {busy ? "Saving…" : "Save reminder"}
            </button>
          )}
          {saved && <span className="pb-2.5 text-[12px] font-semibold text-mint">Saved</span>}
        </div>
      </section>

      <section className="rounded-[15px] border border-line bg-card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sub text-muted">
            <Building2 size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[14px] font-bold text-ink-strong">Places of work</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              These names appear when staff book appointments or create and update jobs. Deleting one keeps its existing job history intact.
            </p>
          </div>
          {canManage && (
            <button onClick={openNew} className={btnCls("primary", "lg", "w-full sm:w-auto")} disabled={busy}>
              <Plus size={14} /> Add place
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {settings.workPlaces.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-line-2 px-4 py-8 text-center text-[12.5px] text-faint">
              No places of work yet.
            </div>
          ) : settings.workPlaces.map((place) => (
            <div key={place.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-sub px-3.5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-card text-muted">
                <Building2 size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-body">{place.name}</span>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Phones: icon-only, so the place name keeps the room. */}
                  <button onClick={() => openEdit(place)} className={ghost} disabled={busy} aria-label={`Rename ${place.name}`}>
                    <Pencil size={13} /> <span className="hidden sm:inline">Rename</span>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete "${place.name}"? Existing jobs and appointments will keep their place name.`)) {
                        void run(() => deleteWorkPlaceAction({ id: place.id }));
                      }
                    }}
                    className={`${ghost} hover:border-rose hover:text-rose`}
                    disabled={busy}
                    aria-label={`Delete ${place.name}`}
                  >
                    <Trash2 size={13} /> <span className="hidden sm:inline">Delete</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Rename place of work" : "Add place of work"}
        subtitle={editing?.name ?? "A workshop, garage, bay, branch or service area"}
        footer={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
              className={btnCls("quiet", "lg")}
            >
              Cancel
            </button>
            <button
              onClick={() => void run(() => saveWorkPlaceAction({ id: editing?.id ?? null, name }))}
              disabled={busy || name.trim() === ""}
              className={btnCls("primary", "lg", "px-5")}
            >
              {busy ? "Saving…" : editing ? "Save name" : "Add place"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Name" hint="This is what staff will see in appointment and job pickers">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main workshop"
              maxLength={60}
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
