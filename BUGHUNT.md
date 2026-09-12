# Bug hunt — intake → quote → job → invoice (2026-09-12)

Read-only sweep, four angles: web flow, tablet flow, DB RPC logic, live-data
invariants. Status words: `[verified]` = confirmed against code/data by hand;
`[reported]` = strong file:line evidence. **All five criticals FIXED below —
code + migration in the working tree (uncommitted), C1's migration already
pushed live; web suite 702 green, tablet suite green, DB probes green,
eslint/tsc clean on touched files.**

Live-data backdrop (production `carfectionist`, SELECTs only): money core
holding — 0 double-billed quotes, 0 overpaid documents, 0 negative non-mirror
payments, 0 bad job statuses. 231 jobs (185 delivered, 37 cancelled).

## Critical

### C1. Re-price carries dead payments onto the new bill [verified] — FIXED by 20260910000050, proven by scripts/_verify-reprice-skips-reversed.mjs (PASS, rolled back)
`supabase/migrations/20260910000010_the_line_keeps_one_bill.sql:429-436` —
the deposit-carry `INSERT … SELECT` filters only `amount > 0 AND
reverses_payment_id IS NULL`, while the OUT-mirror loop just above correctly
skips already-reversed payments. Old bill had a payment reversed earlier
(partial refund) → re-pricing carries the dead positive onto the new bill
while `v_carried` excludes it → new bill overstates `amount_paid`, can flip to
`paid` early, customer undercharged. Same shape inherited in `20260905000020` /
`20260729000010` bodies.

### C2. Ready gate looks at one invoice, jobs can hold several [verified] — FIXED in JobCard.tsx (aggregate + per-bill handover)
`apps/web/src/features/jobs/JobCard.tsx:671` — `job.documents.find(d =>
invoice && status !== "void")`. With INV-1 paid + INV-2 issued-unpaid,
whichever row `find` hits first decides: paid-first offers *"Car collected —
mark delivered"* with debt outstanding; the reverse order blocks a fully-paid
job. Nothing sums across invoices here.

### C3. Job page is blind to pre-job invoices → double bill [verified] — FIXED in queries/jobs.ts (junction + quote-line bills merged)
`apps/web/src/lib/supabase/queries/jobs.ts:383-384`,
`JobCard.tsx:236,551-569` — `getJob`/`hasLiveDoc` only read
`documents.job_id = job.id`. An invoice raised via *Convert to invoice*
**before** the job exists carries `job_id = null`, so the job page shows zero
invoices and offers +Invoice again → second number, second stock relief, same
work. The normal counter order when billing precedes the bay.

### C4. Stock can leave twice — or never be billed [verified] — FIXED via getJobBilledLinesAction + warn-and-confirm in JobCard
`JobCard.tsx:632-663` + `jobs/actions.ts:375-402` vs
`documents/actions.ts:47-62` — *Complete job & consume stock* takes free-typed
consumptions with no invoice guard and no link to `document_lines`; issuing
separately relieves stock again. Consume 2× polish + invoice 2× polish =
4 units moved. Mirror image traps a job: complete with no invoice, then
*ready* demands an invoice that was never raised.

### C5. Collect-then-credit race on one bill [verified] — FIXED: credit button only on fully-paid invoices
`app/(app)/sales/[id]/page.tsx:123,132,195,654-668` — a `partly_paid` bill
shows *RecordPaymentForm* and *CreditNoteButton* together, while the
credit-note path is full-invoice one-shot. Collect the remainder and raise the
full credit note interleaved and money moves twice (refund of money only
partly taken).

## Major

### M1. Live documents stranded on cancelled jobs — 11 of them [verified in data]
57 documents point at cancelled jobs; **11 are live** (not draft/void),
including **paid invoices** (e.g. `INV-0153` paid → cancelled job) and accepted
quotes. The cancel/void saga retires drafts but leaves live money and live
quotes standing on dead jobs. Related: `void_quote`/`decline_quote` guards
(`20260729000020:41-46`, `20260804000050:59-64`) only match
`source_document_id = quote`, missing job-linked and revision bills while
over-blocking mere drafts.

### M2. Convert idempotency hands back dead/cancelled jobs [verified] — FIXED by 20260910000060 (cancelled excluded; vehicle-mismatch refuses), proven by scripts/_verify-major-fixes.mjs M2 (PASS, rolled back)
`convert_quote_to_job`: the `source_quote_id` lookup has no status filter and
returns **before** the draft/issued/accepted gate. Cancel job → void quote →
retry conversion returns the cancelled job instead of erroring;
declined/expired/void quotes with lingering rows never refuse.

