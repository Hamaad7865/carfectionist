"use client";

import { useRef, useState } from "react";
import { ImageUp, Loader2, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { btn } from "@/components/ui/button";

// Upload artwork for the letterhead. Uploads go straight from the browser to
// Supabase Storage (same as the intake photos) — the file never passes through
// the Worker, which has a request-size limit and no reason to see it.
//
// What is STORED is the object path, never a URL: brand-assets is private, so
// the URL that actually renders is signed fresh on each render (lib/pdf/assets).
// A signed URL saved in here would work for an hour and then leave every invoice
// with no letterhead.

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const MAX_BYTES = 5 * 1024 * 1024; // the bucket's own limit — fail here with a sentence instead

/** Downscale a raster to ≤ maxPx wide and re-encode webp. Banners are wide
 *  artwork, so the long edge that matters is the width. SVG is left alone —
 *  it's already small, and rasterising it would throw away the point of it. */
async function prepare(file: File, maxPx = 2000, quality = 0.9): Promise<{ blob: Blob; ext: string; type: string }> {
  if (file.type === "image/svg+xml") return { blob: file, ext: "svg", type: file.type };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that image"))), "image/webp", quality),
  );
  return { blob, ext: "webp", type: "image/webp" };
}

export function BrandImageField({
  label,
  hint,
  tenantId,
  value,
  previewUrl,
  defaultPreview,
  onChange,
  aspect = "aspect-[6/1]",
  accept = ACCEPT,
  resetLabel = "Use built-in",
}: {
  label: string;
  hint: string;
  tenantId: string;
  /** The stored value: a brand-assets object path, an app path, or "". */
  value: string;
  /** Signed URL for the stored object, resolved server-side. */
  previewUrl: string | null;
  /** What the document falls back to when this is blank. */
  defaultPreview: string;
  onChange: (path: string) => void;
  aspect?: string;
  /** Override when a consumer can't take every format (the tablet can't rasterise SVG). */
  accept?: string;
  /** What clearing means here — "Use built-in" when a default exists, "Remove" when it doesn't. */
  resetLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  // What to show: the file just picked, else the saved artwork, else the
  // built-in default — which is genuinely what the document would print.
  const shown = localUrl ?? previewUrl ?? (value === "" ? defaultPreview : null);
  const usingDefault = value === "";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new Error("That image is over 5 MB — try a smaller one");
      const { blob, ext, type } = await prepare(file);
      const sb = createClient();
      // First folder MUST be the tenant id — the bucket's RLS checks it.
      const path = `${tenantId}/template/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from("brand-assets").upload(path, blob, { contentType: type, upsert: false });
      if (upErr) throw upErr;
      setLocalUrl(URL.createObjectURL(blob));
      onChange(path); // still needs Save template — nothing prints until then
    } catch (err) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function reset() {
    setLocalUrl(null);
    setError(null);
    onChange("");
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">{label}</span>
        {usingDefault && defaultPreview !== "" && <span className="rounded-[5px] bg-[rgba(15,23,32,0.06)] px-1.5 py-0.5 text-[9px] font-bold text-faint">BUILT-IN</span>}
      </div>

      <div className={`relative ${aspect} overflow-hidden rounded-[10px] border border-line bg-sub`}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-faint">No image</div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <Loader2 size={18} className="animate-spin text-link" />
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={btn("ghost", "sm")}
        >
          <ImageUp size={13} /> {busy ? "Uploading…" : "Upload"}
        </button>
        {!usingDefault && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className={btn("ghost", "sm")}
          >
            <RotateCcw size={12} /> {resetLabel}
          </button>
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted">{hint}</p>
      <input ref={fileRef} type="file" accept={accept} onChange={onFile} className="hidden" />
      {error && <p className="mt-1 text-[11.5px] text-rose">{error}</p>}
    </div>
  );
}
