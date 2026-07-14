import { describe, it, expect } from "vitest";
import { compact, haystack, matches } from "./job-search";
import { pickDoc, pickQuote, liveInvoices, outstandingCents, toJobDoc, type RawDoc } from "./job-docs";

const job = haystack({
  ref: "JOB-8DD6",
  plate: "MU 123 AB",
  vehicle: "Toyota Vitz",
  customer: "ASG Car Wash Co Ltd",
  phone: "5794 1234",
  service: "Ceramic Glaze",
  technician: "Nikka",
  department: "Detailing",
  quoteNumber: "A00001",
  invoiceNumber: "INV-0016",
});

describe("job search", () => {
  it("finds by customer name, case-insensitively", () => {
    expect(matches(job, "asg")).toBe(true);
    expect(matches(job, "CAR WASH")).toBe(true);
  });

  it("finds a plate however it is spelled", () => {
    expect(matches(job, "MU 123 AB")).toBe(true);
    expect(matches(job, "mu123ab")).toBe(true);
    expect(matches(job, "mu-123-ab")).toBe(true);
    expect(matches(job, "123")).toBe(true);
  });

  it("finds by vehicle, technician, service and phone", () => {
    expect(matches(job, "vitz")).toBe(true);
    expect(matches(job, "nikka")).toBe(true);
    expect(matches(job, "ceramic")).toBe(true);
    expect(matches(job, "5794")).toBe(true);
  });

  it("finds by job ref, quote number and invoice number", () => {
    expect(matches(job, "8dd6")).toBe(true);
    expect(matches(job, "job-8dd6")).toBe(true);
    expect(matches(job, "A00001")).toBe(true);
    expect(matches(job, "inv-0016")).toBe(true);
    expect(matches(job, "inv0016")).toBe(true);
  });

  it("requires every word to match — not just one of them", () => {
    expect(matches(job, "toyota asg")).toBe(true);
    expect(matches(job, "toyota bhuruth")).toBe(false); // right car, wrong customer
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(matches(job, "")).toBe(true);
    expect(matches(job, "   ")).toBe(true);
  });

  it("misses what it should miss", () => {
    expect(matches(job, "porsche")).toBe(false);
  });

  it("ignores punctuation the customer would never type", () => {
    expect(compact("MU-123 AB")).toBe("mu123ab");
  });

  it("does not crash on a job with almost no data", () => {
    const bare = haystack({
      ref: "JOB-0001", plate: null, vehicle: null, customer: null, phone: null,
      service: null, technician: null, department: null, quoteNumber: null, invoiceNumber: null,
    });
    expect(matches(bare, "0001")).toBe(true);
    expect(matches(bare, "toyota")).toBe(false);
  });
});

// ── which document belongs on the row ────────────────────────────────────────
const doc = (o: Partial<RawDoc> & { doc_type: string; status: string; created_at: string }): RawDoc => ({
  id: o.id ?? crypto.randomUUID(),
  number: o.number ?? null,
  total_incl: o.total_incl ?? "0",
  amount_paid: o.amount_paid ?? "0",
  ...o,
});

