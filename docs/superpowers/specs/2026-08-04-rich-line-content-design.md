# A line item can say more than one sentence — rich content on every document line

**Date:** 2026-08-04 · **Approved by:** owner (chat) · **Scope:** DB + web back office + Android app

## Problem

The owner writes his real quotations in Refrens, not in this app, and the reason is one missing box.

A Carfectionist quote line reads *"Diamondbrite 3 YEARS PROTECTION Exterior only"* at
MUR 30,434.78. On its own that is a price with no justification. What sells it is the four
bullets underneath — full vehicle decontamination, paint correction, ceramic coating, plastic
treatment. Refrens lets him type them. We do not.

The maddening part is that almost all the plumbing already exists:

- `document_lines.description` is a real column
  ([core.sql:423](../../../supabase/migrations/20260704000001_core.sql)), it is saved, and it is
  printed — [DocumentA4.tsx:285](../../../apps/web/src/components/pdf/DocumentA4.tsx) renders it
  under the title with `white-space: pre-wrap` ([:167](../../../apps/web/src/components/pdf/DocumentA4.tsx)).
- The Sales detail screen prints it too
  ([sales/\[id\]/page.tsx:326](../../../apps/web/src/app/(app)/sales/[id]/page.tsx)).

The gap is that **nothing can write it**. Every line the builder creates is born with
`description: ""` ([DocumentBuilder.tsx:233](../../../apps/web/src/features/documents/builder/DocumentBuilder.tsx)
and [:395](../../../apps/web/src/features/documents/builder/DocumentBuilder.tsx)), and there is no
input bound to the field anywhere in the 665-line builder. The tablet is worse: `linesJson`
force-sends `put("description", JsonNull)` on **every line of every save**
([QuoteViewModel.kt:883](../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteViewModel.kt)).

That last one is not merely a gap, it is a loaded gun. `save_draft` deletes every line of the
document and re-inserts them from the payload
([document_comment.sql:92-108](../../../supabase/migrations/20260715000030_document_comment.sql)).
Today nothing is lost because nothing is ever written. **The moment web can author a description,
the next tablet save of that quote silently erases it.** Fixing the tablet is therefore part of
this step, not a follow-up.

Two more things the owner asked for land naturally on the same row: a **unit** beside the
quantity ("3 panels", "4 hrs"), and **reorder / duplicate / delete** row actions — Refrens has all
three and the builder has none of them.

## Decision

**A line carries a small, structured rich-content document — not a string of HTML.**

A new `document_lines.description_richtext jsonb` column holds a versioned tree restricted to
exactly what was agreed: paragraphs with bold / italic / strikethrough / link runs, bulleted
lists, numbered lists, and a flat table with no merged cells and no nesting. The existing
`description text` column stays, written on every save as the flat-text mirror of that tree, so
every renderer that reads it today keeps working untouched and every future plain-text consumer
(a WhatsApp caption, a CSV cell) has something to read without learning the tree.

The alternative — store the editor's HTML and render it with `dangerouslySetInnerHTML` — is
rejected on safety. `DocumentA4` is not only a PDF template. The same component renders into a
live, authenticated staff browser at
[print/doc/\[id\]/page.tsx:18](../../../apps/web/src/app/print/doc/[id]/page.tsx) and into the
builder's preview iframe ([DocumentBuilder.tsx:658](../../../apps/web/src/features/documents/builder/DocumentBuilder.tsx)).
Storing markup would make any line description a stored-XSS payload against every staff session
that opens the document, and the repo has no sanitiser to lean on — a grep of `apps/web` finds
`dangerouslySetInnerHTML` in exactly two places, both static
([DocumentA4.tsx:219](../../../apps/web/src/components/pdf/DocumentA4.tsx) injecting print CSS,
and the marketing preview bubble). A typed tree that a renderer walks, emitting only whitelisted
React elements, cannot carry a script no matter what is stored in it.

The tree is ProseMirror-shaped, because the editor that produces it is TipTap and that is what
`getJSON()` returns. Registering only the extensions we want is what keeps the schema small —
the shape is not invented, it is TipTap's, minus everything we did not ask for.

## Non-goals

