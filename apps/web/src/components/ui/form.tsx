import type { ReactNode } from "react";

export const inputCls =
  "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13.5px] text-ink outline-none focus:border-brand disabled:opacity-60";

export const labelCls = "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>;
}
