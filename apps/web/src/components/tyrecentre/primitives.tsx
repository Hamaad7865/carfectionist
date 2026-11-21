"use client";

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ArrowKnob({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-tc-highlight text-tc-primary" style={{ width: size, height: size }}>
      <ArrowRight className="size-4" strokeWidth={2.4} />
    </span>
  );
}

/** Single-select pill segmented control on HextaUI's toggle-group. Never empties: a press on
 *  the selected option keeps it. `tone` picks white-on-white (header) or white-on-sub (cart). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  tone = "card",
  disabled,
  className = "",
  itemClassName = "",
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: ReactNode; disabled?: boolean }[];
  tone?: "card" | "sub";
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  label: string;
}) {
  const box =
    tone === "card"
      ? "rounded-full bg-white p-1 shadow-tc-card [&>[data-slot=toggle-group-indicator]]:bg-tc-sub"
      : "rounded-[14px] bg-tc-sub p-1 [&>[data-slot=toggle-group-indicator]]:bg-tc-card [&>[data-slot=toggle-group-indicator]]:shadow-[0_1px_2px_rgba(15,23,32,.08)]";
  const item =
    tone === "card"
      ? "h-8 rounded-full px-3.5 text-[13px] font-medium text-tc-muted data-pressed:font-semibold data-pressed:text-tc-ink"
      : "h-9 flex-1 gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-tc-muted data-pressed:font-semibold data-pressed:text-tc-ink [&_svg]:size-4";
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        const next = v[0] as V | undefined;
        if (next && next !== value) onChange(next);
      }}
      disabled={disabled}
      className={`${box} ${className}`}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} className={`${item} ${itemClassName}`}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
