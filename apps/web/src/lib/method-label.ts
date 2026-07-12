// The Method column's single source of truth. Amounts are NETTED per method
// first, so a mistake + reversal pair vanishes: Juice +3,080 then Juice −3,080
// followed by a bank transfer reads "Bank", not "Split" (the owner's Cashmag
// expectation). "Split" is reserved for sales genuinely settled across
// several methods.
const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank" };

export function methodLabelFor(payments: { method: string; amount?: number | string | null }[]): string {
  const net = new Map<string, number>();
  for (const p of payments) net.set(p.method, (net.get(p.method) ?? 0) + Number(p.amount ?? 0));
  const methods = [...net.entries()].filter(([, amt]) => amt > 0.001).map(([m]) => m);
  return methods.length === 0 ? "—" : methods.length > 1 ? "Split" : (METHOD_LABEL[methods[0]] ?? methods[0]);
}
