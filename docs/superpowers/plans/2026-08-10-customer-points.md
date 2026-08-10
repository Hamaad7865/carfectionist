# Customer Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers earn points on what they spend and can pay with them later.

**Architecture:** An append-only `customer_points_ledger` is the truth; `customers.points_balance` is a trigger-maintained fast read. Earning is a flat rate on the sale total, computed once when an invoice is settled in full. Spending is a **tender**, not a discount — `payment_method` gains `points`, so the bill total and the VAT are untouched and points never collide with the service no-discount rule.

**Tech Stack:** PostgreSQL (Supabase) with plpgsql RPCs; Next.js 16.2.10 App Router + React 19 (`apps/web`); Kotlin/Compose (`android`); Vitest; `scripts/_verify-*.mjs` rolled-back probes.

**Spec:** `docs/superpowers/specs/2026-08-10-service-discounts-and-customer-points-design.md`

**Depends on:** nothing in `2026-08-10-service-discount-rules.md`. The two phases are independent and may be built in either order — points are deliberately a tender precisely so they do not touch the discount rules.

---

## Background an engineer needs before starting

**Why a tender and not a discount.** Redeeming points against a body polish would, as a discount, be a discount on a service — which rule 1 of the same brief forbids. As a tender it is money arriving by another route: `total_incl` and the VAT snapshot are unchanged, the fiscal core needs no edits, and the Z-report gains a line. This is the standard voucher treatment: revenue is recognised in full and the points liability is settled.

**Applying a migration — do NOT use `npm run db:push`.** It is broken repo-wide: 13 pairs of migration files share an identical timestamp prefix, which is the Supabase CLI's version and the primary key of `supabase_migrations.schema_migrations`. That table tracks 21 of the 108 files and is stuck at `20260710000001`, so the CLI re-applies from there and dies on a duplicate key. Apply one file at a time instead:

```bash
node scripts/db-exec.mjs supabase/migrations/<the file this task created>.sql
```

Leave the bookkeeping table alone — do not hand-write rows into `schema_migrations` to "catch it up". That is production state.

**`ALTER TYPE … ADD VALUE` needs its own migration file and its own run.** PostgreSQL will not let a newly added enum value be *used* in the transaction that adds it, and `db-exec.mjs` sends a whole file as one statement batch — one transaction. So Task 1 adds `points` to `payment_method` and does nothing else, and it must be applied and committed before any file that references `'points'` is run.

**Two tenants share this database:** `Carfectionist` (`1111…0001`, the real shop) and `Carfectionist Sandbox` (`2222…0002`). A query that forgets to scope by tenant double-counts. The probes impersonate the owner, so they scope themselves; ad-hoc queries must not forget.

**`record_payment` is the hook for both halves.** It already detects full settlement (`v_paid >= v_doc.total_incl`) — that is where earning belongs. It already branches on method for the cash/non-cash split — that is where spending belongs. Splice it; do not retype it (see `supabase/migrations/20260802000010_issue_document_replays_before_it_guards.sql` for what retyping cost last time).

**The Z-report needs no changes.** `app.z_totals` groups by `pm.method` dynamically (`20260715000040_ztotals_cashier_methods.sql:88`), so a new method appears in the means-of-payment split on its own. Task 7 verifies this rather than editing it.

**`expected_cash` sums only `method = 'cash'`,** so a points payment cannot distort a drawer count. Confirm, don't assume.

**Running things:** `node scripts/_verify-<name>.mjs` for probes (they roll back); `npm test --workspace web` for Vitest. Database scripts need the sandbox disabled. The owner's auth uid for probes is `0eb870dc-ef5b-400a-8744-859c999a1b1b`.

---

## File Structure