- **Rich authoring on the tablet.** Compose has no contentEditable. A real inline rich editor
  means hand-tracking spans against a raw buffer, or embedding the app's first WebView, inside a
  screen that already carries a product grid, a signature pad and a payments handoff. The tablet
  **renders** everything the web can author and **authors** the subset that matters there —
  a title and plain bullet rows. Asymmetric on purpose; quotes are drafted at the desk and
  adjusted at reception.
- **Descriptions on the till slip.** Neither the web `ReceiptCard` nor the Android
  `ReceiptText`/`ReceiptPaper` prints a line description today — verified on both sides, and
  `ReceiptLine` has no such field at all
  ([Hardware.kt:59-72](../../../android/app/src/main/java/mu/carfection/pos/core/hardware/Hardware.kt)).
  They are already in parity on this point. Putting bullets on a thermal slip is a different,
  larger change and is not smuggled in here.
- **Images, groups, and customer-selectable option tiers.** Steps 2–4 of the agreed plan.
- **Real A4 pagination.** Documents deliberately render as one tall page
  ([render.ts:63-77](../../../apps/web/src/lib/pdf/render.ts)). A long bullet list grows that
  page; it does not need a page-break story it never had.

## 1. The shape

```ts
type Doc  = { schemaVersion: 1; blocks: Block[] };
type Block = Paragraph | BulletList | OrderedList | Table;
type Run   = { text: string; bold?: true; italic?: true; strike?: true; href?: string };
```

`schemaVersion` earns its place on day one. Three renderers walk this tree — React, Kotlin, and
the plain-text flattener — and this project's own history says that seam drifts. A version field
means a later node type cannot silently corrupt older rows on the platform that has not shipped yet.

**Every walker fails closed.** An unrecognised node is skipped, never thrown on. One malformed
row must not 500 the print page and the emailed PDF at the same time, and it would: both go
through the same component.

## 2. The migration

`20260804000020_lines_carry_rich_content.sql` — numbered `000020` deliberately, because
`20260804000010` is taken by the send-a-draft-quotation work in flight on `main`.

```sql
alter table public.document_lines
  add column if not exists description_richtext jsonb,
  add column if not exists unit_label text;
```

with the house `═` banner explaining why, `comment on column` for both, and two guards: a 24-char
ceiling on `unit_label`, and `pg_column_size(description_richtext) <= 20000` — generous for a
bulleted paragraph and cheap insurance against a pasted essay landing in a fiscal ledger row.

`save_draft` is reissued verbatim-plus-the-new-lines, the way
[document_comment.sql](../../../supabase/migrations/20260715000030_document_comment.sql) and
[stamp_credit_note_till_and_day.sql](../../../supabase/migrations/20260730000020_stamp_credit_note_till_and_day.sql)
describe themselves. One detail decides whether this works: the existing line insert extracts with
`nullif(l->>'description','')` — the **text** operator. The new column must use `l->'description_richtext'`,
the **object** operator. `->>` on a JSON object does not fail; it returns the serialised text, so
the mistake would land a stringified blob in a jsonb column and look fine until someone queried it.

No fiscal-lock change. `app.enforce_line_lock` forbids all line mutation on an issued
invoice or credit note ([core.sql:439-453](../../../supabase/migrations/20260704000001_core.sql));
adding a column does not widen that, and drafts are the only thing this feature writes.

## 3. One renderer, three call sites

A single `renderRichContent(doc)` walks the tree and returns React elements — `<strong>`, `<em>`,
`<s>`, `<a>`, `<ul>/<ol>/<li>`, `<table>/<tr>/<td>` and nothing else.

It must be shared, not reimplemented, because three surfaces show the same content and will drift
the moment they are written twice:

1. `DocumentA4` — reached by the print page, the preview iframe, and the server PDF.
2. The Sales detail screen ([sales/\[id\]/page.tsx:326](../../../apps/web/src/app/(app)/sales/[id]/page.tsx)).
3. The builder's own inline editor, which must look like the printed result.

`DocumentA4` is deliberately Tailwind-free — every element is styled from the inline `s` map, and
the only stylesheet is the `PRINT_CSS` string at
[:187-195](../../../apps/web/src/components/pdf/DocumentA4.tsx). The rich renderer follows that
rule exactly: inline styles merged the way `s.td`/`zebra` are merged, sized to sit inside the
existing 9.5px muted detail slot. A `<table>` inside a line needs its own
`page-break-inside: avoid` in `PRINT_CSS`; the existing rule only names `tr`.

