// Damage marker types for the vehicle condition diagram (from the POS design).

export type MarkerType = "scratch" | "dent" | "chip" | "swirl";

export interface Marker {
  x: number; // % 0–100 across the diagram
  y: number; // % 0–100 down the diagram
  type: MarkerType;
  note?: string;
}

export const MARKER_TYPES: { type: MarkerType; label: string; letter: string; color: string }[] = [
  { type: "scratch", label: "Scratch", letter: "S", color: "#C17A00" },
  { type: "dent", label: "Dent", letter: "D", color: "#D63A3A" },
  { type: "chip", label: "Stone chip", letter: "C", color: "#5A67D8" },
  { type: "swirl", label: "Swirls", letter: "W", color: "#1FA361" },
];

export const markerMeta = (t: string) => MARKER_TYPES.find((m) => m.type === t) ?? MARKER_TYPES[0];
