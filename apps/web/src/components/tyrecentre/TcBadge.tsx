import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ENTITY, entityVars } from "@/lib/tyrecentre/entity-colours";

export type TcBadgeTone = "attention" | "entity" | "danger" | "outline" | "neutral";

const TONE: Record<Exclude<TcBadgeTone, "entity">, string> = {
  attention: "bg-tc-highlight text-tc-on-highlight inset-ring-transparent",
  danger: "bg-tc-danger-soft text-tc-danger-ink inset-ring-transparent",
  outline: "bg-tc-card text-tc-body inset-ring-tc-line-2",
  neutral: "bg-tc-sub text-tc-muted inset-ring-transparent",
};

/** DESIGN-SPEC §5 status & company chips, on HextaUI's Badge. `entity` takes the
 *  company's colour set by its sort position. */
export function TcBadge({
  tone,
  entityIndex = 0,
  className = "",
  children,
}: {
  tone: TcBadgeTone;
  entityIndex?: number;
  className?: string;
  children: ReactNode;
}) {
  const style: CSSProperties | undefined =
    tone === "entity" ? entityVars(entityIndex) : undefined;
  return (
    <Badge
      appearance="outline"
      className={`h-[22px] rounded-[6px] px-2 text-[11.5px] font-semibold ${tone === "entity" ? `inset-ring-transparent ${ENTITY.soft} ${ENTITY.ink}` : TONE[tone]} ${className}`}
      style={style}
    >
      {children}
    </Badge>
  );
}