## 4. The editor

TipTap v3 (`@tiptap/react` + a trimmed `starter-kit` — bold, italic, strike, bulletList,
orderedList, history — plus `extension-link` and `extension-table` with resizing and cell-merge
off). The "no merged cells, no nesting" constraint is TipTap's default posture, not something
suppressed after the fact.

The one genuinely new pattern: it must be mounted through
`next/dynamic(..., { ssr: false })`. `DocumentBuilder` is already `"use client"`, but Next 16
still server-renders client trees inside the Worker, and the Workers runtime has no DOM — TipTap
would throw on instantiation during that pass. **There is no `ssr: false` anywhere in `apps/web`
today**, so this is greenfield, and `next dev` will not catch getting it wrong. It gets verified
against an OpenNext preview build.

Pin versions only after confirming `@tiptap/react` v3 publishes a peer range covering
react 19.2.4 / next 16.2.10. v2 does not support React 19.

## 5. Unit, reorder, duplicate, delete

`unit_label` is a free-text input beside the qty stepper, printed as `3 panels` in the qty
column. Free text rather than an enum because `products.unit` is a fixed set that has no "panels"
and no "hrs", and inventing a second enum to hold the shop's vocabulary would be wrong twice.

Reorder, duplicate and delete need **no server work at all**. `sort_order` is already written
from the client array index ([payload.ts:79](../../../apps/web/src/features/documents/payload.ts))
and `save_draft` already replaces every line on every save, so reordering the array *is* the
persistence. Drag handle plus duplicate and delete in a rail beside the row, not hover-only icons
sitting on top of the printable content.

## 6. The tablet stops erasing what the desk wrote

Three changes, in order of importance:

1. **`linesJson` stops force-nulling.** It carries the line's existing `description` and
   `description_richtext` through untouched. Until this lands, every web-authored description is
   one tablet save away from deletion — the single most dangerous thing in this step.
2. `QuoteState`'s line model gains the two fields, a Kotlin `@Serializable` mirror of the tree
   (matching the DTO style in
   [Dtos.kt:71-75](../../../android/app/src/main/java/mu/carfection/pos/core/network/Dtos.kt)),
   and a Compose renderer — `AnnotatedString` for inline marks, a `Column` for list items, a
   `Row`/`Box` grid for the table.
3. Authoring on the tablet is a repeatable bullet-row editor, and the `AdhocDialog` field
   mislabelled "DESCRIPTION"
   ([QuoteScreen.kt:200](../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt))
   — which is actually the line's *title* — gets renamed to what it is.

`counter/actions.ts:91` also creates lines without a description. That path is a single-product
quick sale with no authoring surface, so it stays as it is — recorded here so the next person
does not have to rediscover that it was considered.

## 7. Proving it

- **Web unit tests** — the tree walker: every node type renders, an unknown node is skipped
  rather than thrown, and a `<script>`-shaped payload in a text run comes out as visible text.
  `payload.test.ts` and `toDocumentProps.test.ts` gain the real Diamondbrite four-bullet fixture,
  including the empty-rich-doc case, which is not the empty string.
- **`DocumentA4.test.tsx`** — no fixture sets `detail` today, so nothing pins current behaviour.
  Add both the plain-text case and the rich case.
- **A DB probe under `BEGIN`/`ROLLBACK`** against live-shaped data: `save_draft` with rich
  content round-trips as queryable `jsonb` and not as a stringified blob, and the flat-text
  mirror lands in `description`. Client-side green proves nothing about what Postgres accepts.
- **An OpenNext preview build**, not `next dev` — the editor must not execute during the Worker's
  SSR pass. This is the one failure `next dev` cannot show.
- **On the emulator** — author bullets on web, open the same quote on the tablet, save it from
  the tablet, and confirm the bullets are still there. That is the regression this step exists to
  prevent.

## Accepted cost

Six or so new client packages on a codebase that had none in this class, lazy-loaded and
client-only but real weight on the builder route. And a wire contract — the node and mark set —
that three renderers must agree on forever. Writing it down here is cheaper than reverse-engineering
it from TipTap's output in a year.
