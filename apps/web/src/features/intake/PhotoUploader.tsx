"use client";

import { useRef, useState } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export interface IntakePhoto {
  path: string; // storage object key in vehicle-photos
  url: string; // preview (local object URL) or signed URL
}

// Downscale to ≤ maxPx on the long edge and re-encode webp, so a phone photo
// stays well under the bucket's 10 MiB limit.
async function downscale(file: File, maxPx = 1600, quality = 0.85): Promise<Blob> {
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
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/webp", quality),
  );
}

export function PhotoUploader({
  tenantId,
  folder,
  photos,
  onAdd,
  onRemove,
  max = 12,
  label = "Photos",
}: {
  tenantId: string;
  folder: string; // second path segment, e.g. "intake" or a jobId
  photos: IntakePhoto[];
  onAdd: (p: IntakePhoto) => void;
  onRemove?: (i: number) => void;
  max?: number;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await downscale(file);
      const sb = createClient();
      const path = `${tenantId}/${folder}/${crypto.randomUUID()}.webp`;
      const { error: upErr } = await sb.storage.from("vehicle-photos").upload(path, blob, { contentType: "image/webp", upsert: false });
      if (upErr) throw upErr;
      onAdd({ path, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      {label && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{label}</div>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p, i) => (
          <div key={p.path} className="group relative aspect-[4/3] overflow-hidden rounded-[10px] border border-line bg-sub">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="grid aspect-[4/3] place-items-center rounded-[10px] border-[1.5px] border-dashed border-line-2 bg-sub text-faint hover:border-brand hover:text-brand disabled:opacity-60"
          >
            <div className="flex flex-col items-center gap-1">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              <span className="text-[9px] font-bold uppercase tracking-wide">{busy ? "Uploading" : "Add"}</span>
            </div>
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
      {error && <p className="mt-1.5 text-[11.5px] text-rose">{error}</p>}
    </div>
  );
}