### M3. Single-job return truncates multi-car results [downgraded to minor, NO FIX]
`convert_quote_to_job` delegates to `convert_quote_to_jobs` (all cars DO get
jobs) and returns only the first id — but every caller re-reads the full job
set afterwards (tablet `loadQuoteJobs`, board lists), so nothing is lost, only
one extra read. Cosmetic return shape; left alone deliberately.

### M4. Multi-car count changes lose cars [verified] — FIXED by 20260910000070 (full restatement: missing cars get jobs, stale cars refuse naming the card), proven M4a+M4b (PASS ×2 runs, rolled back). Follow-up 20260910000100: the probe caught the stale check being bypassed whenever one car remained (singular delegation) plus an unordered idempotent lookup (coin-toss job). Stale check now runs before delegation; singular lookup is oldest-first deterministic. Side finding: cancelling one car-job voids the shared source quote (cancel_job), which is why M4a probes via line-edits — recorded here, not changed.
`convert_quote_to_jobs` idempotency returns the old job set without
re-checking car count: accept with 1 car, edit lines to 3, re-accept → cars
2–3 silently get no jobs (and 3→1 orphans).

### M5. Billing across a revision line [probed three ways — guards hold, NO FIX]
Probed live: billing a superseded parent returns/creates only a draft;
billing the child over the parent's live bill is refused with the guard
message; billing the parent over the child's live bill hands back the child's
standing bill (the documented "hands back" behavior). No stale-price path
reproduced — the own-bill-first ordering is intentional. No change made.

### M6. Void/decline guards widened; line-definition note [verified] — FIXED by 20260910000080 (void_quote + decline_quote restated: job-linked/junction bills block, drafts never do; multi-car job cards covered). The deeper chain-vs-parents definitional split remains documented here as context. Proven M6a+M6b+M6c (PASS, rolled back). Pre-existing stranded rows (M1) need per-row owner sign-off — untouched.
`app.revision_chain` (source walk, copy-sensitive) drives guards;
`app.revision_parents` (revision_of walk) drives retirement. A plain **copy**
(same `source_document_id`, no `revision_of`) gets revising blocked by the
original's bill under one definition and ignored under the other. Compounded by
the `20260909000020:49-55` backfill stamping **every** historical quote→quote
link as `revision_of`.

### M7. Appointment conversion drops time and status [verified] — FIXED (web): non-scheduled/confirmed/arrived refused; scheduled_at carried via setJobScheduleAction (best-effort with warning, never fails the conversion).
`appointments/actions.ts:66-103` + `rpc.createJob` (no `scheduled_at` param):
converting checks only `job_id == null` — a cancelled/no-show appointment
converts into a live job, and the appointment time is dropped, so the job lands
unscheduled. (Same hardcoded-null pattern as the web quote→job path.)

### M8. Empty jobs creatable [verified] — FIXED (web): createSchema requires customer (id or name+phone) and vehicle (id or plate); form marks required + disables submit. RPC untouched.
`features/jobs/actions.ts:36-44` — every `createSchema` field optional, no
enabled-guard, unlike IntakeFlow which requires customer+vehicle. The orphan
then can't be invoiced (builder requires customer) or handed over on account.

### M9. Deposit vs "Add to bill" [reclassified — design tradeoff, mitigated, NO FIX]
Re-examined: once the deposit bill is ISSUED it is fiscally frozen, so extras
cannot legally join it — the counter sale is correct, not a bug. The confusion
it caused (handover/delivery blind to the second bill) is fixed where it
matters: the ready gate (C2) and deliver_paid_job (M15) now aggregate across
ALL live bills. Accept-with-deposit still issues immediately because a deposit
needs a bill to land in.
(The original symptom: after accept-with-deposit the card can never *Add to
bill* again. Kept deliberately — see above.)

### M10. CollectBus deposit dial expiry [verified] — FIXED (tablet): requests carry a timestamp, ignored-but-consumed after 4h (pure `isCollectRequestExpired`, tested).
`CollectBus.kt:26-28` — overwritten, latched until *any* Checkout visit
consumes it (`CounterViewModel.kt:1133-1135` consumes either way, so the blast
radius is one stray pad-open, not permanent). Still: a return-visit deposit
latched today fires on the next unrelated Checkout visit, and a second deposit
overwrites the first.

### M11. Collect bypasses TO COLLECT visibility rules [verified] — FIXED (tablet): pure `collectPadBlockReason()` mirrors the list rules; blocked latches set the error channel instead of opening the pad; latch still consumed. Tested.
`CounterViewModel.kt:1127-1131` fetches the latched bill raw; the
zero-balance/draft-hiding filters of `loadLists()` don't apply — a mid-service
draft opens the pad with `needsIssue`, issuing early against the
draft-until-ready design.