describe("job documents", () => {
  it("never mistakes the quote (which also carries job_id) for the invoice", () => {
    const docs = [
      doc({ doc_type: "quote", status: "accepted", number: "A00001", created_at: "2026-07-01" }),
      doc({ doc_type: "invoice", status: "issued", number: "INV-0016", created_at: "2026-07-02" }),
    ];
    expect(pickDoc(docs, "invoice")?.number).toBe("INV-0016");
    expect(pickDoc(docs, "quote")?.number).toBe("A00001");
  });

  it("never shows a credit note as the invoice", () => {
    const docs = [doc({ doc_type: "credit_note", status: "issued", number: "CN-0001", created_at: "2026-07-03" })];
    expect(pickDoc(docs, "invoice")).toBeNull();
  });

  it("prefers the live invoice over a voided one, whatever the order", () => {
    const docs = [
      doc({ doc_type: "invoice", status: "issued", number: "INV-0020", created_at: "2026-07-05" }),
      doc({ doc_type: "invoice", status: "void", number: "INV-0019", created_at: "2026-07-06" }), // voided LATER
    ];
    expect(pickDoc(docs, "invoice")?.number).toBe("INV-0020");
  });

  it("takes the newest when several are live (a reissued invoice)", () => {
    const docs = [
      doc({ doc_type: "invoice", status: "issued", number: "INV-0020", created_at: "2026-07-05" }),
      doc({ doc_type: "invoice", status: "partly_paid", number: "INV-0021", created_at: "2026-07-07" }),
    ];
    expect(pickDoc(docs, "invoice")?.number).toBe("INV-0021");
  });

  it("still shows a void invoice rather than claiming the job was never billed", () => {
    const docs = [doc({ doc_type: "invoice", status: "void", number: "INV-0013", created_at: "2026-07-04" })];
    expect(pickDoc(docs, "invoice")?.number).toBe("INV-0013");
    expect(liveInvoices(docs)).toHaveLength(0);
    expect(outstandingCents(docs)).toBe(0); // a void invoice owes nothing
  });

  it("takes the newest quote when a quote was revised", () => {
    const docs = [
      doc({ doc_type: "quote", status: "declined", number: "A00001", created_at: "2026-07-01" }),
      doc({ doc_type: "quote", status: "accepted", number: "A00002", created_at: "2026-07-02" }),
    ];
    expect(pickDoc(docs, "quote")?.number).toBe("A00002");
  });

  // Seen in the live data: JOB-C40C was created from A00003, then A00006 was raised
  // against the same job. The job's quote is the one it was accepted from.
  it("shows the quote the job was created from, not a later one stamped with its job_id", () => {
    const docs = [
      doc({ id: "q3", doc_type: "quote", status: "accepted", number: "A00003", created_at: "2026-07-13T18:31:00Z" }),
      doc({ id: "q6", doc_type: "quote", status: "issued", number: "A00006", created_at: "2026-07-13T18:50:00Z" }),
    ];
    expect(pickQuote(docs, "q3")?.number).toBe("A00003");
  });

  it("falls back to the newest quote when the job records no source quote (a walk-in)", () => {
    const docs = [
      doc({ id: "q1", doc_type: "quote", status: "accepted", number: "A00001", created_at: "2026-07-01" }),
      doc({ id: "q2", doc_type: "quote", status: "issued", number: "A00002", created_at: "2026-07-02" }),
    ];
    expect(pickQuote(docs, null)?.number).toBe("A00002");
  });

  it("falls back gracefully if the source quote is missing from the fetched set", () => {
    const docs = [doc({ id: "q9", doc_type: "quote", status: "accepted", number: "A00009", created_at: "2026-07-01" })];
    expect(pickQuote(docs, "not-fetched")?.number).toBe("A00009");
    expect(pickQuote([], "not-fetched")).toBeNull();
  });

  it("owes money only on a live invoice — and never a negative amount", () => {
    expect(toJobDoc(doc({ doc_type: "invoice", status: "issued", total_incl: "1150.00", amount_paid: "500.00", created_at: "x" })).outstandingCents).toBe(65000);
    expect(toJobDoc(doc({ doc_type: "invoice", status: "paid", total_incl: "1150.00", amount_paid: "1150.00", created_at: "x" })).outstandingCents).toBe(0);
    expect(toJobDoc(doc({ doc_type: "invoice", status: "void", total_incl: "1150.00", amount_paid: "0", created_at: "x" })).outstandingCents).toBe(0);
    expect(toJobDoc(doc({ doc_type: "quote", status: "accepted", total_incl: "1150.00", amount_paid: "0", created_at: "x" })).outstandingCents).toBe(0);
    // overpaid (change given on a cash sale) must not read as a negative debt
    expect(toJobDoc(doc({ doc_type: "invoice", status: "partly_paid", total_incl: "100.00", amount_paid: "120.00", created_at: "x" })).outstandingCents).toBe(0);
  });

  it("sums what is owed across every live invoice, ignoring the voided one", () => {
    const docs = [
      doc({ doc_type: "invoice", status: "issued", total_incl: "1000.00", amount_paid: "0", created_at: "a" }),
      doc({ doc_type: "invoice", status: "partly_paid", total_incl: "500.00", amount_paid: "200.00", created_at: "b" }),
      doc({ doc_type: "invoice", status: "void", total_incl: "9999.00", amount_paid: "0", created_at: "c" }),
      doc({ doc_type: "quote", status: "accepted", total_incl: "7777.00", amount_paid: "0", created_at: "d" }),
    ];
    expect(outstandingCents(docs)).toBe(100000 + 30000);
  });

  it("keeps cents exact on the awkward numbers (77,200 / 11,580 / 88,780)", () => {
    expect(toJobDoc(doc({ doc_type: "invoice", status: "issued", total_incl: "887.80", amount_paid: "0", created_at: "x" })).totalCents).toBe(88780);
  });
});
