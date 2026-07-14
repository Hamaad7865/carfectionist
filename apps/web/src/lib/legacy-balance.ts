import { rupeesToCents } from "@/lib/money/cents";

/**
 * The reset carried each customer's old Cashmag balance forward as a line in
 * `customers.notes`, deliberately NOT as a live invoice — so a statement built from
 * real documents would show these customers owing nothing. This reads that carried
 * figure back out so it can seed the statement's "Avant" (before) column.
 *
 * Two figures can appear, on one customer or both (e.g. KATONAH has both):
 *   "Solde débiteur: Rs -20485.00"  — a NEGATIVE value = the customer owes the shop.
 *   "Cagnotte (credit owed to customer): Rs 10500.00" — a POSITIVE value = store
 *                                        credit the shop owes THEM.
 *
 * Net carried receivable = what they owe − the credit they hold. Everything is in
 * integer cents, like the rest of the money code.
 */
export interface LegacyBalance {
  /** Carried debit — what the customer owed at the reset (≥ 0 for a normal debtor). */
  owedCents: number;
  /** Carried store credit the shop owes the customer (≥ 0 normally). */
  creditCents: number;
  /** owedCents − creditCents. Positive = net still owed to the shop. */
  netCents: number;
}

const SOLDE = /Solde\s+débiteur:\s*Rs\s*(-?[\d.,]+)/i;
const CAGNOTTE = /Cagnotte[^:]*:\s*Rs\s*(-?[\d.,]+)/i;

function amount(re: RegExp, notes: string): number | null {
  const m = re.exec(notes);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns the carried balance, or null when the note holds neither figure. A negative
 * "Solde débiteur" becomes a positive owedCents (the debit); a positive Cagnotte
 * becomes creditCents.
 */
export function parseLegacyBalance(notes: string | null | undefined): LegacyBalance | null {
  if (!notes) return null;
  const solde = amount(SOLDE, notes);
  const cagnotte = amount(CAGNOTTE, notes);
  if (solde == null && cagnotte == null) return null;

  // A negative solde means "owes"; flip its sign so a debtor reads as a positive debit.
  const owedCents = solde == null ? 0 : rupeesToCents(-solde);
  const creditCents = cagnotte == null ? 0 : rupeesToCents(cagnotte);
  return { owedCents, creditCents, netCents: owedCents - creditCents };
}
