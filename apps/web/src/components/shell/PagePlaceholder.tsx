import type { LucideIcon } from "lucide-react";

/** Consistent "not built yet" panel for routes that arrive in later phases. */
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
    <div className="p-8">
      <div className="mx-auto max-w-2xl">
        <div className="edge-hi rounded-xl border border-graphite-700 bg-graphite-900 p-8">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 place-items-center rounded-lg bg-graphite-850 text-teal">
              <Icon size={20} />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-graphite-100">{title}</h2>
              <p className="text-[11px] uppercase tracking-[0.15em] text-graphite-500">{phase}</p>
            </div>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-graphite-400">{description}</p>
        </div>
      </div>
    </div>
  );
}
