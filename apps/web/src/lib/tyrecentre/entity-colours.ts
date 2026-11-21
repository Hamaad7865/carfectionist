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
}

const SETS: EntityColours[] = [
  // Entity 1 — amber
  { accent: "#F5A623", soft: "#FFF2DB", tint: "#FFFBF2", border: "#F7E2B8", dash: "#EBD3A2", ink: "#9A6200", icon: "#C98200" },
  // Entity 2 — blue
  { accent: "#2B8CFF", soft: "#E6F1FF", tint: "#F5F9FF", border: "#CFE2FF", dash: "#BFD8FA", ink: "#1E6FE0", icon: "#1E6FE0" },
  // Further companies: a fixed palette in the same shape.
  { accent: "#0DA77C", soft: "#E1F6EF", tint: "#F4FCF9", border: "#BFE8DA", dash: "#A6DCC9", ink: "#087357", icon: "#0A8A67" },
  { accent: "#6A5CFF", soft: "#ECEAFF", tint: "#F7F6FF", border: "#D6D1FF", dash: "#C2BBFA", ink: "#4B3FD6", icon: "#5A4CF0" },
  { accent: "#D63B50", soft: "#FDECEE", tint: "#FFF7F8", border: "#F6CDD3", dash: "#ECB5BE", ink: "#B42339", icon: "#C42F45" },
];

export function entityColours(sortIndex: number): EntityColours {
  return SETS[((sortIndex % SETS.length) + SETS.length) % SETS.length];
}
