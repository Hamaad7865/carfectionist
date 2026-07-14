import { describe, expect, it } from "vitest";
import { parseLegacyBalance } from "./legacy-balance";

describe("parseLegacyBalance", () => {
  it("reads a plain debtor — a negative Solde débiteur is what they owe", () => {
    const b = parseLegacyBalance("Carried from Cashmag — Solde débiteur: Rs -5280.00 (Cashmag #7132498)");
    expect(b).toEqual({ owedCents: 528000, creditCents: 0, netCents: 528000 });
  });

  it("reads store credit — a positive Cagnotte is what the shop owes them", () => {
    const b = parseLegacyBalance("Carried from Cashmag — Cagnotte (credit owed to customer): Rs 350.00 (Cashmag #5290211)");
    expect(b).toEqual({ owedCents: 0, creditCents: 35000, netCents: -35000 });
  });

  it("nets a customer who both owes and holds credit (KATONAH)", () => {
    const b = parseLegacyBalance(
      "Carried from Cashmag — Solde débiteur: Rs -20485.00 (Cashmag #7712032) · " +
        "Carried from Cashmag — Cagnotte (credit owed to customer): Rs 10500.00 (Cashmag #7712032)",
    );
    expect(b?.owedCents).toBe(2048500);
    expect(b?.creditCents).toBe(1050000);
    expect(b?.netCents).toBe(998500);
  });

  it("keeps the decimals (742.50)", () => {
    const b = parseLegacyBalance("Solde débiteur: Rs -742.50 (Cashmag #7114817)");
    expect(b?.owedCents).toBe(74250);
  });

  it("returns null when the note carries no balance", () => {
    expect(parseLegacyBalance("Cashmag #12345")).toBeNull();
    expect(parseLegacyBalance("")).toBeNull();
    expect(parseLegacyBalance(null)).toBeNull();
  });
});
