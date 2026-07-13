"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { setWaOptOutAction } from "@/features/marketing/actions";

// A small control on the contact detail: whether this customer receives
// WhatsApp marketing. Opting out excludes them from every campaign audience.
export function WaOptOutToggle({ customerId, optOut }: { customerId: string; optOut: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(!optOut); // "on" = receives marketing
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    const r = await setWaOptOutAction(customerId, !next); // optOut = !receives
    setBusy(false);
    if (!r.ok) setOn(!next); // revert on failure
    else router.refresh();
  }

  return (
    <div className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3">
      <div className="flex items-center gap-2.5">
        <MessageCircle size={16} className={on ? "text-mint" : "text-faint"} />
        <div>
          <div className="text-[12.5px] font-semibold text-body">WhatsApp marketing</div>
          <div className="text-[11px] text-faint">{on ? "Receives campaign messages" : "Opted out — excluded from campaigns"}</div>
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-mint" : "bg-line-2"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
