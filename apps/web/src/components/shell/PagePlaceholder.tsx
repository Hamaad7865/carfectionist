import type { LucideIcon } from "lucide-react";

/** Consistent light "not built yet" panel for routes that arrive in later phases. */
export function PagePlaceholder({
  title,
  phase,
  description,
  icon: Icon,
}: {
  title: string;
  phase: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-[15px] border border-line bg-card p-8" style={{ boxShadow: "0 1px 2px rgba(15,23,32,.04)" }}>
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 place-items-center rounded-[12px] bg-[rgba(43,140,255,0.12)] text-link">
              <Icon size={20} />
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold text-ink-strong">{title}</h2>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{phase}</p>
            </div>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-muted">{description}</p>
        </div>
      </div>
    </div>
  );
}
