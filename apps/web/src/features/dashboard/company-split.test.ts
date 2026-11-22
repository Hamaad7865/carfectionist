import { describe, expect, it } from "vitest";
import { splitByCompany } from "./company-split";

const tyres = { id: "co-tyre", name: "Garage De L'Est LTEE", isDefault: true, vatRegistered: true };
const service = { id: "co-svc", name: "Service", isDefault: false, vatRegistered: false };

describe("splitByCompany", () => {
  it("shows nothing for a one-company shop", () => {
    expect(splitByCompany([], [], [tyres])).toBeNull();
  });
  it("splits invoiced, outstanding, collected and count per company", () => {
    const docs = [
      { id: "i1", doc_type: "invoice", total_incl: "3450.00", amount_paid: "3450.00", source_document_id: null, legal_entity_id: "co-tyre" },
      { id: "i2", doc_type: "invoice", total_incl: "800.00", amount_paid: "300.00", source_document_id: null, legal_entity_id: "co-svc" },
      { id: "i3", doc_type: "invoice", total_incl: "100.00", amount_paid: "0", source_document_id: null, legal_entity_id: null },
      { id: "c1", doc_type: "credit_note", total_incl: "100.00", amount_paid: "0", source_document_id: "i3", legal_entity_id: null },
    ];
    const pays = [
      { amount: "3450.00", documents: { legal_entity_id: "co-tyre" } },
      { amount: "300.00", documents: { legal_entity_id: "co-svc" } },
    ];
    const [t, s] = splitByCompany(docs, pays, [tyres, service])!;
    // a bill with no company is the default company's; its credit note nets it to zero
    expect(t).toMatchObject({ invoicedCents: 345000, collectedCents: 345000, outstandingCents: 0, invoiceCount: 2 });
    expect(s).toMatchObject({ invoicedCents: 80000, collectedCents: 30000, outstandingCents: 50000, invoiceCount: 1 });
  });
});
