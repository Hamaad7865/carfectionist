/**
 * Job card checklists. The tyre list is mirrored in the tablet's
 * android/.../core/network/TyreChecklist.kt — change both together.
 */
export type ChecklistItem = { label: string; done: boolean };

export const TYRE_CHECKLIST: ChecklistItem[] = [
  { label: "Tyres & wheels checked", done: false },
  { label: "Fitting / repair work", done: false },
  { label: "Wheel nuts torqued & pressures set", done: false },
  { label: "Final check & test", done: false },
];

/** The detailing default — also what the quote→job RPCs seed in SQL. */
export const DETAILING_CHECKLIST: ChecklistItem[] = [
  { label: "Intake photos & damage check", done: false },
  { label: "Wash & prep", done: false },
  { label: "Service work", done: false },
  { label: "Final inspection", done: false },
];

/**
 * Swap only an untouched checklist: empty, or the detailing default with nothing
 * ticked. The quote→job RPCs are idempotent (a re-tap returns the same job), so
 * this must never wipe work already done.
 */
export function shouldSwapForTyre(checklist: unknown): boolean {
  if (!Array.isArray(checklist)) return checklist == null;
  if (checklist.length === 0) return true;
  if (checklist.length !== DETAILING_CHECKLIST.length) return false;
  return checklist.every(
    (c, i) => c && typeof c === "object" && c.label === DETAILING_CHECKLIST[i].label && !c.done,
  );
}
