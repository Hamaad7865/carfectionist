// Finding a car at the counter. She types a plate the way the customer says it
// ("mu 123 ab", "mu123ab"), a surname, a quote number, or half of all three —
// and the row has to come back. Pure functions so the rules are testable.

/** Everything about a job that someone might type to find it. */
export interface JobHaystack {
  ref: string; // JOB-8DD6
  plate: string | null;
  vehicle: string | null;
  customer: string | null;
  phone: string | null;
  service: string | null;
  technician: string | null;
  department: string | null;
  /**
   * EVERY document number on the job, not just the two on the card. A customer rings up
   * quoting the revised quote we sent them, or the invoice that was voided and reissued —
   * the row still has to come back, or the search silently lies about what it can find.
   */
  docNumbers: string[];
}

/** Strip everything but letters and digits: "MU 123-AB" and "mu123ab" become the same string. */
export const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function haystack(j: JobHaystack): { text: string; tight: string } {
  const text = [j.ref, j.plate, j.vehicle, j.customer, j.phone, j.service, j.technician, j.department, ...j.docNumbers]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return { text, tight: compact(text) };
}

/**
 * Every word must match something (AND, not OR) — "toyota anesh" finds Anesh's Toyota
 * and not every Toyota. Each word matches the text as typed, or its letters-and-digits
 * form, so a spaced plate and a run-together one both land.
 */
export function matches(hay: { text: string; tight: string }, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((t) => hay.text.includes(t) || (compact(t) !== "" && hay.tight.includes(compact(t))));
}
