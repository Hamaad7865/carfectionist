import type { CSSProperties } from "react";

/** An issuing company's colour set (DESIGN-SPEC §2). Assigned by the company's position in
 *  sort order — never by its name — so a new client's companies colour themselves. */
export interface EntityColours {
  accent: string;
  soft: string;
  /** Bill block background. */
  tint: string;
  border: string;
  /** Dashed dividers inside a bill: the border one step darker. */
  dash: string;
  ink: string;
  icon: string;
  /** Dark-mode counterparts: the accent as a glow on dark surfaces, the ink lifted to read. */
  dark: { soft: string; tint: string; border: string; dash: string; ink: string };
}

const glow = (rgb: string, ink: string) => ({
  soft: `rgba(${rgb}, 0.16)`,
  tint: `rgba(${rgb}, 0.06)`,
  border: `rgba(${rgb}, 0.24)`,
  dash: `rgba(${rgb}, 0.32)`,
  ink,
});

const SETS: EntityColours[] = [
  // Entity 1 — amber
  { accent: "#F5A623", soft: "#FFF2DB", tint: "#FFFBF2", border: "#F7E2B8", dash: "#EBD3A2", ink: "#9A6200", icon: "#C98200", dark: glow("245, 166, 35", "#F5C063") },
  // Entity 2 — blue
  { accent: "#2B8CFF", soft: "#E6F1FF", tint: "#F5F9FF", border: "#CFE2FF", dash: "#BFD8FA", ink: "#1E6FE0", icon: "#1E6FE0", dark: glow("43, 140, 255", "#79B8FF") },
  // Further companies: a fixed palette in the same shape.
  { accent: "#0DA77C", soft: "#E1F6EF", tint: "#F4FCF9", border: "#BFE8DA", dash: "#A6DCC9", ink: "#087357", icon: "#0A8A67", dark: glow("13, 167, 124", "#4FD1A5") },
  { accent: "#6A5CFF", soft: "#ECEAFF", tint: "#F7F6FF", border: "#D6D1FF", dash: "#C2BBFA", ink: "#4B3FD6", icon: "#5A4CF0", dark: glow("106, 92, 255", "#A99FFF") },
  { accent: "#D63B50", soft: "#FDECEE", tint: "#FFF7F8", border: "#F6CDD3", dash: "#ECB5BE", ink: "#B42339", icon: "#C42F45", dark: glow("214, 59, 80", "#F59AA7") },
];

export function entityColours(sortIndex: number): EntityColours {
  return SETS[((sortIndex % SETS.length) + SETS.length) % SETS.length];
}

/** The set as CSS variables, so classes can pick light or dark:
 *  `bg-[var(--e-tint)] dark:bg-[var(--e-tint-d)]`. */
export function entityVars(sortIndex: number): CSSProperties {
  const c = entityColours(sortIndex);
  return {
    "--e-accent": c.accent,
    "--e-soft": c.soft,
    "--e-tint": c.tint,
    "--e-border": c.border,
    "--e-dash": c.dash,
    "--e-ink": c.ink,
    "--e-icon": c.icon,
    "--e-soft-d": c.dark.soft,
    "--e-tint-d": c.dark.tint,
    "--e-border-d": c.dark.border,
    "--e-dash-d": c.dark.dash,
    "--e-ink-d": c.dark.ink,
  } as CSSProperties;
}

/** Ready-made class pairs over entityVars(). */
export const ENTITY = {
  tint: "bg-[var(--e-tint)] dark:bg-[var(--e-tint-d)]",
  border: "border-[var(--e-border)] dark:border-[var(--e-border-d)]",
  dash: "border-[var(--e-dash)] dark:border-[var(--e-dash-d)]",
  soft: "bg-[var(--e-soft)] dark:bg-[var(--e-soft-d)]",
  ink: "text-[var(--e-ink)] dark:text-[var(--e-ink-d)]",
  icon: "text-[var(--e-icon)] dark:text-[var(--e-ink-d)]",
} as const;
