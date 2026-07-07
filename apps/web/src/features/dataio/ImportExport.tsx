"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, X, Check, AlertTriangle } from "lucide-react";
import { parseCsv } from "@/lib/csv";
import type { ImportReport } from "@/lib/supabase/rpc";
import { importCustomersAction, importProductsAction } from "./actions";

type Kind = "customers" | "products";

const btn = "inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3.5 text-[13px] font-bold text-body hover:border-brand";

export function ImportExport({ kind }: { kind: Kind }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [applied, setApplied] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = kind;
  const action = kind === "customers" ? importCustomersAction : importProductsAction;
  const open = busy || preview !== null || applied !== null || error !== null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null); setApplied(null); setPreview(null);
    setBusy(true); setFileName(f.name);
    try {
      const { rows: parsed } = parseCsv(await f.text());
      if (!parsed.length) { setBusy(false); setError("No data rows found in that file."); return; }
      setRows(parsed);
      const res = await action(parsed, true); // dry run → preview
      setBusy(false);
      if (res.ok) setPreview(res.report); else setError(res.error);
    } catch {
      setBusy(false); setError("Could not read that file — is it a CSV?");
    }
  }

  async function apply() {
    if (!rows) return;
    setBusy(true); setError(null);
    const res = await action(rows, false);
    setBusy(false);
    if (res.ok) { setPreview(null); setApplied(res.report); router.refresh(); }
    else setError(res.error);
  }

  function reset() {
    setRows(null); setPreview(null); setApplied(null); setError(null); setFileName(""); setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const Stat = ({ n, l, tone }: { n: number; l: string; tone?: string }) => (
    <div className="flex-1 rounded-[10px] border border-line bg-sub p-2.5 text-center">
      <div className={`num text-[20px] font-extrabold ${tone ?? "text-ink-strong"}`}>{n}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{l}</div>
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      <a href={`/api/export/${kind}`} className={btn}><Download size={15} /> Export</a>
      <button type="button" onClick={() => fileRef.current?.click()} className={btn}><Upload size={15} /> Import</button>
      <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={reset}>
          <div className="w-full max-w-[440px] rounded-[16px] border border-line bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-display text-[17px] font-extrabold text-ink-strong">Import {label}</div>
                {fileName && <div className="num text-[12px] text-muted">{fileName}</div>}
              </div>
              <button onClick={reset} className="text-faint hover:text-body"><X size={18} /></button>
            </div>

            {busy && <div className="py-8 text-center text-[13px] text-muted">Working…</div>}

            {error && (
              <div className="rounded-[11px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.07)] p-3.5 text-[13px] text-rose">
                {error}
              </div>
            )}

            {preview && !busy && (
              <>
                <p className="mb-3 text-[12.5px] text-muted">Preview — nothing has changed yet. Confirm to apply:</p>
                <div className="flex gap-2">
                  <Stat n={preview.inserted} l="New" tone="text-mint" />
                  <Stat n={preview.updated} l="Update" tone="text-link" />
                  <Stat n={preview.skipped} l="Skipped" tone={preview.skipped ? "text-amber-ink" : undefined} />
                </div>
                {kind === "products" && (
                  <p className="mt-2.5 text-[11.5px] text-muted">Prices, costs &amp; details will update by SKU; any <span className="num">stock_…</span> columns set on-hand at that location.</p>
                )}
                <div className="mt-5 flex gap-2">
                  <button onClick={reset} className="h-10 flex-1 rounded-[11px] border border-line-2 bg-sub text-[13px] font-bold text-body">Cancel</button>
                  <button onClick={apply} className="grad-brand shadow-brand h-10 flex-[1.4] rounded-[11px] text-[13px] font-bold text-white">
                    Apply — {preview.inserted + preview.updated} {label}
                  </button>
                </div>
              </>
            )}

            {applied && !busy && (
              <>
                <div className="mb-3 flex items-center gap-2 text-[14px] font-bold text-mint">
                  <Check size={18} strokeWidth={2.6} /> Imported
                </div>
                <div className="flex gap-2">
                  <Stat n={applied.inserted} l="Added" tone="text-mint" />
                  <Stat n={applied.updated} l="Updated" tone="text-link" />
                  {kind === "products" && <Stat n={applied.stock_adjusted ?? 0} l="Stock set" />}
                  <Stat n={applied.skipped} l="Skipped" tone={applied.skipped ? "text-amber-ink" : undefined} />
                </div>
                {applied.errors.length > 0 && (
                  <div className="mt-3 rounded-[10px] border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.07)] p-3 text-[12px] text-amber-ink">
                    <div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle size={13} /> {applied.errors.length} row(s) skipped</div>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {applied.errors.slice(0, 4).map((er, i) => (
                        <li key={i}><span className="num">{er.sku || er.name || "row"}</span>: {er.error}</li>
                      ))}
                      {applied.errors.length > 4 && <li>…and {applied.errors.length - 4} more</li>}
                    </ul>
                  </div>
                )}
                <button onClick={reset} className="grad-brand shadow-brand mt-5 h-10 w-full rounded-[11px] text-[13px] font-bold text-white">Done</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
