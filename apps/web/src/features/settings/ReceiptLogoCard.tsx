"use client";

import { useState } from "react";
import { BrandImageField } from "./BrandImageField";
import { setReceiptLogoAction } from "./business-actions";

// The till-receipt logo. Unlike the template editor (draft → Save), this saves
// the moment the upload lands — there is nothing else on the form to batch it
// with, and "uploaded but never saved" was the support call waiting to happen.
export function ReceiptLogoCard({ tenantId, value, previewUrl }: { tenantId: string; value: string; previewUrl: string | null }) {
  const [saved, setSaved] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(path: string) {
    setState("saving");
    setError(null);
    const res = await setReceiptLogoAction(path);
    if (res.ok) {
      setSaved(path);
      setState("done");
    } else {
      setState("error");
      setError(res.error);
    }
  }

  return (
    <div className="rounded-[15px] border border-line bg-card p-5">
      <div className="font-display text-[15px] font-bold text-ink-strong">Till receipt</div>
      <p className="mb-4 mt-0.5 text-[12px] text-muted">
        Printed at the top of every receipt — on the thermal slip, the tablet&apos;s on-screen copy, and the web ticket.
      </p>
      <BrandImageField
        label="Receipt logo"
        hint="PNG or JPG works best. Dark artwork is automatically inverted for thermal paper, so the printed slip stays ink-on-white."
        tenantId={tenantId}
        value={saved}
        previewUrl={previewUrl}
        defaultPreview=""
        onChange={save}
        aspect="aspect-[4/1]"
        accept="image/png,image/jpeg,image/webp"
        resetLabel="Remove"
      />
      <div className="mt-1 min-h-[16px] text-[11.5px]">
        {state === "saving" && <span className="text-muted">Saving…</span>}
        {state === "done" && <span className="text-mint">Saved — the tablet picks it up on its next refresh.</span>}
        {state === "error" && <span className="text-rose">{error}</span>}
      </div>
    </div>
  );
}
