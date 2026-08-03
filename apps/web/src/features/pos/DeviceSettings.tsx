"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/ui/form";
import { muDateTime } from "@/lib/mu-date";
import { renameDeviceAction, setDeviceActiveAction, setDeviceTakesPaymentsAction } from "./actions";
import type { PosDevice } from "@/lib/supabase/queries/pos-devices";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[14px] text-ink outline-none focus:border-brand";

export function DeviceSettings({ device }: { device: PosDevice }) {
  const router = useRouter();
  const [name, setName] = useState(device.name === device.code ? "" : device.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function saveName() {
    if (!device.id) return;
    setError(null);
    setBusy(true);
    const r = await renameDeviceAction({ deviceId: device.id, name });
    setBusy(false);
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); router.refresh(); } else setError(r.error);
  }

  async function toggleActive() {
    if (!device.id) return;
    setError(null);
    setBusy(true);
    const r = await setDeviceActiveAction({ deviceId: device.id, active: !device.isActive });
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }

  async function toggleTakesPayments() {
    if (!device.id) return;
    setError(null);
    setBusy(true);
    const r = await setDeviceTakesPaymentsAction({ deviceId: device.id, takesPayments: !device.takesPayments });
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <FormError error={error} />

      {device.id ? (
        <>
          <div className="rounded-[15px] border border-line bg-card p-5">
            <div className="text-[13px] font-bold text-ink">Device name</div>
            <p className="mt-0.5 text-[12px] text-muted">A friendly name shown everywhere instead of the technical id.</p>
            <div className="mt-3 flex gap-2">
              <input className={`${field} flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Caisse 1 (currently ${device.code})`} />
              <button onClick={saveName} disabled={busy} className="grad-brand shadow-brand h-10 shrink-0 rounded-[11px] px-4 text-[13px] font-bold text-white disabled:opacity-60">
                {saved ? "Saved ✓" : busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="rounded-[15px] border border-line bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-ink">
                  {device.takesPayments ? "This device takes payments" : "Quotation only"}
                </div>
                <p className="mt-0.5 text-[12px] text-muted">
                  {device.takesPayments
                    ? "Opens a till and collects money. Checkout is on the tablet."
                    : "Never opens a till. Reception, quotations and jobs only — money is taken at a paying terminal."}
                </p>
              </div>
              <button
                onClick={toggleTakesPayments}
                disabled={busy}
                className="h-9 shrink-0 rounded-[10px] border border-line-2 px-3.5 text-[12.5px] font-bold text-body hover:border-brand disabled:opacity-60"
              >
                {device.takesPayments ? "Make quotation only" : "Let it take payments"}
              </button>
            </div>
          </div>

          <div className="rounded-[15px] border border-line bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-ink">Device is {device.isActive ? "active" : "inactive"}</div>
                <p className="mt-0.5 text-[12px] text-muted">
                  {device.isActive
                    ? "Counted in the device total and allowed to trade."
                    : "Retired/lost — out of the device count. Re-enable to bring it back."}
                </p>
              </div>
              <button
                onClick={toggleActive}
                disabled={busy}
                className={`h-9 shrink-0 rounded-[10px] border px-3.5 text-[12.5px] font-bold disabled:opacity-60 ${
                  device.isActive
                    ? "border-[rgba(214,59,80,0.35)] text-rose hover:bg-[rgba(214,59,80,0.06)]"
                    : "border-line-2 text-body hover:border-brand"
                }`}
              >
                {device.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-[15px] border border-dashed border-line-2 p-5 text-[12.5px] text-muted">
          {device.isBackOffice
            ? "The web back office has no device settings — it's this app."
            : "This device traded before the registry existed. It will appear here with full settings the first time the updated app starts on it."}
        </div>
      )}

      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="border-b border-line px-5 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Technical details</div>
        {[
          ["Device code", device.code],
          ["Model", device.model ?? "—"],
          ["App version", device.appVersion ?? "—"],
          ["First seen", device.firstSeen ? muDateTime(device.firstSeen) : "—"],
          ["Last seen", device.lastSeen ? muDateTime(device.lastSeen) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-line px-5 py-2.5 text-[12.5px] last:border-b-0">
            <span className="text-muted">{k}</span>
            <span className="num font-semibold text-body">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