**Database — new migrations, applied in this order:**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260811000010_points_are_a_way_of_paying.sql` | `alter type payment_method add value 'points'` — **nothing else** |
| `supabase/migrations/20260811000020_a_customer_keeps_a_points_balance.sql` | ledger, balance column, trigger, the two rate settings |
| `supabase/migrations/20260811000030_a_settled_bill_earns_its_points.sql` | earning, spliced into `record_payment` |
| `supabase/migrations/20260811000040_points_can_settle_a_bill.sql` | spending, spliced into `record_payment` |
| `supabase/migrations/20260811000050_reversing_gives_the_points_back.sql` | unwinding, spliced into `reverse_payment` |

**Web:**

| File | Responsibility |
|---|---|
| `apps/web/src/lib/points.ts` (create) | earn/redeem arithmetic, mirroring the SQL |
| `apps/web/src/lib/points.test.ts` (create) | its unit tests |
| `apps/web/src/lib/method-label.ts` (modify) | a label for `points` |
| `apps/web/src/features/customers/PointsPanel.tsx` (create) | balance + ledger on the customer page |
| `apps/web/src/features/settings/*` (modify) | the two rate fields |
| the payment UI (modify) | a Points tender showing the balance |
| `apps/web/src/components/pdf/ReceiptCard.tsx` (modify) | points earned + balance |

**Android:**

| File | Responsibility |
|---|---|
| the payment pad (modify) | a Points tender |
| `android/app/src/main/java/mu/carfection/pos/core/hardware/Hardware.kt` (modify) | `ReceiptText` / `ReceiptPaper` points lines |

**Probe:** `scripts/_verify-points.mjs`.

---

## Task 1: Points become a way of paying

**Files:**
- Create: `supabase/migrations/20260811000010_points_are_a_way_of_paying.sql`

- [ ] **Step 1: Confirm the enum does not have it yet**

```bash
node scripts/q.mjs "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='payment_method' order by e.enumsortorder"
```

Expected: `cash`, `card`, `juice`, `bank_transfer` — and no `points`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260811000010_points_are_a_way_of_paying.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — points are a way of paying.
--
-- The owner's rule 4 (2026-08-10). Spending points is a TENDER, not a discount:
-- the bill total and the VAT snapshot are untouched, so a customer can put
-- points against a Rs 16,000 body polish without tripping the rule that says a
-- service is never discounted. Revenue is recognised in full and the points
-- liability is settled — the ordinary voucher treatment.
--
-- THIS FILE DOES NOTHING ELSE, ON PURPOSE. PostgreSQL refuses to let a newly
-- added enum value be USED in the transaction that added it, and each migration
-- file is pushed in its own transaction. Everything that writes 'points' lives
-- in a later file.
-- ═══════════════════════════════════════════════════════════════════════════

alter type payment_method add value if not exists 'points';
```

- [ ] **Step 3: Push and confirm**

```bash
node scripts/db-exec.mjs supabase/migrations/20260811000010_points_are_a_way_of_paying.sql && node scripts/q.mjs "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='payment_method' order by e.enumsortorder"
```

Expected: five labels, ending in `points`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260811000010_points_are_a_way_of_paying.sql
git commit -m "feat(points): points become a way of paying"
```

---

## Task 2: The ledger and the balance

**Files:**
- Create: `supabase/migrations/20260811000020_a_customer_keeps_a_points_balance.sql`
- Create: `scripts/_verify-points.mjs`

- [ ] **Step 1: Write the failing probe**

Create `scripts/_verify-points.mjs`:

```js
// Rolled-back verification for customer points.
//
// The ledger is the truth and customers.points_balance is only a fast read of it, so
// the first thing to prove is that the two cannot drift. Then: a settled bill earns
// once, points can settle a bill, an overdraft is refused, and reversing a payment
// gives the points back. Runs as `authenticated` impersonating the owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: AUTH, role: "authenticated" }),
  ]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;
  const customer = (await c.query(
    "insert into public.customers (tenant_id, name) values ($1,'Points probe') returning id", [tenant],
  )).rows[0].id;

  const balance = async () =>
    (await c.query("select points_balance from public.customers where id = $1", [customer])).rows[0].points_balance;

  console.log("▸ the balance follows the ledger");
  check("a new customer starts at nil", await balance(), 0);

  const add = (delta, reason) => c.query(
    "insert into public.customer_points_ledger (tenant_id, customer_id, delta, reason) values ($1,$2,$3,$4)",
    [tenant, customer, delta, reason],
  );
  await add(120, "earned");
  check("earning raises it", await balance(), 120);
  await add(-50, "redeemed");
  check("spending lowers it", await balance(), 70);

  console.log("▸ the ledger cannot be rewritten");
  let msg = "allowed";
  try {
    await c.query("savepoint l");
    await c.query("update public.customer_points_ledger set delta = 9999 where customer_id = $1", [customer]);
  } catch (e) { msg = e.message; }
  await c.query("rollback to savepoint l");
  check("an update is refused", msg !== "allowed", true);

  console.log("▸ the rates are settings, not constants");
  const bs = (await c.query(
    "select points_per_100, point_value_rupees from public.business_settings where id = $1", [tenant],
  )).rows[0];
  check("points_per_100 defaults to 1", Number(bs.points_per_100), 1);
  check("a point is worth Rs 1", Number(bs.point_value_rupees), 1);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-points.mjs
```

Expected: an error — `column "points_balance" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811000020_a_customer_keeps_a_points_balance.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a customer keeps a points balance.
--
-- The ledger is the truth; customers.points_balance is a cached read of it, kept
-- by trigger. A balance stored on its own would eventually disagree with the
-- history and there would be no way to tell which was right — so every movement
-- is a row, and the column is only ever derived from one.
--
-- Append-only, like every other ledger here: app.forbid_mutation refuses an
-- UPDATE or a DELETE outright rather than trusting callers to be careful.
--
-- One shop-wide earn rate, not a table keyed on category: the owner's call on
-- 2026-08-10 is that earning follows the total price of a sale, not what
-- happened to be on it. A cashier can answer "how many points is that?" from the
-- total already on the screen.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_points_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.business_settings(id),
  customer_id uuid not null references public.customers(id),
  delta       integer not null,
  reason      text not null check (reason in ('earned','redeemed','adjusted','reversed')),
  ref_type    text,
  ref_id      uuid,
  note        text,
  created_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_points_ledger_customer
  on public.customer_points_ledger (tenant_id, customer_id, created_at desc);
-- One earn row per invoice. This is what makes earning idempotent under the
-- part-payment that finally settles a bill, and under an offline sale replaying.
create unique index if not exists idx_points_ledger_one_earn_per_doc
  on public.customer_points_ledger (ref_id) where reason = 'earned' and ref_type = 'document';

comment on table public.customer_points_ledger is
  'Every points movement, append-only. customers.points_balance is derived from this and never written directly.';

drop trigger if exists trg_points_ledger_immutable on public.customer_points_ledger;
create trigger trg_points_ledger_immutable
  before update or delete on public.customer_points_ledger
  for each row execute function app.forbid_mutation();

alter table public.customers
  add column if not exists points_balance integer not null default 0;

alter table public.business_settings
  add column if not exists points_per_100      numeric(12,2) not null default 1
    check (points_per_100 >= 0),
  add column if not exists point_value_rupees  numeric(12,2) not null default 1.00
    check (point_value_rupees > 0);

comment on column public.business_settings.points_per_100 is
  'Points earned per Rs 100 of a settled sale.';
comment on column public.business_settings.point_value_rupees is
  'What one point is worth when it is spent.';

create or replace function app.apply_points_delta() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.customers
     set points_balance = points_balance + new.delta
   where id = new.customer_id;
  return null;
end $$;

drop trigger if exists trg_points_balance on public.customer_points_ledger;
create trigger trg_points_balance after insert on public.customer_points_ledger
  for each row execute function app.apply_points_delta();

alter table public.customer_points_ledger enable row level security;
drop policy if exists points_ledger_read on public.customer_points_ledger;
create policy points_ledger_read on public.customer_points_ledger
  for select using (tenant_id = app.current_tenant_id());
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260811000020_a_customer_keeps_a_points_balance.sql && node scripts/_verify-points.mjs
```

Expected: every check `✓`, exit 0.

> The probe inserts into the ledger directly. That is deliberate for this task — the
> RPCs that will own those inserts arrive in Tasks 3 and 4, and proving the trigger in
> isolation first means a later failure points at the RPC, not the plumbing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811000020_a_customer_keeps_a_points_balance.sql scripts/_verify-points.mjs
git commit -m "feat(points): a customer keeps a points balance"
```

---

## Task 3: A settled bill earns its points

**Files:**
- Create: `supabase/migrations/20260811000030_a_settled_bill_earns_its_points.sql`
- Modify: `scripts/_verify-points.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-points.mjs`, insert before the closing `} finally {`:

```js
  console.log("▸ a settled bill earns, once");
  // Build and issue a Rs 1,150-inclusive invoice for the probe customer.
  const till = (await c.query(
    "select id from public.cash_sessions where tenant_id = $1 and status='open' order by opened_at desc limit 1", [tenant],
  )).rows[0];
  if (!till) {
    console.log("  – no open till; earning cannot be exercised. SKIPPED");
  } else {
    const inv = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({
        id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null, template_id: null,
        template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
        discount_kind: null, discount_value: 0,
      }),
      JSON.stringify([{
        product_id: null, title: "Probe wash", description: null, qty: 1, unit_price: 1000,
        discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
        sort_order: 0, line_kind: "service",
      }]),
    ])).rows[0];
    const issued = (await c.query(
      "select * from public.issue_document($1::uuid, null, null, $2::uuid)", [inv.id, till.id],
    )).rows[0];
    check("the bill is Rs 1,150", Number(issued.total_incl), 1150);

    const before = await balance();
    await c.query(
      "select public.record_payment($1::uuid,'cash',$2,$2,null,$3::uuid,null,null)",
      [inv.id, 1150, till.id],
    );
    check("Rs 1,150 at 1 point per Rs 100 earns 11", (await balance()) - before, 11);

    const earnRows = (await c.query(
      "select count(*) n from public.customer_points_ledger where reason='earned' and ref_id=$1", [inv.id],
    )).rows[0].n;
    check("exactly one earn row", earnRows, "1");

    console.log("▸ an unnamed customer earns nothing");
    // (documents without customer_id cannot be invoices, so this is covered by the
    //  invoice-requires-a-customer guard in issue_document — asserted here for the record)
    const guard = (await c.query(
      `select position('an invoice requires a customer' in pg_get_functiondef(p.oid)) > 0 as ok
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='issue_document'`,
    )).rows[0].ok;
    check("an invoice must name a customer", guard, true);
  }
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-points.mjs
```

Expected: `✗ Rs 1,150 at 1 point per Rs 100 earns 11: got 0 (want 11)`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811000030_a_settled_bill_earns_its_points.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a settled bill earns its points.
--
-- Earning follows the TOTAL PRICE OF A SALE (the owner's call, 2026-08-10), at
-- one shop-wide rate. total_incl is already net of every discount, so a
-- discounted sale earns on what the customer actually paid.
--
-- It fires when the bill is settled IN FULL, not on each part payment: a bill
-- paid in three instalments should earn once, for its total, and floor()ing
-- three fragments would quietly lose points to rounding.
--
-- The share settled WITH POINTS earns nothing. Without that, a customer pays
-- with points, earns on the same money, and tops themselves up forever.
--
-- Idempotence is the unique index on (ref_id) where reason='earned', not a
-- lookup-then-insert: an offline sale replaying and a retried part payment both
-- arrive here, and a race between two of them would otherwise double-credit.
--
-- Spliced into record_payment rather than retyped — that function has been
-- rebuilt by six migrations and the live body is the only trustworthy source.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.award_points_for_invoice(p_invoice uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_doc    public.documents;
  v_rate   numeric;
  v_points numeric;
  v_pts_paid numeric;
begin
  select * into v_doc from public.documents where id = p_invoice;
  if not found or v_doc.customer_id is null then return; end if;
  if v_doc.total_incl <= 0 then return; end if;

  select points_per_100 into v_rate from public.business_settings where id = v_doc.tenant_id;
  if coalesce(v_rate, 0) <= 0 then return; end if;

  select coalesce(sum(amount), 0) into v_pts_paid
    from public.payments where document_id = p_invoice and method = 'points';

  v_points := floor(greatest(v_doc.total_incl - v_pts_paid, 0) / 100.0 * v_rate);
  if v_points < 1 then return; end if;

  -- The unique index is the arbiter; a concurrent replay loses the race quietly.
  insert into public.customer_points_ledger
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, v_points::int, 'earned', 'document', p_invoice,
     app.current_app_user_id())
  on conflict do nothing;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('award_points_for_invoice' in v_def) > 0 then return; end if;

  -- Anchor on the full-settlement branch that already exists for job delivery.
  if position('if v_paid >= v_doc.total_incl and v_doc.job_id is not null then' in v_def) = 0 then
    raise exception 'record_payment: settlement anchor not found — earning was NOT installed';
  end if;

  v_def := replace(
    v_def,
    'if v_paid >= v_doc.total_incl and v_doc.job_id is not null then',
    '-- Settled in full: the sale earns its points, once. See 20260811000030.
  if v_paid >= v_doc.total_incl then
    perform app.award_points_for_invoice(p_invoice_id);
  end if;

  if v_paid >= v_doc.total_incl and v_doc.job_id is not null then'
  );

  execute v_def;
end $$;

do $$
begin
  if (select position('award_points_for_invoice' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_payment') then
    raise exception 'record_payment never learned to award points';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260811000030_a_settled_bill_earns_its_points.sql && node scripts/_verify-points.mjs
```

Expected: every check `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811000030_a_settled_bill_earns_its_points.sql scripts/_verify-points.mjs
git commit -m "feat(points): a settled bill earns its points"
```

---

## Task 4: Points can settle a bill

**Files:**
- Create: `supabase/migrations/20260811000040_points_can_settle_a_bill.sql`
- Modify: `scripts/_verify-points.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-points.mjs`, inside the `if (till)` block, after the earning checks:

```js
    console.log("▸ points can settle a bill");
    const inv2 = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({
        id: null, doc_type: "invoice", customer_id: customer, vehicle_id: null, template_id: null,
        template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
        discount_kind: null, discount_value: 0,
      }),
      JSON.stringify([{
        product_id: null, title: "Probe wash 2", description: null, qty: 1, unit_price: 1000,
        discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
        sort_order: 0, line_kind: "service",
      }]),
    ])).rows[0];
    await c.query("select public.issue_document($1::uuid, null, null, $2::uuid)", [inv2.id, till.id]);

    const beforeSpend = await balance();
    await c.query(
      "select public.record_payment($1::uuid,'points',$2,null,null,$3::uuid,null,null)",
      [inv2.id, 50, till.id],
    );
    check("Rs 50 of points costs 50 points", beforeSpend - (await balance()), 50);

    const doc2 = (await c.query("select total_incl, amount_paid, status from public.documents where id=$1", [inv2.id])).rows[0];
    check("the bill total is untouched by the tender", Number(doc2.total_incl), 1150);
    check("it counts as money received", Number(doc2.amount_paid), 50);

    console.log("▸ what spending refuses");
    let over = "allowed";
    try {
      await c.query("savepoint p");
      await c.query("select public.record_payment($1::uuid,'points',$2,null,null,$3::uuid,null,null)",
        [inv2.id, 999999, till.id]);
    } catch (e) { over = e.message; }
    await c.query("rollback to savepoint p");
    check("an overdraft is refused", over.includes("not enough points"), true);

    console.log("▸ the drawer is unaffected by a points payment");
    const drawer = (await c.query(
      `select coalesce(sum(amount),0) c from public.payments
        where cash_session_id = $1 and method = 'cash'`, [till.id],
    )).rows[0].c;
    const drawerAll = (await c.query(
      `select coalesce(sum(amount),0) c from public.payments where cash_session_id = $1`, [till.id],
    )).rows[0].c;
    check("cash and all-methods differ, so points are not counted as cash", drawer !== drawerAll, true);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-points.mjs
```

Expected: an error from `record_payment` — a `points` payment requires an external reference (the non-cash branch demands one today).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811000040_points_can_settle_a_bill.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — points can settle a bill.
--
-- A tender, not a discount: total_incl and the VAT snapshot do not move, so
-- points may be spent on a service that rule 1 says is never discounted, and the
-- fiscal core needs no changes at all.
--
-- record_payment's existing else-branch demands an external reference for every
-- non-cash method, which is right for card, Juice and a bank transfer and wrong
-- for points — the reference IS the ledger row. So points get their own branch
-- ahead of it.
--
-- It still lands on an open till, like every other method. A payment booked to
-- no session shows on no Z-report ever (see 20260716000040), and points are real
-- settlement — the shop needs to see them on the cash-up.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.spend_points(p_invoice uuid, p_amount numeric) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_doc    public.documents;
  v_value  numeric;
  v_needed int;
  v_have   int;
begin
  select * into v_doc from public.documents where id = p_invoice;
  if v_doc.customer_id is null then
    raise exception 'a points payment needs a customer on the bill';
  end if;

  select point_value_rupees into v_value from public.business_settings where id = v_doc.tenant_id;
  if coalesce(v_value, 0) <= 0 then raise exception 'points have no value set'; end if;

  v_needed := ceil(p_amount / v_value)::int;

  select points_balance into v_have from public.customers
   where id = v_doc.customer_id for update;
  if coalesce(v_have, 0) < v_needed then
    raise exception 'not enough points: % needed, % available', v_needed, coalesce(v_have, 0);
  end if;

  insert into public.customer_points_ledger
    (tenant_id, customer_id, delta, reason, ref_type, ref_id, created_by)
  values
    (v_doc.tenant_id, v_doc.customer_id, -v_needed, 'redeemed', 'document', p_invoice,
     app.current_app_user_id());
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_def is null then raise exception 'public.record_payment not found'; end if;
  if position('spend_points' in v_def) > 0 then return; end if;

  if position('if p_method = ''cash'' then' in v_def) = 0 then
    raise exception 'record_payment: method-branch anchor not found — spending was NOT installed';
  end if;

  v_def := replace(
    v_def,
    'if p_method = ''cash'' then',
    'if p_method = ''points'' then
    -- The ledger row IS the reference; the else-branch below wants an external
    -- one, which only makes sense for card, Juice and a bank transfer.
    perform app.spend_points(p_invoice_id, p_amount);
    p_tendered := null; v_change := null;
  elsif p_method = ''cash'' then'
  );

  execute v_def;
end $$;

do $$
begin
  if (select position('spend_points' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_payment') then
    raise exception 'record_payment never learned to spend points';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260811000040_points_can_settle_a_bill.sql && node scripts/_verify-points.mjs
```

Expected: every check `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811000040_points_can_settle_a_bill.sql scripts/_verify-points.mjs
git commit -m "feat(points): points can settle a bill"
```

---

## Task 5: Reversing gives the points back

**Files:**
- Create: `supabase/migrations/20260811000050_reversing_gives_the_points_back.sql`
- Modify: `scripts/_verify-points.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-points.mjs`, inside the `if (till)` block, after the spending checks:

```js
    console.log("▸ reversing a payment unwinds what it did");
    const spend = (await c.query(
      "select id from public.payments where document_id=$1 and method='points' order by created_at desc limit 1", [inv2.id],
    )).rows[0].id;
    const beforeRev = await balance();
    await c.query("select public.reverse_payment($1::uuid, 'probe reversal')", [spend]);
    check("spent points come back", (await balance()) - beforeRev, 50);

    // inv1 was settled in full and earned 11; reversing its cash drops it below full.
    const cashPay = (await c.query(
      "select id from public.payments where document_id=$1 and method='cash' and amount>0 order by created_at desc limit 1", [inv.id],
    )).rows[0].id;
    const beforeUnearn = await balance();
    await c.query("select public.reverse_payment($1::uuid, 'probe reversal')", [cashPay]);
    check("an unsettled bill gives its earned points back", beforeUnearn - (await balance()), 11);
```

> If Phase A (`2026-08-10-service-discount-rules.md`) has already landed, `reverse_payment`
> is owner-only — the probe impersonates the owner, so it still passes.

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-points.mjs
```

Expected: `✗ spent points come back: got 0 (want 50)`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811000050_reversing_gives_the_points_back.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — reversing a payment unwinds what it did to the points.
--
-- Two directions, both needed:
--   • Reversing a POINTS payment gives the points back — the customer paid with
--     them and the payment is being undone.
--   • Reversing any payment that drops a bill BELOW settled takes back what that
--     settlement earned. Without it, paying and un-paying is a points printer.
--
-- The earn row cannot be deleted (the ledger is append-only, by trigger), so the
-- unwind is a compensating 'reversed' row. The history keeps saying what
-- happened, which is the point of a ledger.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.unwind_points_for_payment(p_payment uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_pay   public.payments;
  v_doc   public.documents;
  v_paid  numeric;
  v_spent int;
  v_earned int;
begin
  select * into v_pay from public.payments where id = p_payment;
  if not found then return; end if;
  select * into v_doc from public.documents where id = v_pay.document_id;
  if v_doc.customer_id is null then return; end if;

  -- 1. a reversed points payment returns exactly what it took
  if v_pay.method = 'points' then
    select coalesce(-sum(delta), 0) into v_spent
      from public.customer_points_ledger
     where ref_type = 'document' and ref_id = v_doc.id and reason = 'redeemed';
    if v_spent > 0 and not exists (
      select 1 from public.customer_points_ledger
       where ref_type = 'payment' and ref_id = p_payment and reason = 'reversed'
    ) then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, v_spent, 'reversed', 'payment', p_payment,
              'points returned on a reversed payment', app.current_app_user_id());
    end if;
  end if;

  -- 2. a bill that is no longer settled un-earns
  select coalesce(sum(amount), 0) into v_paid from public.payments where document_id = v_doc.id;
  if v_paid < v_doc.total_incl then
    select coalesce(sum(delta), 0) into v_earned
      from public.customer_points_ledger
     where ref_type = 'document' and ref_id = v_doc.id and reason = 'earned';
    if v_earned > 0 and not exists (
      select 1 from public.customer_points_ledger
       where ref_type = 'document' and ref_id = v_doc.id and reason = 'reversed'
    ) then
      insert into public.customer_points_ledger
        (tenant_id, customer_id, delta, reason, ref_type, ref_id, note, created_by)
      values (v_doc.tenant_id, v_doc.customer_id, -v_earned, 'reversed', 'document', v_doc.id,
              'the bill is no longer settled in full', app.current_app_user_id());
    end if;
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reverse_payment';
  if v_def is null then raise exception 'public.reverse_payment not found'; end if;
  if position('unwind_points_for_payment' in v_def) > 0 then return; end if;

  -- After the document's amount_paid/status have been rewritten, so the
  -- "is it still settled?" question reads the state the reversal just created.
  if position('insert into public.audit_events' in v_def) = 0 then
    raise exception 'reverse_payment: audit anchor not found — the points unwind was NOT installed';
  end if;

  v_def := replace(
    v_def,
    'insert into public.audit_events',
    '-- Give back what this payment did to the points. See 20260811000050.
  perform app.unwind_points_for_payment(v_orig.id);

  insert into public.audit_events'
  );

  execute v_def;
end $$;

do $$
begin
  if (select position('unwind_points_for_payment' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reverse_payment') then
    raise exception 'reverse_payment never learned to unwind points';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260811000050_reversing_gives_the_points_back.sql && node scripts/_verify-points.mjs
```

Expected: every check `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811000050_reversing_gives_the_points_back.sql scripts/_verify-points.mjs
git commit -m "feat(points): reversing a payment gives the points back"
```

---

## Task 6: The points arithmetic on the web

**Files:**
- Create: `apps/web/src/lib/points.ts`
- Create: `apps/web/src/lib/points.test.ts`
- Modify: `apps/web/src/lib/method-label.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/points.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pointsEarned, pointsToSpend, pointsValueCents } from './points';

describe('pointsEarned', () => {
  it('earns on the sale total at the shop rate', () => {
    expect(pointsEarned({ totalCents: 115_000, pointsPaidCents: 0, pointsPer100: 1 })).toBe(11);
  });

  it('ignores the share settled with points', () => {
    expect(pointsEarned({ totalCents: 115_000, pointsPaidCents: 5_000, pointsPer100: 1 })).toBe(11);
  });

  it('rounds down — a part point is not a point', () => {
    expect(pointsEarned({ totalCents: 9_900, pointsPaidCents: 0, pointsPer100: 1 })).toBe(0);
  });

  it('honours a rate above one', () => {
    expect(pointsEarned({ totalCents: 100_000, pointsPaidCents: 0, pointsPer100: 2.5 })).toBe(25);
  });

  it('earns nothing on a bill settled entirely in points', () => {
    expect(pointsEarned({ totalCents: 50_000, pointsPaidCents: 50_000, pointsPer100: 1 })).toBe(0);
  });
});

describe('pointsToSpend', () => {
  it('rounds up — the shop is not out of pocket for a fraction', () => {
    expect(pointsToSpend(5_050, 1)).toBe(51);
  });

  it('honours a point worth more than a rupee', () => {
    expect(pointsToSpend(10_000, 5)).toBe(20);
  });
});

describe('pointsValueCents', () => {
  it('states what a balance is worth', () => {
    expect(pointsValueCents(120, 1)).toBe(12_000);
  });
});
```

Note the second earning case: Rs 1,150 total with Rs 50 paid in points leaves Rs 1,100
earning, which is still 11 points at 1 per Rs 100 — the exclusion bites at the next
rupee, not this one. That is intentional; it pins the flooring behaviour.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test --workspace web -- points
```

Expected: FAIL — `Failed to resolve import "./points"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/points.ts`:

```ts
/**
 * Loyalty points — the web mirror of app.award_points_for_invoice and
 * app.spend_points. The database is the authority; this keeps the till honest
 * before the cashier commits.
 *
 * Earning follows the TOTAL PRICE OF A SALE at one shop-wide rate (the owner's
 * call, 2026-08-10). The total is already net of every discount, so a discounted
 * sale earns on what was actually paid. The share settled with points earns
 * nothing — otherwise a balance can be recycled indefinitely.
 */

