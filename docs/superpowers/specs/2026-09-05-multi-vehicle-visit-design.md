# One visit, several cars — web + Android

## Goal

Yogen drives in with three cars. Reception ticks all three in one intake pass,
quotes them on **one** quotation grouped by car, and — when he signs — the board
gets **three** job cards, one per car. At the end he pays **one** invoice, with a
subtotal per car and one grand total.

## Why it exists

Staff report the app makes them start over for every car: search the customer,
pick the car, mark the damage, hand off, then search the same customer again.
The records themselves were never the problem — a customer has always been able
to hold many vehicles ([ContactsScreen.kt][contacts], intake, the quote picker).
What is single is the **selection**: intake picks exactly one car
([IntakeScreen.kt:210][intake-pick]) and wipes its whole state on hand-off
([IntakeViewModel.kt:333][intake-reset]).

[contacts]: ../../../android/app/src/main/java/mu/carfection/pos/feature/contacts/ContactsScreen.kt
[intake-pick]: ../../../android/app/src/main/java/mu/carfection/pos/feature/intake/IntakeScreen.kt
[intake-reset]: ../../../android/app/src/main/java/mu/carfection/pos/feature/intake/IntakeViewModel.kt

## The rule everything follows

**A charge knows its car.** Attribution lives on the line, not in a heading, not
in a naming convention. Every grouped view — the builder, the A4, the tablet
slip, the job split — derives from that one column. Nothing re-states which car
a charge belongs to, so nothing can disagree about it.

## What a one-car document does

Nothing changes. A quote with one car keeps `documents.vehicle_id` set, prints
without any grouping chrome, converts through the existing
`convert_quote_to_job`, and reaches the till exactly as it does today. Grouping
appears only when a document covers **two or more** cars. This is the acceptance
test for the whole feature: the single-car path is byte-for-byte what it was.

## Data model

Four additive changes. No column is dropped, no existing column changes meaning.

### 1. `document_lines.vehicle_id uuid references vehicles(id)`

Nullable. Null means "not attributable to a car" — a retail product sold across
the counter, a call-out fee — and such lines print in an unheaded block at the
end, as they do now.

A line's vehicle must belong to the document's customer. Enforced in
`save_draft` (the only writer of builder lines), not as a table constraint: a
constraint would have to reach across three tables on every insert, and the
lines of an issued document are already frozen by `enforce_line_lock`.

### 2. `documents.vehicle_id` keeps its meaning, gains a rule

- Exactly one distinct car on the lines → `vehicle_id` = that car (today's
  behaviour, so every existing query keeps working).
- Two or more → `vehicle_id` is **null**, and the cars are read from the lines.

`save_draft` maintains this automatically, so no client has to remember it.
Readers that show "the vehicle" on a document must fall back to the line set
when the column is null.

### 3. `documents.intake` becomes per-car

Today: `{ markers: [...], photos: [...] }` — one car's condition.
New shape:

```json
{ "cars": [ { "vehicle_id": "…", "markers": [...], "photos": [...] } ] }
```

The old top-level shape is still read (a document written before this change,
or by an older tablet, is a one-car intake). Writers emit `cars`; readers accept
either. `app.intake_for_vehicle(intake jsonb, vehicle uuid)` is the single
helper that resolves both shapes, so no RPC re-implements the fallback.

### 4. `document_jobs(tenant_id, document_id, job_id)` junction

One invoice now covers three jobs, and `documents.job_id` holds one. Rather than
overload it, every job-linked document writes a row per job it covers —
**including single-job documents**, so the junction is a complete index and
readers never need a union.

`documents.job_id` is retained and still set (to the only job, or to the first
car's job on a multi-car document) so that today's guards — the "one live
invoice per job" check, the re-price path in `convert_quote_to_job` — keep
working untouched.

The jobs board's document lookup ([jobs.ts:152][jobs-query],
[job-docs.ts][job-docs]) switches to the junction. Without this, cars two and
three read as never invoiced.

[jobs-query]: ../../../apps/web/src/lib/supabase/queries/jobs.ts
[job-docs]: ../../../apps/web/src/features/jobs/job-docs.ts

