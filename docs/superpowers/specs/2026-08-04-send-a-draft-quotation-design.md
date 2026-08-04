# Sending a draft quotation — the customer confirms, so the quote must reach them first

**Date:** 2026-08-04 · **Approved by:** owner (chat) · **Scope:** web back office + Android app (no DB change)

## Problem

A quotation exists to be argued with. The customer reads it, thinks, and comes back —
and only then is it accepted. So the send has to happen *before* acceptance.

Today it cannot. Every send on both surfaces funnels into `sendDocument()`
([send-document.ts:121](../../../apps/web/src/lib/send-document.ts)), which refuses
anything with no number:

```
This document is still a draft — issue or accept it first.
```

That refusal lands hardest on the tablet reception actually uses:

1. The **Send** chip renders for any saved quote, draft included
   ([QuoteScreen.kt:310](../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt)).
2. The tablet has no "Issue" action anywhere — the only forward move is **Accept**, which
   demands the customer's signature on the pad.
3. So a draft quote on the tablet is a dead end: a Send button that always fails, and an
   Accept button that asks for a signature the customer cannot give until they have seen
   the quote they are being asked to sign.

On web the same quote is merely awkward: the builder's only forward action is
`Issue quote`, and the Send button is hidden from every draft row.

## Decision

**Sending a draft quotation issues it on the way out.**

The status model already holds the state the owner is describing. `issued` means *quoted
to the customer, not yet agreed*; `accepted` means signed or billed. A billing migration
says so in as many words — *"signed beats merely sent"*
([20260715000005](../../../supabase/migrations/20260715000005_bill_a_sent_quote_too.sql)).
Nothing new needs inventing: the send just has to stop refusing to travel that road.

Acceptance is untouched. Sending never sets `accepted`. Only the signature pad and
`convert_quote_to_invoice` do that, exactly as today.

## Non-goals

- **Invoices and credit notes.** Issuing an invoice is a fiscal act: it allocates the
  fiscal number, deducts the goods off the shop floor and stamps the till session and
  trading day. That stays a deliberate action at the till. A draft invoice keeps today's
  refusal, reworded to name the right remedy.
- **A new `sent` status.** `issued` already carries the meaning. A new enum value would
  have to be taught to every status filter, guard, billing rule and report on both
  surfaces, and would buy nothing the existing status does not already say.
- **Sending a numberless draft.** The PDF header, the WhatsApp utility template (`{{3}}`
  is the document number) and the customer's ability to quote a reference back at us all
  need a number. A "DRAFT" placeholder would put a document in the customer's hands that
  names nothing.
- **Keeping a sent quote editable.** Issuing freezes it, by existing design — `save_draft`
  refuses an issued document. **Revise** already exists on both surfaces and is the
  sanctioned way to change a price the customer has seen.

## 1. The gate — one branch, in the one place both surfaces share

`sendDocument()` is the single choke point: the web send action, the web
schedule-for-later action, the tablet's `/api/documents/[id]/send` route and the
scheduled-send cron all pass through it. The refusal becomes a branch.

```ts
if (!d.number) {
  if (d.doc_type === "quote" && d.status === "draft") {
    // issue it on the way out, then carry on with the number it was given
  } else if (d.doc_type === "quote") {
    return { ok: false, error: "This quotation can no longer be sent." };
  } else {
    return { ok: false, error: "This invoice is still a draft — issue it at the till first." };
  }
}
```

The issue call is `issue_document(id, null, 'quote-send:<id>')`:

- **No stock location** — a quote moves no stock.
- **No session id** — deliberately. `issue_document` stamps `cash_session_id` and runs
  `assert_till_day_current` when given one, so passing the desk's till would let a stale
  till refuse a *quotation*. `convert_quote_to_job` issues its quote the same way, with
  `null` ([20260729000010](../../../supabase/migrations/20260729000010_accept_without_job.sql)).
- **`quote-send:<id>`** mirrors the existing `quote-accept:<id>`. The RPC takes an advisory
  lock on the key and replays from `idempotency_keys`, so a double-tap, a retried request
  or two operators sending at once all land on one number instead of burning two.

A closed trading day still refuses: issuing a quote passes through `app.assert_day_open`,
precisely as accepting one does today. That is existing behaviour, unchanged.

## 2. The send reports what it did

`SendDocumentResult` grows a field:

```ts
type SendDocumentResult =
  | { ok: true; issued?: { number: string; status: string } }
  | { ok: false; error: string };
```

Without this the tablet keeps `status = "draft"` in `QuoteState` after a send that issued
the quote server-side. The DRAFT chip stays up, the ref still reads "New quote", and every
edit control stays enabled while `save_draft` silently refuses each one — the quote frozen
on the server and no way to tell from the screen. The tablet applies the returned number
and status; web dispatches `issued` and refreshes.

The `/api/documents/[id]/send` route passes the field straight through.

## 3. What the operator sees

**Tablet** ([QuoteScreen.kt](../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt))

- The Send chip stops being gated on `quoteId != null` and is gated on having a customer
  instead. `sendToCustomer` saves the draft first when there is no id yet — exactly what
  `create()` (accept) already does, so Send and Accept behave alike from a fresh builder.
- The send dialog gains one line while the quote is a draft:
  *"Sending issues this quotation and locks the price — use Revise to change it."*
- Its subtitle stops naming a ref that does not exist yet ("Send Draft to the customer").

**Web**

- `DocumentBuilder` edit mode gains a `Send to customer` action beside `Issue quote`. It
  flushes the pending autosave through `doSave()` first, then opens the send sheet on the
  saved id.
- The documents list (`/sales`) and the detail page (`/sales/[id]`) drop the `number &&`
  gate for **draft quotes** — every other document keeps it.
- `SendDocumentDialog` shows the same one-line notice, driven by `SendContext` gaining
  `status` and `docType`.
- When a send comes back with `issued`, the builder dispatches `issued` and the page
  refreshes, so the toolbar switches from the draft's editor to the issued document's
  share bar without a manual reload.

## 4. Scheduling a draft quote

`deliverDocumentAction` carries its own copy of the same refusal
([actions.ts:293](../../../apps/web/src/features/documents/actions.ts)). Scheduling a draft
quote for later **issues it at schedule time**, not at fire time — so the document the
customer eventually receives is the one that was locked when the operator queued it, and
nobody can edit the quote out from under a send that is already promised.

## 5. Proving it

- **Android unit test** — a successful send on a draft applies the returned number and
  status, and `editable()` closes afterwards.
- **Web unit test** — the gate resolves: draft quote → issue, draft invoice → refuse with
  the till wording, issued document → send unchanged.
- **DB probe** under `BEGIN`/`ROLLBACK` against live-shaped data — `issue_document` on a
  draft quote with a `null` session returns a number and `issued`, and writes no
  `stock_movements` row. Client-side green proves nothing about what Postgres accepts.
- **Manual, on the emulator** — build a quote, save it, send by WhatsApp, confirm the
  number lands on the slip, the chip reads ISSUED, the editor is frozen, and the web back
  office shows the same document in the same state.

## Accepted cost

A quote sent and then abandoned burns a quote number. Accepting already behaves that way,
so the numbering stays consistent with itself.
