"use client";

import { useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { btn } from "@/components/ui/button";

// Same shape as BrandImageField: the browser uploads straight to Supabase Storage
// (never through the Worker), and what's STORED on the product is the object PATH,
// not a URL — but product-photos is a PUBLIC bucket (unlike brand-assets/vehicle-photos),
// so the URL built from that path never expires and needs no per-render signing.

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 5 * 1024 * 1024; // the bucket's own limit

/** Downscale to a small square-ish thumbnail — this is a pick-list photo, not artwork. */
async function prepare(file: File, maxPx = 640, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that image"))), "image/webp", quality),
  );
}

export function ProductPhotoField({
  tenantId,
  path,
  previewUrl,
  onChange,
}: {
  tenantId: string;
  /** The stored product-photos object path, or "" for none. */
  path: string;
  /** Public URL for the currently-saved photo (null if there isn't one). */
  previewUrl: string | null;
  onChange: (path: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  const shown = localUrl ?? (path ? previewUrl : null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new Error("That image is over 5 MB — try a smaller one");
      const blob = await prepare(file);
      const sb = createClient();
      // First folder MUST be the tenant id — the bucket's RLS checks it. Flat/unique,
      // like brand-assets — no need to key by product id (this may be a NEW product
      // that doesn't have one yet).
      const objPath = `${tenantId}/products/${crypto.randomUUID()}.webp`;
      const { error: upErr } = await sb.storage.from("product-photos").upload(objPath, blob, { contentType: "image/webp", upsert: false });
      if (upErr) throw upErr;
      setLocalUrl(URL.createObjectURL(blob));
      onChange(objPath); // still needs Save to persist on the product
    } catch (err) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove() {
    setLocalUrl(null);
    setError(null);
    onChange("");
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-[10px] border border-line bg-sub">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-[9.5px] text-faint">No photo</div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <Loader2 size={14} className="animate-spin text-link" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={btn("ghost", "sm")}>
            <ImageUp size={13} /> {busy ? "Uploading…" : shown ? "Replace" : "Upload"}
          </button>
          {shown && (
            <button type="button" onClick={remove} disabled={busy} className={btn("ghost", "sm")}>
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted">Helps staff pick the right item at the counter</p>
        {error && <p className="text-[11.5px] text-rose">{error}</p>}
      </div>
      <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} className="hidden" />
    </div>
  );
}