### Index changes

`idx_jobs_source_quote` is unique on `source_quote_id` — one quote, one job
forever. It becomes unique on `(source_quote_id, vehicle_id)`: one job per car
per quote, which is what keeps the multi-car conversion idempotent under a
double-tap.

## RPCs

### `convert_quote_to_jobs(p_quote_id, p_technician_id, p_scheduled_at, p_signature)`

Returns `setof jobs`.

- **One car** (or `documents.vehicle_id` not null) → delegates to the existing
  `convert_quote_to_job` and returns its single row. The revision, re-price,
  deposit-carry and invoice-claim logic in that function is long, load-bearing
  and stays untouched.
- **Several cars** → issues and accepts the quote once (via `issue_document`,
  same gapless-number seam), then loops the distinct `document_lines.vehicle_id`
  in `sort_order` and creates one job per car, each stamped with **that car's**
  markers and photos from `intake.cars`, each linked by `source_quote_id`.
  `documents.job_id` = the first job. One `quote_converted_to_jobs` audit event
  carrying every job id.

Idempotent by the same means as today: the unique index makes a re-entry find
the existing jobs and return them.

**Multi-car revisions are out of scope for the first release** (see below); the
RPC raises a plain-language error if asked to convert a revision of a multi-car
quote, rather than half-applying the single-car re-price path to three jobs.

### `save_draft`

Accepts `vehicle_id` per line, derives `documents.vehicle_id` by the rule above,
rejects a line whose car is not the customer's, and preserves `intake.cars`
across autosaves the way it already preserves `intake`.

### `create_intake_quote` — takes cars, not a car

`p_vehicle_id` / `p_new_vehicle_plate` / `p_new_vehicle_make` / `p_markers` /
`p_photos` collapse into one `p_cars jsonb` array, each entry naming an existing
`vehicle_id` **or** a new plate + make, with that car's markers and photos. It
writes `intake.cars` and one draft line per car's service.

### Condition capture moves server-side

Today the tablet stamps markers and photos onto the job **after** conversion,
from memory, best-effort ([QuoteViewModel.kt:1617][stamp]) — because a quote
started from a tablet intake never persisted its condition record. Three cars
cannot ride a best-effort client loop: a dropped request would silently lose one
car's damage report.

So the tablet writes the condition to the draft (`intake.cars`, through
`save_draft`) at hand-off, and `convert_quote_to_jobs` does the stamping inside
the same transaction that creates the jobs. The client-side stamping loop is
deleted, not kept as a fallback — two writers of the same record is how they
drift. This also puts the tablet and the web on one path, and it fixes an
existing single-car hole: today a lost stamp request loses the damage report.

[stamp]: ../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteViewModel.kt

### `convert_quote_to_invoice`

Copies each line's `vehicle_id` to the invoice line, applies the same
`documents.vehicle_id` rule, and writes a `document_jobs` row per covered job.
Line copying is otherwise unchanged.

### Migration hygiene

`create_intake_quote` and `save_draft` change **signature**, and in Postgres
`create or replace` at a new argument list adds an overload instead of replacing
the function — leaving a stale one live for any caller that still matches it.
Each such migration therefore drops the old signature explicitly and ends with
an assertion that `pg_proc` holds exactly one row per function name.

## Clients

Parity is enforced at the RPC first; both UIs then render the same data. Neither
client computes grouping on its own terms.

### Tablet — intake ([IntakeScreen.kt][intake-screen], [IntakeViewModel.kt][intake-vm])

- `vehicle: VehicleDto?` → `picked: List<VehicleDto>`; the rows become
  tick-boxes; "+ Add vehicle" is unchanged and a newly saved car arrives ticked.
- The damage diagram gains a **plate tab strip** above it. Marks and photos are
  held per car (`Map<vehicleId, List<DamageMarker>>`, likewise photos), so
  `addPhoto` uploads against the car on the visible tab. No car is required to
  carry damage notes.
