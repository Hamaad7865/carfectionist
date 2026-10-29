import { describe, expect, it } from "vitest";
import { paidAheadBills } from "./job-docs";

// JOB-49B3 (27 Oct 2026): a perfume added through "Add to bill" and INV-0457 paid in full
// while the job still read "in progress". Paying does not hand back an unfinished job, so
// it sat there with the car gone. The card now names the paid bill and offers the handover
// — only when every issued bill on the job is paid.
const bill = (status: string, number = "INV-0457", docType = "invoice") => ({ docType, status, number });

describe("paidAheadBills", () => {
  it("an in-progress job with its bill paid is paid ahead", () => {
    expect(paidAheadBills("in_progress", [bill("paid")]).map((d) => d.number)).toEqual(["INV-0457"]);
  });

  it("a bill still owing is not", () => {
    expect(paidAheadBills("in_progress", [bill("issued")])).toEqual([]);
    expect(paidAheadBills("in_progress", [bill("partly_paid")])).toEqual([]);
  });

  it("one paid bill beside an unpaid one is not", () => {
    expect(paidAheadBills("in_progress", [bill("paid"), bill("issued", "INV-0460")])).toEqual([]);
  });

  it("drafts and voids neither count nor block", () => {
    const docs = [bill("void", "INV-0401"), bill("draft", "draft"), bill("paid")];
    expect(paidAheadBills("in_progress", docs).map((d) => d.number)).toEqual(["INV-0457"]);
    expect(paidAheadBills("in_progress", [bill("draft"), bill("void")])).toEqual([]);
  });

  it("a quote or credit note is not a bill", () => {
    expect(paidAheadBills("in_progress", [bill("accepted", "A00383", "quote")])).toEqual([]);
    expect(paidAheadBills("in_progress", [bill("issued", "CN-0001", "credit_note")])).toEqual([]);
  });

  it("only an in-progress job is offered the shortcut", () => {
    for (const st of ["scheduled", "ready", "delivered", "cancelled"]) {
      expect(paidAheadBills(st, [bill("paid")])).toEqual([]);
    }
  });
});
