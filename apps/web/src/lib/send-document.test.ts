import { describe, expect, it, vi, beforeEach } from "vitest";

// A quotation is sent BEFORE it is agreed — the customer has to read a price to accept
// one. So sending a DRAFT quote issues it on the way out. These pin the gate that decides
// that: which documents may travel numberless, and on exactly what terms.

const issueDocument = vi.fn();
vi.mock("@/lib/supabase/rpc", () => ({ issueDocument: (...a: unknown[]) => issueDocument(...a) }));

import { sendDocument } from "./send-document";

type Row = Record<string, unknown> | null;

/** The slice of supabase-js sendDocument actually uses to load the document. */
function client(rows: Row[]) {
  const queue = [...rows];
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: queue.shift() ?? null }) }),
      }),
    }),
  } as never;
}

const draftQuote = {
  id: "doc-1", tenant_id: "t1", doc_type: "quote", number: null, status: "draft",
  total_incl: "1500.00", issue_date: null, customer_id: "c1", accepted_signature: null,
  customers: { name: "INTERGRAH LTEE" },
};

// Deliberately unsendable, so the run stops right after the gate: the recipient is
// validated AFTER the issue, which is exactly the seam we want to observe.
const send = (sb: never) =>
  sendDocument({ sb, docId: "doc-1", channel: "email", to: "not-an-email", origin: "https://x.test" });

describe("sendDocument — what may be sent without a number", () => {
  beforeEach(() => {
    issueDocument.mockClear();
    issueDocument.mockResolvedValue({ id: "doc-1", number: "A00124", status: "issued" });
  });

  it("issues a draft quotation on the way out, then sends it", async () => {
    issueDocument.mockResolvedValue({ id: "doc-1", number: "A00124", status: "issued" });
    const sb = client([draftQuote, { ...draftQuote, number: "A00124", status: "issued", issue_date: "2026-08-04" }]);

    const r = await send(sb);

    expect(issueDocument).toHaveBeenCalledTimes(1);
    // No stock location (a quote moves none) and NO SESSION — passing one would let a
    // stale till refuse a quotation. The key mirrors quote-accept:<id>, so a double-tap
    // replays instead of burning a second number.
    expect(issueDocument).toHaveBeenCalledWith(sb, "doc-1", null, "quote-send:doc-1", null);
    // Past the gate: it failed on the bad address, not on being a draft.
    expect(r).toEqual({ ok: false, error: "That email address doesn't look right." });
  });

  it("refuses a draft invoice — issuing one takes stock and files a sale", async () => {
    const r = await send(client([{ ...draftQuote, doc_type: "invoice" }]));

    expect(issueDocument).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: "This invoice is still a draft — issue it at the till first." });
  });

  it("calls a credit note a credit note", async () => {
    const r = await send(client([{ ...draftQuote, doc_type: "credit_note" }]));

    expect(issueDocument).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: "This credit note is still a draft — issue it at the till first." });
  });

  it("refuses a numberless quote that is no longer a draft", async () => {
    const r = await send(client([{ ...draftQuote, status: "void" }]));

    expect(issueDocument).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: "This quotation is void and can no longer be sent." });
  });

  it("leaves an already-issued document alone", async () => {
    const r = await send(client([{ ...draftQuote, number: "A00124", status: "issued" }]));

    expect(issueDocument).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: "That email address doesn't look right." });
  });

  it("does not send when the quote could not be issued", async () => {
    issueDocument.mockImplementation(() => { throw new Error("the day is closed"); });

    const r = await send(client([draftQuote]));

    expect(r).toEqual({ ok: false, error: "Couldn't issue this quotation to send it: the day is closed" });
  });

  it("reports nothing to send when the document is gone", async () => {
    const r = await send(client([null]));

    expect(r).toEqual({ ok: false, error: "Document not found." });
  });
});