- `IntakeHandoff` carries `cars: List<HandoffCar>` (id, plate, label, markers,
  photos) instead of the flat vehicle fields.
- The summary line reads `Yogen · 3 cars · 5 damage notes`.

[intake-screen]: ../../../android/app/src/main/java/mu/carfection/pos/feature/intake/IntakeScreen.kt
[intake-vm]: ../../../android/app/src/main/java/mu/carfection/pos/feature/intake/IntakeViewModel.kt

### Tablet — quote builder ([QuoteViewModel.kt][quote-vm])

- A line carries `vehicleId`. Lines render under a plate heading in the order
  the cars were ticked, with a per-car subtotal.
- Adding a line attributes it to the car whose section is open; a line's car can
  be changed from the line editor.
- The customer/vehicle picker keeps single-select for a quote started from
  scratch, and gains "+ another car" which appends a section.

[quote-vm]: ../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteViewModel.kt

### Web

`IntakeFlow.tsx`, `DocumentBuilder.tsx` and `payload.ts` take the same three
changes: multi-select cars, per-car damage tabs, per-line vehicle. Same commit,
per the android↔web parity rule.

### Printed documents

`DocumentA4` gains an optional `vehicle` on `DocLineView` plus a grouped render:
a plate heading band, that car's lines, a per-car subtotal, then one grand
total. The tablet slip (`ReceiptText` / `ReceiptPaper`) and the web
`ReceiptCard` take the identical grouping in the same commit — receipt parity is
not a follow-up.

A document with one car (or none) renders exactly as before: no heading, no
per-car subtotal.

## Money surfaces that must be checked, not assumed

The invoice is an ordinary single invoice, so payment, till session, points,
sales journal and Z report see nothing new. That is the claim to **verify**, not
to assert: the release is not done until a multi-car invoice has been issued,
part-paid and settled against Postgres with a `BEGIN`/`ROLLBACK` probe, and the
sales journal and Z report reconciled against a single-car control.

VAT is unaffected — grouping changes presentation, never a line's
`unit_price`, `vat_rate` or the document totals. The per-car subtotal is a
**display** sum of `line_total_excl`, computed from the same rows the grand
total already sums, and the ex-VAT/VAT presentation rule for customer documents
is untouched.

## Testing

| Level | What it proves |
|---|---|
| SQL probe (`scripts/db-exec.mjs`, in a rolled-back txn) | 3-car quote → 3 jobs, each with its own markers/photos stamped **in the same txn**; a second call returns the same 3; single-car quote takes the delegated path and behaves identically; the legacy top-level `intake` shape still lands on its job |
| Kotlin unit | intake multi-select state, per-car marker/photo routing, handoff payload; line→car grouping and subtotals |
| Vitest | `payload.ts` round-trip with per-line vehicle, `job-docs` reading the junction, `DocumentA4` grouped vs ungrouped snapshots |
| Parity | the same 3-car fixture rendered by `DocumentA4`, `ReceiptCard` and the tablet `ReceiptText` produces the same groups, subtotals and total |
| Emulator | one real end-to-end pass on a test customer — never on a live one |

## Phases

1. **Data + RPCs** — migration, `save_draft`, `create_intake_quote`,
   `convert_quote_to_jobs`, `convert_quote_to_invoice`, junction; SQL probes
   green.
2. **Tablet intake** — multi-select, tabbed damage, handoff.
3. **Builders** — per-line car and grouping, tablet + web together.
4. **Print** — A4, web receipt, tablet slip, parity tests.

Each phase is shippable: after phase 1 nothing in the UI has changed; after
phase 2 a multi-car intake produces a quote whose lines are already attributed.

## Out of scope

- **Revising a multi-car quote.** The re-price path voids and re-raises the bill
  and carries deposits across; doing that for three jobs at once needs its own
  design. The RPC refuses it with a clear message.
- **Splitting one car's charges onto a separate bill after the fact.** One
  visit, one invoice.
- Selecting cars belonging to more than one customer on a single document.
- Per-car scheduling of the three jobs (all three land with the same
  `scheduled_at` and technician; the board can reassign them individually
  afterwards).
