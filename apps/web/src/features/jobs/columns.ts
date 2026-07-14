// The four stages of a car's stay, in order — shared by the board, the list and
// the tablet. Kept free of any server import so client components can use it
// without dragging the Supabase server client (and next/headers) into the bundle.
export const JOB_COLUMNS = [
  { status: "scheduled", label: "Scheduled", dot: "#8c96a1" },
  { status: "in_progress", label: "In progress", dot: "#2b8cff" },
  { status: "ready", label: "Ready", dot: "#0da77c" },
  { status: "delivered", label: "Delivered", dot: "#6a5cff" },
] as const;