export interface EarnInput {
  totalCents: number;
  pointsPaidCents: number;
  pointsPer100: number;
}

/** Points a settled bill earns. Rounds DOWN: a part point is not a point. */
export function pointsEarned({ totalCents, pointsPaidCents, pointsPer100 }: EarnInput): number {
  if (pointsPer100 <= 0) return 0;
  const base = Math.max(totalCents - pointsPaidCents, 0);
  return Math.floor((base / 100 / 100) * pointsPer100);
}

/** Points needed to settle `amountCents`. Rounds UP, so the shop is never out of pocket. */
export function pointsToSpend(amountCents: number, pointValueRupees: number): number {
  if (pointValueRupees <= 0) return 0;
  return Math.ceil(amountCents / 100 / pointValueRupees);
}

/** What a balance is worth, in cents. */
export function pointsValueCents(points: number, pointValueRupees: number): number {
  return Math.round(points * pointValueRupees * 100);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace web -- points
```

Expected: 8 passed.

- [ ] **Step 5: Label the new method**

In `apps/web/src/lib/method-label.ts`, add `points` to the map with the label `Points`.
Add a case to `apps/web/src/lib/method-label.test.ts` asserting it, and re-run:

```bash
npm test --workspace web
```

Expected: the whole suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/points.ts apps/web/src/lib/points.test.ts apps/web/src/lib/method-label.ts apps/web/src/lib/method-label.test.ts
git commit -m "feat(points): the points arithmetic, mirrored on the web"
```

---

## Task 7: The web surfaces

**Files:**
- Create: `apps/web/src/features/customers/PointsPanel.tsx`
- Modify: the settings form, the payment UI, `apps/web/src/components/pdf/ReceiptCard.tsx`

- [ ] **Step 1: The customer's balance and history**

Create `PointsPanel.tsx` showing `points_balance`, what it is worth
(`pointsValueCents`), and the ledger newest-first with its reason and date. Match the
markup of an existing panel on the customer page rather than inventing one. Mount it on
the customer detail page.

- [ ] **Step 2: The two settings**

Add `points_per_100` and `point_value_rupees` to the settings form, following the pattern
already used there for `vat_rate`. Label them *Points per Rs 100* and *A point is worth
(Rs)*.

- [ ] **Step 3: The Points tender**

In the payment UI, add Points alongside cash/card/Juice/bank. It must:

- appear only when the invoice names a customer;
- show the balance and what it is worth;
- cap the amount at `min(outstanding, pointsValueCents(balance, rate))`;
- send `method: 'points'` with no external reference.

- [ ] **Step 4: The receipt**

Add points earned and the running balance to `ReceiptCard.tsx`. **This must be mirrored
in the tablet's `ReceiptText` / `ReceiptPaper` in the same commit** — the two receipts are
required to be identical, and the parity has slipped before when only one was changed.
Task 8 covers the tablet side; do them together and commit once.

- [ ] **Step 5: Verify in the running app**

Open the preview (`preview_start`, never `npm run dev` in a shell). Take a cash payment
on a customer's bill, confirm the balance rises by the expected number, then pay part of
a second bill with points and confirm the balance falls and the receipt states both.
Check `read_console_messages` after each step.

- [ ] **Step 6: Confirm the Z-report picked it up without being asked**

```bash
node scripts/q.mjs "select jsonb_pretty(app.z_totals((select tenant_id from app_users where role='owner' limit 1), null, null)->'methods')"
```

Expected: a `points` entry beside cash/card. `app.z_totals` groups by method dynamically,
so this should need no code change — if `points` is missing, stop and find out why before
going further.

---

## Task 8: The tablet surfaces

**Files:**
- Modify: the payment pad
- Modify: `android/app/src/main/java/mu/carfection/pos/core/hardware/Hardware.kt`
- Modify: `android/app/src/test/java/mu/carfection/pos/core/hardware/ReceiptTextTest.kt`

- [ ] **Step 1: Write the failing receipt test**

Add a case to `ReceiptTextTest.kt` asserting that a receipt for a sale that earned points
prints the earned figure and the new balance, in the same words the web receipt uses.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd android && ./gradlew testDebugUnitTest --tests "*ReceiptTextTest*"
```

Expected: FAIL — the lines are absent.

- [ ] **Step 3: Add the receipt lines**

Update `ReceiptText` and `ReceiptPaper` in `Hardware.kt`. Word for word the same as
`ReceiptCard.tsx` from Task 7 — the tablet slip and the web receipt are required to be
identical.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd android && ./gradlew testDebugUnitTest --tests "*ReceiptTextTest*"
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Add the Points tender to the pad**

Same rules as the web: only when the bill names a customer, capped at what the balance is
worth, no external reference.

- [ ] **Step 6: Build and install**

```bash
cd android && ./gradlew assembleDebug
```

Install with `adb install -r`. Build with `./gradlew` *first* — `publish-apk` will ship
whatever APK is already on disk. Dump the UI tree and tap matched bounds; never tap
coordinates read off a screenshot, because the emulator's session is live and its taps
are real transactions.

- [ ] **Step 7: Commit web and tablet receipts together**

```bash
git add apps/web/src/components/pdf/ReceiptCard.tsx android/app/src/main/java/mu/carfection/pos/core/hardware/Hardware.kt android/app/src/test/java/mu/carfection/pos/core/hardware/ReceiptTextTest.kt
git commit -m "feat(points): the receipt states what was earned, on both surfaces"
```

---

## Task 9: Android ↔ web parity gate

A customer who earns points at the tablet till and spends them at the back office must
see one balance and one story. This is a gate — do not proceed to Task 10 with a red row.

- [ ] **Step 1: Walk the table and mark each cell**

| Capability | Web | Android |
|---|---|---|
| Points tender offered when the bill names a customer | payment UI | payment pad |
| Tender hidden when there is no customer | payment UI | payment pad |
| Balance and its rupee value shown at the tender | `pointsValueCents` | `pointsValueCents` |
| Amount capped at `min(outstanding, balance value)` | payment UI | payment pad |
| Sent as `method: 'points'`, no external reference | payment call | `SaleRepository.kt` payment path |
| Points earned printed on the receipt, same wording | `ReceiptCard.tsx` | `ReceiptText`/`ReceiptPaper` |
| Running balance printed, same wording | `ReceiptCard.tsx` | `ReceiptText`/`ReceiptPaper` |
| Same refusal wording on an overdraft | error from the RPC | error from the RPC |

- [ ] **Step 2: Prove the receipts are identical, not merely similar**

The receipt-parity rule is strict: the tablet slip and the web receipt must read the same,
word for word, and both change in the same commit. Put the same fixture through both and
diff the points lines:

```bash
npm test --workspace web -- ReceiptCard
```

```bash
cd android && ./gradlew testDebugUnitTest --tests "*ReceiptTextTest*"
```

Read the two expected strings side by side. `Points earned: 11` on one and
`Points: +11` on the other is a **failure**, not a nuance.

- [ ] **Step 3: Prove the arithmetic agrees**

`apps/web/src/lib/points.ts` and its Kotlin counterpart are two implementations of one
rule. Assert the same fixtures in both — including the two that pin the rounding:
`pointsEarned` floors (Rs 99 earns 0) and `pointsToSpend` ceils (Rs 50.50 costs 51 points).
A case present on one side only is drift.

- [ ] **Step 4: Earn on one surface, spend on the other**

The real proof. On the emulator, ring and settle a bill for a named customer. Then on the
web, open that customer and confirm the balance rose by the expected number, and pay part
of a second bill with those points. Confirm the ledger tells one story:

```bash
node scripts/q.mjs "select created_at, delta, reason, ref_type from customer_points_ledger order by created_at desc limit 10"
```

Dump the UI tree and tap matched bounds on the emulator — its session is live.

- [ ] **Step 5: Record the result**

Write the completed table into the commit message. If a row cannot be made green, stop and
report which surface is behind.

```bash
git commit --allow-empty -m "test(parity): points read the same on the tablet and the web"
```

---

## Task 10: Prove the whole thing together

- [ ] **Step 1: Run the probe and both unit suites**

```bash
node scripts/_verify-points.mjs && npm test --workspace web
```

```bash
cd android && ./gradlew testDebugUnitTest
```

Expected: `ALL GOOD` and two green suites.

- [ ] **Step 2: Prove the fiscal core is untouched**

```bash
node scripts/verify-money-path.mjs
```

Expected: 77,200 / 11,580 / 88,780 unchanged. Points are a tender; if this vector moved,
something is treating them as a discount.

- [ ] **Step 3: Confirm the balance and the ledger agree**

```bash
node scripts/q.mjs "select c.name, c.points_balance, coalesce(sum(l.delta),0) as ledger from customers c left join customer_points_ledger l on l.customer_id = c.id group by c.id, c.name, c.points_balance having c.points_balance <> coalesce(sum(l.delta),0)"
```

Expected: **no rows**. Any row here means the trigger and the ledger have drifted, which
must be fixed before the feature is used.

- [ ] **Step 4: Set the owner's rates**

The defaults are 1 point per Rs 100 and a point worth Rs 1. Ask the owner what they
actually want before announcing the feature, and set it in Settings.

- [ ] **Step 5: Report**

State which probes ran and what they printed. Do not claim points work on the strength of
a compile.