### M12. Points ride into the next customer's pad [verified] — FIXED (tablet): `collectOn` now resets points state (applied/picker/text); cart/customer untouched.
`collectOn()` (`CounterViewModel.kt:1070-1086`) resets tender/pay/ref/split but
**not** `pointsAppliedCents` — arm Rs 100 points on a walk-in, abandon for a TO
COLLECT bill, and the pad opens with Rs 100 applied to someone else's bill.

### M13. Accept-then-bill silently unbilled [verified] — FIXED (web): convert failure surfaces the error, no navigation; busy state resets.
`StartJobButton.tsx:50-63` / `QuoteAnswerButtons.tsx:41-53` — goods-only
accept issues+numbers the quote, then best-effort converts; on convert failure
it falls through to `router.refresh()` with no error. Accepted, numbered,
believed-billed — but no invoice.

### M14. Cash deposits have nowhere to go pre-issue [reported, design caveat]
Job-page PartPayment offers everything *except* cash (deliberate — "cash moves
a physical drawer"), but the sales page only pays issued bills. Cash left
before issue has no home.

### M15. deliver_paid_job reads the oldest non-void row, drafts included [verified] — FIXED by 20260910000090 (any issued/partly-paid bill blocks by name; paid required; drafts alone get "issue it first"), proven M15a+M15b (PASS, rolled back)
`20260906000010:238-245` — a leftover draft plus a paid bill raises "not
settled (status draft)" about the draft while money sits paid.

### M16. Booking mirror ignores RPC failure [verified] — FIXED (tablet): mirror follows confirmed writes only.
`QuoteViewModel.kt` accept-for-later: `runCatching { api.setQuoteBooking(...) }`
followed by an **unconditional** `_s.update` of `bookedForAt/bookedDepositCents`.
If the RPC fails, the tablet shows a date/deposit the server lacks, and
*Create job* then acts on the stale values — an a73c-class recurrence.

### M17. RecordPaymentForm never clamps to outstanding [verified] — FIXED (web): same over-warning + submit block as PartPayment.
`RecordPaymentForm.tsx:107-109` checks `>0`, tendered, reference — no clamp
(the job-page PartPayment has one). Downgraded from critical: the **server
clamps** (`amount ≤ outstanding`) and live data shows **zero** overpaid
documents — today this is a confusing server error, not wrong money.

## Minor / hygiene

- **m1. `undoOnAccount` dead UI [verified]** — was defined with zero importers; now wired as `UndoHandoverButton` (two-step confirm) on delivered-with-balance jobs. FIXED.
- **m2. Enquiry conversion drops vehicle/message [verified]** — now stashed into customer notes + convert errors surface. FIXED.
- **m3. Delivered footer pay path [verified]** — "Collect balance →" latches outstanding into Checkout (hint instead on quote-only tablets). FIXED.
- **m4. VAT label on gross shops [verified]** — dynamic label/hint from `pricesInclVat`. FIXED.
- **m5. Goods deferral [verified]** — goods accept-for-later raises a DRAFT only ("Billed on collection"); pad walk preserved for in-person paying tills. FIXED.
- **m6. `pendingBillOnOpen` latch scoping [verified]** — armed quote id travels with the flag; cleared on open-other/new/leave/failure. FIXED.
- **m7. Duplicate vs revision [verified, NO FIX]** — `duplicate_document` never writes `revision_of` (only `revise_quote` does), so `isRetired` already excludes copies; comment + sweep test added to pin it.
- **m8. Silent quote substitution [verified text]** — billing re-points to the
  "latest" quote via lexical `number DESC`; fragile if formats drift.
- **m9. Credit notes have no replay branch [reported]** — timeout retry meets
  "already has a credit note". Fails closed; robustness only.

## Live-data notes (read-only SELECTs)

- Money core holding: 0 double bills, 0 overpaids, 0 bad statuses.
- 8 delivered jobs show unpaid live invoices — but on-account handover is
  legitimate delivered-unpaid; needs audit-trail triage before calling it a bug.
- 32 negative on-hand groups — consistent with C4/oversell; needs a ruling on
  whether negative stock is ever legitimate.
- 9 of 10 open tills sit on past trading days — hygiene; the stale-till guard
  correctly blocks them, each needs a close.
- `appointments` table is empty (0 rows) — module ships, prod holds none.
- No live 9F23-trap rows remain.
