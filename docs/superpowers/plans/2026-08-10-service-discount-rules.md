# Service Discount Rules & Owner Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Services carry no discount, a carwash may be discounted up to 5% with a reason, reversals need the owner — and an owner PIN raises any of those ceilings on the spot.

**Architecture:** Every line gets a *discount allowance* in VAT-inclusive rupees, derived from a new `products.discount_policy`. A document's ceiling is the sum of its lines', so the order-level discount is governed by the same rule as line discounts and stops being a back door. `issue_document` is the hard gate. An `owner_overrides` row, created only after a server-side owner-PIN check, raises the ceiling to a stated figure — never to "unlimited".

**Tech Stack:** PostgreSQL (Supabase) with plpgsql RPCs; Next.js 16.2.10 App Router + React 19 (`apps/web`); Kotlin/Compose (`android`); Vitest for web unit tests; `scripts/_verify-*.mjs` rolled-back probes for database behaviour.

**Spec:** `docs/superpowers/specs/2026-08-10-service-discounts-and-customer-points-design.md`

---

## Background an engineer needs before starting

**Money is stored ex-VAT, quoted incl-VAT.** `document_lines.unit_price` is VAT-exclusive. `line_total_excl` and `line_vat` are *generated columns*. A fixed "Rs X off" (`discount_kind='amount'`) is VAT-**inclusive** and the generated column divides it by `(1+vat_rate/100)`. A percentage (`discount_kind='percent'`) applies to the ex-VAT base. This plan compares everything in VAT-inclusive rupees because that is the one unit both forms share.

**Never recompute a line's net yourself.** Read `line_total_excl + line_vat`. Recomputing invites a one-cent drift that shows up as a phantom discount on an undiscounted document — the Android code carries a comment about exactly that bug at `android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt:957`.

**Long functions are spliced, not retyped.** `issue_document` and `save_draft` have been edited by many migrations. Retyping a body from an older migration silently reverted a live fix once already — see the warning in `supabase/migrations/20260802000010_issue_document_replays_before_it_guards.sql`. Modify them with `pg_get_functiondef` + `replace()` inside a `do $$ … $$` block, and raise an exception if the anchor text is not found.

**Applying a migration — do NOT use `npm run db:push`.** It is broken repo-wide and always has been: 13 pairs of migration files share an identical timestamp prefix, which is the Supabase CLI's version and the primary key of `supabase_migrations.schema_migrations`. That table tracks 21 of the 108 files and is stuck at `20260710000001`, so the CLI re-applies from there and dies on a duplicate key. The live schema is far ahead of it.

This project applies migrations one file at a time:

```bash
node scripts/db-exec.mjs supabase/migrations/<the file this task created>.sql
```

Each task below names its file. Leave the bookkeeping table alone — do not hand-write rows into `schema_migrations` to "catch it up"; that is production state, and repairing 13 historical collisions is a separate job nobody has asked for.

**Two tenants share this database:** `Carfectionist` (`1111…0001`, the real shop) and `Carfectionist Sandbox` (`2222…0002`). Each holds its own 51 active services. A query that forgets to scope by tenant returns 102 and looks like a duplicated catalogue — it is not. The probes impersonate the owner, so `app.current_tenant_id()` scopes them correctly; ad-hoc queries must scope themselves.

**Running a probe:** `node scripts/_verify-<name>.mjs`. These open a transaction, impersonate the owner, assert, and always `rollback`. Nothing persists.

**Sandboxing:** database scripts need the sandbox disabled (port 5432 is blocked otherwise).

**The owner's auth uid** for probes is `0eb870dc-ef5b-400a-8744-859c999a1b1b` (Anesh). Copy the harness from `scripts/_verify-line-kind.mjs`.

---

## File Structure

**Database — new migrations (applied in this order):**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260810000010_a_product_says_how_it_may_be_discounted.sql` | `products.discount_policy` column |
| `supabase/migrations/20260810000020_a_discount_carries_its_reason.sql` | `documents.discount_reason` + `save_draft` splice |
| `supabase/migrations/20260810000030_an_owner_can_raise_the_ceiling.sql` | `owner_overrides` table + `app.record_owner_override` |
| `supabase/migrations/20260810000040_every_line_has_a_discount_allowance.sql` | `app.document_discount_limits` + `app.assert_discount_allowed` |
| `supabase/migrations/20260810000050_issuing_checks_the_allowance.sql` | splice the guard into `issue_document` |
| `supabase/migrations/20260810000060_only_the_owner_reverses_money.sql` | `reverse_payment` + `create_and_issue_credit_note` role change |

**Web:**

| File | Responsibility |
|---|---|
| `apps/web/src/lib/money/allowance.ts` (create) | the allowance arithmetic, mirroring the SQL |
| `apps/web/src/lib/money/allowance.test.ts` (create) | its unit tests |
| `apps/web/src/app/api/override/route.ts` (create) | owner-PIN approval endpoint |
| `apps/web/src/features/documents/OwnerOverrideDialog.tsx` (create) | the PIN + reason dialog |
| `apps/web/src/features/documents/builder/state.ts` (modify) | carry `discountPolicy` on a line, `discountReason` on the doc |
| `apps/web/src/features/documents/builder/DocumentBuilder.tsx` (modify) | clamp inputs, reason field, override entry point |
| `apps/web/src/features/documents/payload.ts` (modify) | send `discount_reason` |
| `apps/web/src/features/products/ProductFormModal.tsx` (modify) | the discount-policy control |

**Android:**

| File | Responsibility |
|---|---|
| `android/app/src/main/java/mu/carfection/pos/core/money/Allowance.kt` (create) | the same arithmetic in Kotlin |
| `android/app/src/test/java/mu/carfection/pos/core/money/AllowanceTest.kt` (create) | its unit tests |
| `android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt` (modify) | clamp the discount controls, reason field |
| `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt` (modify) | same at the counter |

**Probes:**

`scripts/_verify-discount-allowance.mjs`, `scripts/_verify-owner-override.mjs`, `scripts/_verify-owner-reversal.mjs`.

---

## Task 1: `products.discount_policy`

**Files:**
- Create: `supabase/migrations/20260810000010_a_product_says_how_it_may_be_discounted.sql`
- Create: `scripts/_verify-discount-allowance.mjs`

- [ ] **Step 1: Write the failing probe**

Create `scripts/_verify-discount-allowance.mjs`:

```js
// Rolled-back verification for the discount-allowance rules.
//
// The owner's rules: a service takes no discount, a carwash takes up to 5% and only
// with a reason, and the whole-document discount cannot go past the sum of what the
// lines allow. Runs as `authenticated` impersonating the owner, then ROLLS BACK.
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

  console.log("▸ a product states how it may be discounted");
  const cols = (await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rowCount;
  check("products.discount_policy exists", cols, 1);

  const dflt = (await c.query(
    `select column_default from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rows[0]?.column_default ?? "";
  check("it defaults to 'inherit'", dflt.startsWith("'inherit'"), true);

  let refused = "no";
  try {
    await c.query("savepoint s1");
    await c.query(
      "insert into public.products (tenant_id, name, kind, discount_policy) values ($1,'probe','service','nonsense')",
      [tenant],
    );
  } catch { refused = "yes"; }
  await c.query("rollback to savepoint s1");
  check("a nonsense policy is refused", refused, "yes");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-discount-allowance.mjs
```

Expected: `✗ products.discount_policy exists: got 0 (want 1)` and a non-zero exit.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000010_a_product_says_how_it_may_be_discounted.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a product says how much of it may be given away.
--
-- The owner's rule (2026-08-10): no discount on a service, except a carwash,
-- which may go to 5% and only with a reason. Nothing in the catalogue could
-- express that. All 102 service rows sit in the single category
-- 'CAR WASH EXPERTS', which covers both a Rs 621 WASH & VACUUM and a Rs 16,086
-- BODY POLISH — so category cannot answer, and neither can kind.
--
-- 'inherit' derives the answer from the kind, which is right for the 795 rows
-- already on file: a service gives nothing away, goods are unchanged. The owner
-- then ticks 'carwash' on the seven wash services.
--
-- 'free' is not decoration. SPONGE, WHEEL BRUSH and SET 2 SOFT BRUSH are goods
-- wearing kind='service' in the live catalogue; without an explicit escape they
-- would be frozen by a rule that was never aimed at them.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists discount_policy text not null default 'inherit'
    check (discount_policy in ('inherit','none','carwash','free'));

comment on column public.products.discount_policy is
  'How much of this line may be discounted. inherit = derive from kind (service -> none, goods -> free); none = nothing; carwash = up to 5% with a reason; free = unrestricted.';
```

- [ ] **Step 4: Push and re-run the probe**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000010_a_product_says_how_it_may_be_discounted.sql && node scripts/_verify-discount-allowance.mjs
```

Expected: all three checks `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810000010_a_product_says_how_it_may_be_discounted.sql scripts/_verify-discount-allowance.mjs
git commit -m "feat(catalogue): a product says how much of it may be given away"
```

---

## Task 2: `documents.discount_reason`

**Files:**
- Create: `supabase/migrations/20260810000020_a_discount_carries_its_reason.sql`
- Modify: `scripts/_verify-discount-allowance.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-discount-allowance.mjs`, insert before the closing `} finally {`:

```js
  console.log("▸ a discount carries the reason it was given");
  const hasReason = (await c.query(
    `select 1 from information_schema.columns
      where table_schema='public' and table_name='documents' and column_name='discount_reason'`,
  )).rowCount;
  check("documents.discount_reason exists", hasReason, 1);

  const customer = (await c.query(
    "select id from public.customers where tenant_id = $1 order by created_at limit 1", [tenant],
  )).rows[0].id;
  const doc = {
    id: null, doc_type: "quote", customer_id: customer, vehicle_id: null, template_id: null,
    template_overrides: {}, valid_until: null, due_date: null, origin: "standalone",
    discount_kind: null, discount_value: 0, discount_reason: "regular customer",
  };
  const saved = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
    JSON.stringify(doc),
    JSON.stringify([{
      product_id: null, title: "Wash", description: null, qty: 1, unit_price: 1000,
      discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
      sort_order: 0, line_kind: "service",
    }]),
  ])).rows[0];
  check("save_draft stores the reason", saved.discount_reason, "regular customer");
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-discount-allowance.mjs
```

Expected: `✗ documents.discount_reason exists: got 0 (want 1)`, then an error on the `save_draft` call.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000020_a_discount_carries_its_reason.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a discount says why it was given.
--
-- Rule 2 of 2026-08-10: a carwash may be discounted 5%, and only if a reason is
-- given. One box per document, not one per line — a cashier types one sentence,
-- and per-line reasons would be theatre. It is read back in Activity.
--
-- save_draft is spliced rather than retyped: it is long, five migrations have
-- edited it, and retyping a body from an older migration is how a live fix
-- silently reverts (see 20260802000010).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists discount_reason text;

comment on column public.documents.discount_reason is
  'Why a discount reaching into a service or carwash allowance was given. Required by app.assert_discount_allowed when the discount passes what the goods lines alone would cover.';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_draft';
  if v_def is null then raise exception 'public.save_draft not found'; end if;
  if position('discount_reason' in v_def) > 0 then return; end if;

  -- the UPDATE branch
  if position('discount_value     = case when p_doc ? ''discount_value''' in v_def) = 0 then
    raise exception 'save_draft: UPDATE anchor not found — discount_reason NOT installed';
  end if;
  v_def := replace(
    v_def,
    'discount_value     = case when p_doc ? ''discount_value''',
    'discount_reason    = case when p_doc ? ''discount_reason'' then nullif(p_doc->>''discount_reason'','''') else discount_reason end,
      discount_value     = case when p_doc ? ''discount_value'''
  );

  -- the INSERT branch: column list, then values list
  if position('discount_kind, discount_value, created_by)' in v_def) = 0
     or position('coalesce((p_doc->>''discount_value'')::numeric,0),' in v_def) = 0 then
    raise exception 'save_draft: INSERT anchors not found — discount_reason NOT installed';
  end if;
  v_def := replace(v_def,
    'discount_kind, discount_value, created_by)',
    'discount_kind, discount_value, discount_reason, created_by)');
  v_def := replace(v_def,
    'coalesce((p_doc->>''discount_value'')::numeric,0),',
    'coalesce((p_doc->>''discount_value'')::numeric,0), nullif(p_doc->>''discount_reason'',''''),');

  execute v_def;
end $$;

do $$
begin
  if (select position('discount_reason' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'save_draft') then
    raise exception 'save_draft never learned discount_reason';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000020_a_discount_carries_its_reason.sql && node scripts/_verify-discount-allowance.mjs
```

Expected: `✓ documents.discount_reason exists` and `✓ save_draft stores the reason`.

> If the migration raises `save_draft: UPDATE anchor not found`, dump the live body with
> `node scripts/_dump-fn.mjs save_draft` and adjust the anchor strings to match the
> installed whitespace. Do **not** retype the function.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810000020_a_discount_carries_its_reason.sql scripts/_verify-discount-allowance.mjs
git commit -m "feat(discounts): a discount says why it was given"
```

---

## Task 3: `owner_overrides` and the approval RPC

**Files:**
- Create: `supabase/migrations/20260810000030_an_owner_can_raise_the_ceiling.sql`
- Create: `scripts/_verify-owner-override.mjs`

- [ ] **Step 1: Write the failing probe**

Create `scripts/_verify-owner-override.mjs`:

```js
// Rolled-back verification for the owner override.
//
// A cashier cannot discount a service or reverse a payment. An OWNER's PIN, checked
// server-side, raises the ceiling to a STATED figure — never to "unlimited", so an
// approval cannot be edited upward afterwards. Runs service-role, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

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

  const owner = (await c.query(
    "select id, tenant_id from public.app_users where role='owner' and is_active order by created_at limit 1",
  )).rows[0];
  const other = (await c.query(
    "select id from public.app_users where role <> 'owner' and is_active order by created_at limit 1",
  )).rows[0];

  // Give both a known PIN for the length of this transaction.
  await c.query(
    "update public.app_users set pin_hash = extensions.crypt('4321', extensions.gen_salt('bf')), pin_attempts = 0, pin_locked_until = null where id = any($1::uuid[])",
    [[owner.id, other?.id].filter(Boolean)],
  );

  const doc = (await c.query(
    "select id from public.documents where tenant_id = $1 order by created_at desc limit 1", [owner.tenant_id],
  )).rows[0];

  console.log("▸ an owner's PIN records an override");
  const row = (await c.query(
    "select * from app.record_owner_override($1::uuid, '4321', 'discount', 'document', $2::uuid, 'goodwill', $3::jsonb)",
    [owner.id, doc.id, JSON.stringify({ max_discount_incl: 500 })],
  )).rows[0];
  check("it is stamped with the approver", row.approved_by, owner.id);
  check("it states a ceiling, not a yes", row.scope.max_discount_incl, 500);

  console.log("▸ what it refuses");
  const refuses = async (label, sql, params) => {
    let msg = "accepted";
    try {
      await c.query("savepoint s");
      await c.query(sql, params);
    } catch (e) { msg = e.message; }
    await c.query("rollback to savepoint s");
    check(label, msg !== "accepted", true);
    return msg;
  };
  await refuses("a wrong PIN", "select app.record_owner_override($1::uuid,'0000','discount','document',$2::uuid,'x','{}'::jsonb)", [owner.id, doc.id]);
  if (other) {
    await refuses("a correct PIN belonging to a non-owner", "select app.record_owner_override($1::uuid,'4321','discount','document',$2::uuid,'x','{}'::jsonb)", [other.id, doc.id]);
  }
  await refuses("no reason", "select app.record_owner_override($1::uuid,'4321','discount','document',$2::uuid,'   ','{}'::jsonb)", [owner.id, doc.id]);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-owner-override.mjs
```

Expected: an error — `function app.record_owner_override(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000030_an_owner_can_raise_the_ceiling.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — the owner raises a ceiling without taking the till.
--
-- Rules 1-3 of 2026-08-10 all end "…unless the owner says otherwise", and the
-- person at the till is a cashier. Roles alone cannot bridge that: making the
-- cashier an owner is the thing being prevented, and signing the owner in would
-- take the device off the operator and misattribute every sale that followed.
--
-- So: an override row, created only after the owner's own PIN is checked by the
-- same server-side path the tablet already logs in through. The PIN is verified
-- here, not by the caller — the route holds the service-role key and must not
-- also hold the decision.
--
-- scope states a FIGURE, not a yes. 'Up to Rs 500 off this document' cannot be
-- turned into Rs 5,000 by editing the lines after approval; the guard re-reads
-- it every time the document is issued.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.owner_overrides (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.business_settings(id),
  kind         text not null check (kind in ('discount','reversal')),
  ref_type     text not null check (ref_type in ('document','payment')),
  ref_id       uuid not null,
  scope        jsonb not null default '{}'::jsonb,
  reason       text not null check (length(trim(reason)) > 0),
  approved_by  uuid not null references public.app_users(id),
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);
create index if not exists idx_owner_overrides_ref
  on public.owner_overrides (tenant_id, kind, ref_type, ref_id);

comment on table public.owner_overrides is
  'An owner''s on-the-spot approval to exceed a rule. consumed_at is stamped on reversal overrides, which are single-use — one approval must not authorise a second refund. Discount overrides are a ceiling, re-checked on every issue.';

alter table public.owner_overrides enable row level security;

-- Readable within the tenant (the builder shows "approved by X"); never
-- client-writable — app.record_owner_override is the only way in.
drop policy if exists owner_overrides_read on public.owner_overrides;
create policy owner_overrides_read on public.owner_overrides
  for select using (tenant_id = app.current_tenant_id());

-- ─── the only writer ────────────────────────────────────────────────────────
create or replace function app.record_owner_override(
  p_app_user_id uuid,
  p_pin         text,
  p_kind        text,
  p_ref_type    text,
  p_ref_id      uuid,
  p_reason      text,
  p_scope       jsonb default '{}'::jsonb
) returns public.owner_overrides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_check jsonb;
  v_user  public.app_users;
  v_row   public.owner_overrides;
begin
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'an override requires a reason';
  end if;

  select * into v_user from public.app_users where id = p_app_user_id;
  if not found or not v_user.is_active then raise exception 'unknown approver'; end if;
  if v_user.role <> 'owner' then raise exception 'only the owner can approve an override'; end if;

  -- The PIN is checked HERE. verify_staff_pin carries the per-user lockout that
  -- makes a 4-digit secret survivable.
  v_check := public.verify_staff_pin(p_app_user_id, p_pin);
  if not coalesce((v_check->>'ok')::boolean, false) then
    raise exception 'owner PIN rejected (%)', coalesce(v_check->>'reason','invalid');
  end if;

  insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
  values (v_user.tenant_id, p_kind, p_ref_type, p_ref_id, coalesce(p_scope,'{}'::jsonb), trim(p_reason), p_app_user_id)
  returning * into v_row;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
  values (v_user.tenant_id, p_app_user_id, 'owner_override', p_ref_type, p_ref_id,
          jsonb_build_object('kind', p_kind, 'reason', trim(p_reason), 'scope', p_scope));

  return v_row;
end $$;

-- Service role only: this function decides who the owner is, so it must not be
-- reachable from a browser or a tablet session.
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from public;
revoke execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) from authenticated;
grant  execute on function app.record_owner_override(uuid, text, text, text, uuid, text, jsonb) to service_role;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000030_an_owner_can_raise_the_ceiling.sql && node scripts/_verify-owner-override.mjs
```

Expected: all checks `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810000030_an_owner_can_raise_the_ceiling.sql scripts/_verify-owner-override.mjs
git commit -m "feat(override): the owner raises a ceiling without taking the till"
```

---

## Task 4: The allowance arithmetic in SQL

**Files:**
- Create: `supabase/migrations/20260810000040_every_line_has_a_discount_allowance.sql`
- Modify: `scripts/_verify-discount-allowance.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-discount-allowance.mjs`, insert before the closing `} finally {`:

```js
  console.log("▸ a line's allowance follows its policy");
  const svc = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe polish','service',1000,'inherit') returning id", [tenant],
  )).rows[0].id;
  const wash = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe wash','service',1000,'carwash') returning id", [tenant],
  )).rows[0].id;
  const goods = (await c.query(
    "insert into public.products (tenant_id, name, kind, selling_price, discount_policy) values ($1,'probe cologne','product',1000,'inherit') returning id", [tenant],
  )).rows[0].id;

  const line = (productId, over) => ({
    product_id: productId, title: "probe", description: null, qty: 1, unit_price: 1000,
    discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, ...over,
  });
  const limitsFor = async (lines, docOver = {}) => {
    const d = (await c.query("select * from public.save_draft($1::jsonb, $2::jsonb, null)", [
      JSON.stringify({ ...doc, id: null, discount_reason: null, ...docOver }),
      JSON.stringify(lines.map((l, i) => ({ ...l, sort_order: i }))),
    ])).rows[0];
    const lim = (await c.query("select * from app.document_discount_limits($1::uuid)", [d.id])).rows[0];
    return { id: d.id, ...lim };
  };

  // Rs 1,000 ex-VAT at 15% = Rs 1,150 inclusive.
  const onlyService = await limitsFor([line(svc)]);
  check("a service allows nothing", Number(onlyService.ceiling_incl), 0);

  const onlyWash = await limitsFor([line(wash)]);
  check("a carwash allows 5% of its gross", Number(onlyWash.ceiling_incl), 57.5);
  check("that 5% is not 'free'", Number(onlyWash.free_incl), 0);

  const onlyGoods = await limitsFor([line(goods)]);
  check("goods allow the whole line", Number(onlyGoods.ceiling_incl), 1150);
  check("goods are free allowance", Number(onlyGoods.free_incl), 1150);

  const mixed = await limitsFor([line(svc), line(goods)]);
  check("a mixed document sums its lines", Number(mixed.ceiling_incl), 1150);

  console.log("▸ an undiscounted document shows no phantom discount");
  check("actual is exactly zero", Number(mixed.actual_incl), 0);

  console.log("▸ actual counts line and order discounts together");
  const both = await limitsFor(
    [line(goods, { discount_kind: "amount", discount_amount: 100 })],
    { discount_kind: "amount", discount_value: 50 },
  );
  check("Rs 100 off a line plus Rs 50 off the order", Number(both.actual_incl), 150);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-discount-allowance.mjs
```

Expected: an error — `function app.document_discount_limits(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000040_every_line_has_a_discount_allowance.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — every line carries a discount allowance.
--
-- The owner's rules 1 and 2 are two values of one idea: the most, in
-- VAT-inclusive rupees, that a line may be given away. A document's ceiling is
-- the sum of its lines', which is what closes the back door — the whole-document
-- discount field spreads across every line, services included, so governing only
-- the line inputs would leave 'Discount (whole quote)' free to do what rule 1
-- forbids.
--
-- Two thresholds, not one:
--   actual > free_incl     -> the discount is reaching into a carwash allowance,
--                             so a reason is required (rule 2).
--   actual > ceiling_incl  -> only the owner can allow it (rules 1 and 2).
-- Keeping them apart is what stops the reason box nagging on a bill whose
-- discount is entirely covered by its goods lines.
--
-- NOTHING here recomputes a line's net. line_total_excl and line_vat are
-- generated columns and they are the authority; deriving the gross the same way
-- the generated columns derive an undiscounted line is what makes disc_incl
-- land on exactly 0 when there is no discount. Computing gross as
-- round(qty*unit*(1+rate/100), 2) instead drifts a cent on many qty>=2 lines and
-- would raise a phantom "discount" on documents that have none — the bug already
-- written up at QuoteScreen.kt:957.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.document_discount_limits(p_doc uuid)
returns table(ceiling_incl numeric, free_incl numeric, actual_incl numeric)
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select
      round(dl.qty * dl.unit_price, 2)
        + round(round(dl.qty * dl.unit_price, 2) * dl.vat_rate / 100.0, 2) as gross_incl,
      dl.line_total_excl + dl.line_vat                                     as net_incl,
      coalesce(
        nullif(p.discount_policy, 'inherit'),
        case when coalesce(dl.line_kind, p.kind, 'service') = 'service'
             then 'none' else 'free' end
      ) as policy
    from public.document_lines dl
    left join public.products p on p.id = dl.product_id
    where dl.document_id = p_doc
  ),
  agg as (
    select
      coalesce(sum(case policy when 'free'    then gross_incl
                               when 'carwash' then round(gross_incl * 0.05, 2)
                               else 0 end), 0)                       as ceiling,
      coalesce(sum(case policy when 'free' then gross_incl else 0 end), 0) as free_part,
      coalesce(sum(greatest(gross_incl - net_incl, 0)), 0)           as line_disc,
      coalesce(sum(net_incl), 0)                                     as post_line_gross
    from l
  ),
  ord as (
    select case
      when d.discount_kind is null or coalesce(d.discount_value, 0) = 0 then 0
      when d.discount_kind = 'percent' then round(a.post_line_gross * d.discount_value / 100.0, 2)
      else least(d.discount_value, a.post_line_gross) end as o
    from public.documents d cross join agg a
    where d.id = p_doc
  )
  select round(a.ceiling, 2), round(a.free_part, 2), round(a.line_disc + coalesce(o.o, 0), 2)
  from agg a left join ord o on true;
$$;

comment on function app.document_discount_limits(uuid) is
  'What this document may be discounted (ceiling_incl), how much of that comes from unrestricted goods lines (free_incl), and what it actually carries across line and order discounts (actual_incl). All VAT-inclusive rupees.';

-- ─── the guard ──────────────────────────────────────────────────────────────
create or replace function app.assert_discount_allowed(p_doc uuid) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_doc      public.documents;
  v_lim      record;
  v_approved numeric;
  v_allowed  numeric;
begin
  select * into v_doc from public.documents where id = p_doc;
  if not found then return; end if;

  -- A credit note mirrors the invoice it reverses. Re-earning an approval the
  -- invoice already carried would block a legitimate refund.
  if v_doc.doc_type = 'credit_note' then return; end if;

  select * into v_lim from app.document_discount_limits(p_doc);
  if coalesce(v_lim.actual_incl, 0) <= 0.01 then return; end if;

  select max((scope->>'max_discount_incl')::numeric) into v_approved
    from public.owner_overrides
   where tenant_id = v_doc.tenant_id and kind = 'discount'
     and ref_type = 'document' and ref_id = p_doc;

  v_allowed := greatest(v_lim.ceiling_incl, coalesce(v_approved, 0));

  -- 1 cent of tolerance absorbs the rounding of a many-line document.
  if v_lim.actual_incl > v_allowed + 0.01 then
    raise exception 'discount exceeds allowance: Rs % requested, Rs % allowed',
      to_char(v_lim.actual_incl, 'FM999999990.00'), to_char(v_allowed, 'FM999999990.00');
  end if;

  -- An override carries its own reason, so it answers this too.
  if v_approved is null
     and v_lim.actual_incl > v_lim.free_incl + 0.01
     and coalesce(trim(v_doc.discount_reason), '') = '' then
    raise exception 'a reason is required for a carwash discount';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000040_every_line_has_a_discount_allowance.sql && node scripts/_verify-discount-allowance.mjs
```

Expected: every check `✓`, exit 0. The `actual is exactly zero` check is the important one — if it reports `0.01` or similar, the gross derivation has drifted and must be fixed before going further.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810000040_every_line_has_a_discount_allowance.sql scripts/_verify-discount-allowance.mjs
git commit -m "feat(discounts): every line carries a discount allowance"
```

---

## Task 5: Issuing enforces the allowance

**Files:**
- Create: `supabase/migrations/20260810000050_issuing_checks_the_allowance.sql`
- Modify: `scripts/_verify-discount-allowance.mjs`

- [ ] **Step 1: Add the failing checks**

In `scripts/_verify-discount-allowance.mjs`, insert before the closing `} finally {`:

```js
  console.log("▸ issuing is where the rule bites");
  const issueRefuses = async (label, lines, docOver, want) => {
    const d = await limitsFor(lines, docOver);
    let msg = "issued";
    try {
      await c.query("savepoint i");
      await c.query("select public.issue_document($1::uuid, null, null, null)", [d.id]);
    } catch (e) { msg = e.message; }
    await c.query("rollback to savepoint i");
    check(label, msg.includes(want), true);
    return d;
  };

  await issueRefuses("a service refuses a discount", [line(svc, { discount_pct: 10 })], {}, "discount exceeds allowance");
  await issueRefuses("a carwash refuses 6%", [line(wash, { discount_pct: 6 })], { discount_reason: "why" }, "discount exceeds allowance");
  await issueRefuses("a carwash at 5% still needs a reason", [line(wash, { discount_pct: 5 })], {}, "a reason is required");
  await issueRefuses("the order discount cannot outrun the lines",
    [line(svc), line(goods)], { discount_kind: "amount", discount_value: 2000, discount_reason: "x" },
    "discount exceeds allowance");

  const ok = await limitsFor([line(wash, { discount_pct: 5 })], { discount_reason: "regular customer" });
  let issued = "refused";
  try {
    await c.query("savepoint g");
    issued = (await c.query("select status from public.issue_document($1::uuid, null, null, null)", [ok.id])).rows[0].status;
  } catch (e) { issued = e.message; }
  await c.query("rollback to savepoint g");
  check("a carwash at 5% WITH a reason issues", issued, "issued");

  console.log("▸ an owner's approval raises the ceiling, to a figure");
  const over = await limitsFor([line(svc, { discount_pct: 10 })], { discount_reason: "owner said so" });
  // 10% of Rs 1,150 = Rs 115.
  await c.query(
    `insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, scope, reason, approved_by)
     values ($1,'discount','document',$2,$3::jsonb,'goodwill',(select id from public.app_users where role='owner' and is_active limit 1))`,
    [tenant, over.id, JSON.stringify({ max_discount_incl: 115 })],
  );
  let approved = "refused";
  try {
    await c.query("savepoint o");
    approved = (await c.query("select status from public.issue_document($1::uuid, null, null, null)", [over.id])).rows[0].status;
  } catch (e) { approved = e.message; }
  await c.query("rollback to savepoint o");
  check("the approved figure issues", approved, "issued");

  // The whole reason scope stores a FIGURE: raise the discount after approval and
  // the same override must stop covering it.
  await c.query(
    "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
    [
      JSON.stringify({ ...doc, id: over.id, discount_reason: "owner said so" }),
      JSON.stringify([{ ...line(svc, { discount_pct: 40 }), sort_order: 0 }]),
    ],
  );
  let edited = "issued";
  try {
    await c.query("savepoint e");
    await c.query("select public.issue_document($1::uuid, null, null, null)", [over.id]);
  } catch (e) { edited = e.message; }
  await c.query("rollback to savepoint e");
  check("editing the discount upward afterwards still refuses", edited.includes("discount exceeds allowance"), true);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-discount-allowance.mjs
```

Expected: the four refusal checks report `✗ … got false (want true)` — the document issues when it should not.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000050_issuing_checks_the_allowance.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — issuing is where the discount rule bites.
--
-- save_draft deliberately still accepts an over-limit discount. A cashier must
-- be able to save the bill and THEN go and find the owner; refusing at save
-- would mean losing the basket to ask permission.
--
-- issue_document is the fiscal gate every path funnels through — web, tablet,
-- and an offline sale replaying hours later — so it is the one place the rule
-- cannot be walked around.
--
-- Placed AFTER the no-lines check and BEFORE numbering: the document is locked
-- and validated by then, and nothing has been consumed that a refusal would
-- have to unwind. Note it also sits after the idempotency replay branch, which
-- is load-bearing — a retry of an already-issued sale must still answer from the
-- ledger rather than be re-judged (see 20260802000010).
--
-- Spliced, not retyped. This function is 145 lines and has been rebuilt by six
-- migrations; retyping it from an older text is exactly how the replay fix was
-- silently reverted once already.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_document';
  if v_def is null then raise exception 'public.issue_document not found'; end if;
  if position('assert_discount_allowed' in v_def) > 0 then return; end if;

  if position('if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;' in v_def) = 0 then
    raise exception 'issue_document: no-lines anchor not found — the discount guard was NOT installed';
  end if;

  v_def := replace(
    v_def,
    'if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;',
    'if v_lines = 0 then raise exception ''cannot issue a document with no lines''; end if;

  -- No discount on a service; a carwash to 5% with a reason; anything beyond
  -- needs an owner override naming this document. See 20260810000040.
  perform app.assert_discount_allowed(v_doc.id);'
  );

  execute v_def;
end $$;

do $$
begin
  if (select position('assert_discount_allowed' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'issue_document') then
    raise exception 'issue_document never learned the discount guard';
  end if;
end $$;
```

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000050_issuing_checks_the_allowance.sql && node scripts/_verify-discount-allowance.mjs
```

Expected: every check `✓`, exit 0.

- [ ] **Step 5: Prove the untouched path is untouched**

```bash
node scripts/verify-money-path.mjs
```

Expected: the canonical VAT vector still reports 77,200 / 11,580 / 88,780. If this regresses, the guard has changed totals — it must only read.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260810000050_issuing_checks_the_allowance.sql scripts/_verify-discount-allowance.mjs
git commit -m "feat(discounts): issuing is where the discount rule bites"
```

---

## Task 6: Only the owner reverses money

**Files:**
- Create: `supabase/migrations/20260810000060_only_the_owner_reverses_money.sql`
- Create: `scripts/_verify-owner-reversal.mjs`

- [ ] **Step 1: Write the failing probe**

Create `scripts/_verify-owner-reversal.mjs`:

```js
// Rolled-back verification: money leaves the business only on the owner's say-so.
//
// reverse_payment and create_and_issue_credit_note are the two ways cash goes back
// out. A manager could do both until 2026-08-10. Now: the owner, or an override row
// naming that payment/document. Every other undo (void a quote, cancel a job, reopen
// a day) is deliberately left at owner|manager.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

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

  const mgr = (await c.query(
    "select id, auth_user_id, tenant_id from public.app_users where role='manager' and is_active limit 1",
  )).rows[0];
  if (!mgr) { console.log("  – no manager on file; cannot prove the tightening. SKIPPED"); }

  const pay = (await c.query(
    `select p.id from public.payments p
      where p.amount > 0 and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
      order by p.created_at desc limit 1`,
  )).rows[0];

  const asUser = async (authUid) => {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);
  };

  if (mgr && pay) {
    console.log("▸ a manager can no longer reverse a payment");
    let msg = "reversed";
    try {
      await c.query("savepoint m");
      await asUser(mgr.auth_user_id);
      await c.query("select public.reverse_payment($1::uuid, 'probe')", [pay.id]);
    } catch (e) { msg = e.message; }
    await c.query("rollback to savepoint m");
    await c.query("set local role postgres");
    check("refused, and it says why", msg.includes("reversal requires the owner"), true);

    console.log("▸ an override lets that same manager through");
    await c.query(
      `insert into public.owner_overrides (tenant_id, kind, ref_type, ref_id, reason, approved_by)
       values ($1,'reversal','payment',$2,'customer complaint',(select id from public.app_users where role='owner' and is_active limit 1))`,
      [mgr.tenant_id, pay.id],
    );
    let ok2 = "refused";
    try {
      await c.query("savepoint m2");
      await asUser(mgr.auth_user_id);
      ok2 = (await c.query("select amount from public.reverse_payment($1::uuid, 'probe')", [pay.id])).rows[0].amount < 0 ? "reversed" : "odd";
    } catch (e) { ok2 = e.message; }
    await c.query("rollback to savepoint m2");
    await c.query("set local role postgres");
    check("the override authorises it", ok2, "reversed");

    console.log("▸ a reversal override is single-use");
    const consumed = (await c.query(
      "select count(*) n from public.owner_overrides where kind='reversal' and ref_id=$1 and consumed_at is not null", [pay.id],
    )).rows[0].n;
    check("nothing is consumed until it is used", consumed, "0");
  }

  console.log("▸ the other undo paths are deliberately untouched");
  const stillBoth = (await c.query(
    `select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname in ('void_quote','void_certificate','cancel_job')
        and position('require_role(''owner'',''manager'')' in pg_get_functiondef(p.oid)) > 0`,
  )).rows[0].n;
  check("void_quote, void_certificate and cancel_job still allow a manager", stillBoth, "3");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node scripts/_verify-owner-reversal.mjs
```

Expected: `✗ refused, and it says why: got false (want true)` — the manager reverses successfully today.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810000060_only_the_owner_reverses_money.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — money leaves the business on the owner's say-so.
--
-- Rule 3 of 2026-08-10. reverse_payment and create_and_issue_credit_note are
-- the two paths that put cash back in a customer's hand; both were open to a
-- manager. Narrowing only reverse_payment would have left the back door wide
-- open — a manager could refund the same money by crediting the invoice.
--
-- Everything else that undoes something (void_quote, void_certificate,
-- cancel_job, reopening a closed day) stays at owner|manager on purpose: a
-- manager still has to be able to run the shop without telephoning the owner
-- over a mistyped quote.
--
-- Both functions already demanded a reason. That stays; the override carries
-- its own reason besides.
--
-- Spliced, not retyped — reverse_payment alone has been rebuilt by seven
-- migrations, and the live body is the only trustworthy source.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.require_owner_or_override(p_ref_type text, p_ref_id uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_over   public.owner_overrides;
begin
  if app.current_user_role() = 'owner' then return; end if;

  select * into v_over from public.owner_overrides
   where tenant_id = v_tenant and kind = 'reversal'
     and ref_type = p_ref_type and ref_id = p_ref_id and consumed_at is null
   order by created_at limit 1
   for update;

  if not found then
    raise exception 'reversal requires the owner';
  end if;

  -- Single use: one approval must not authorise a second refund.
  update public.owner_overrides set consumed_at = now() where id = v_over.id;
end $$;

do $$
declare
  v_def    text;
  v_fn     text;
  v_anchor text;
begin
  foreach v_fn in array array['reverse_payment', 'create_and_issue_credit_note'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% not found', v_fn; end if;
    continue when position('require_owner_or_override' in v_def) > 0;

    if position('perform app.require_role(''owner'',''manager'');' in v_def) = 0 then
      raise exception '%: role anchor not found — the owner gate was NOT installed', v_fn;
    end if;

    v_anchor := case v_fn
      when 'reverse_payment' then 'perform app.require_owner_or_override(''payment'', p_payment_id);'
      else                        'perform app.require_owner_or_override(''document'', p_invoice_id);'
    end;

    v_def := replace(v_def, 'perform app.require_role(''owner'',''manager'');',
      'perform app.require_role(''owner'',''manager'');
  -- Rule 3 (2026-08-10): the owner, or an override naming this one. See 20260810000060.
  ' || v_anchor);

    execute v_def;
  end loop;
end $$;

do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('reverse_payment','create_and_issue_credit_note')
     and position('require_owner_or_override' in pg_get_functiondef(p.oid)) = 0;
  if v_missing is not null then raise exception 'the owner gate did not reach: %', v_missing; end if;
end $$;
```

> **Check the credit-note parameter name first.** The splice assumes
> `create_and_issue_credit_note`'s invoice argument is `p_invoice_id`. Confirm with
> `node scripts/_dump-fn.mjs create_and_issue_credit_note` and correct the anchor if it
> differs — a wrong name fails loudly at `execute`, which is the intent.

- [ ] **Step 4: Push and re-run**

```bash
node scripts/db-exec.mjs supabase/migrations/20260810000060_only_the_owner_reverses_money.sql && node scripts/_verify-owner-reversal.mjs
```

Expected: every check `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810000060_only_the_owner_reverses_money.sql scripts/_verify-owner-reversal.mjs
git commit -m "feat(reversals): money leaves the business on the owner's say-so"
```

---

## Task 7: The allowance arithmetic on the web

**Files:**
- Create: `apps/web/src/lib/money/allowance.ts`
- Create: `apps/web/src/lib/money/allowance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/money/allowance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeAllowance, type AllowanceLineInput } from './allowance';

// Rs 1,000 ex-VAT at 15% = Rs 1,150 inclusive = 115_000 cents.
const line = (over: Partial<AllowanceLineInput> = {}): AllowanceLineInput => ({
  qty: 1, unitCents: 100_000, vatRatePct: 15, policy: 'free',
  discountKind: 'percent', discountPct: 0, discountAmountCents: 0, ...over,
});

describe('computeAllowance', () => {
  it('gives a service nothing', () => {
    expect(computeAllowance([line({ policy: 'none' })], null).ceilingCents).toBe(0);
  });

  it('gives a carwash 5% of its gross', () => {
    expect(computeAllowance([line({ policy: 'carwash' })], null).ceilingCents).toBe(5_750);
  });

  it('does not count a carwash allowance as free', () => {
    expect(computeAllowance([line({ policy: 'carwash' })], null).freeCents).toBe(0);
  });

  it('gives goods the whole line', () => {
    const r = computeAllowance([line()], null);
    expect(r.ceilingCents).toBe(115_000);
    expect(r.freeCents).toBe(115_000);
  });

  it('sums a mixed document', () => {
    expect(computeAllowance([line({ policy: 'none' }), line()], null).ceilingCents).toBe(115_000);
  });

  it('reports exactly zero on an undiscounted document', () => {
    // The phantom-cent trap: qty 3 is where a naive gross derivation drifts.
    expect(computeAllowance([line({ qty: 3 })], null).actualCents).toBe(0);
  });

  it('counts line and order discounts together', () => {
    const r = computeAllowance(
      [line({ discountKind: 'amount', discountAmountCents: 10_000 })],
      { kind: 'amount', value: 5_000 },
    );
    expect(r.actualCents).toBe(15_000);
  });

  it('knows when a reason is owed', () => {
    const r = computeAllowance([line({ policy: 'carwash', discountPct: 5 })], null);
    expect(r.reasonRequired).toBe(true);
  });

  it('does not ask for a reason when goods cover it', () => {
    const r = computeAllowance([line({ discountPct: 5 })], null);
    expect(r.reasonRequired).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test --workspace web -- allowance
```

Expected: FAIL — `Failed to resolve import "./allowance"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/money/allowance.ts`:

```ts
import { Cents, cents, roundHalfAwayFromZero } from './cents';
import type { DiscountKind, DocDiscount } from './totals';

/**
 * How much of a document may be discounted — the web mirror of
 * app.document_discount_limits (20260810000040). The database is the authority;
 * this keeps the builder honest before the cashier reaches the issue button.
 *
 * Everything is VAT-INCLUSIVE cents, because that is the one unit a percentage
 * discount and a fixed "Rs X off" both share.
 *
 * The gross is derived the way the generated columns derive an UNDISCOUNTED
 * line — round(qty*unit) first, then its VAT — so an undiscounted document
 * reports exactly 0 discount. Computing round(qty*unit*(1+rate/100)) instead
 * drifts a cent on many qty>=2 lines and raises a phantom discount that would
 * demand a reason nobody owes.
 */

export type DiscountPolicy = 'none' | 'carwash' | 'free';

export const CARWASH_MAX_PCT = 5;

export interface AllowanceLineInput {
  qty: number;
  unitCents: number;            // VAT-exclusive unit price
  vatRatePct: number;
  policy: DiscountPolicy;
  discountKind?: DiscountKind;
  discountPct?: number;
  discountAmountCents?: number; // VAT-inclusive
}

export interface Allowance {
  ceilingCents: Cents;   // the most this document may be discounted
  freeCents: Cents;      // how much of that comes from unrestricted goods lines
  actualCents: Cents;    // what it carries, line + order discounts together
  overCeiling: boolean;
  reasonRequired: boolean;
}

/**
 * The effective policy of a line. An explicit product policy wins; 'inherit'
 * defers to the kind. An unknown kind reads as a service, which is the safer
 * default — it withholds a discount rather than granting one.
 */
export function policyOf(
  productPolicy: string | null | undefined,
  effectiveKind: string | null | undefined,
): DiscountPolicy {
  if (productPolicy && productPolicy !== 'inherit') return productPolicy as DiscountPolicy;
  return effectiveKind === 'product' || effectiveKind === 'consumable' ? 'free' : 'none';
}

function grossInclCents(l: AllowanceLineInput): number {
  const excl = roundHalfAwayFromZero(l.qty * l.unitCents);
  return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100);
}

function netInclCents(l: AllowanceLineInput): number {
  const base = l.qty * l.unitCents;
  const excl = l.discountKind === 'amount'
    ? roundHalfAwayFromZero(Math.max(base - (l.discountAmountCents ?? 0) / (1 + l.vatRatePct / 100), 0))
    : roundHalfAwayFromZero(base * (1 - (l.discountPct ?? 0) / 100));
  return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100);
}

/** The most a single line may be discounted, in VAT-inclusive cents. */
export function lineAllowanceCents(l: AllowanceLineInput): number {
  const gross = grossInclCents(l);
  if (l.policy === 'free') return gross;
  if (l.policy === 'carwash') return roundHalfAwayFromZero((gross * CARWASH_MAX_PCT) / 100);
  return 0;
}

export function computeAllowance(
  lines: AllowanceLineInput[],
  docDiscount: DocDiscount | null,
  approvedMaxCents?: number | null,
): Allowance {
  let ceiling = 0;
  let free = 0;
  let lineDisc = 0;
  let postLineGross = 0;

  for (const l of lines) {
    const gross = grossInclCents(l);
    const net = netInclCents(l);
    ceiling += lineAllowanceCents(l);
    if (l.policy === 'free') free += gross;
    lineDisc += Math.max(gross - net, 0);
    postLineGross += net;
  }

  const order = !docDiscount || docDiscount.value <= 0
    ? 0
    : docDiscount.kind === 'percent'
      ? Math.min(roundHalfAwayFromZero((postLineGross * docDiscount.value) / 100), postLineGross)
      : Math.min(docDiscount.value, postLineGross);

  const actual = lineDisc + order;
  const allowed = Math.max(ceiling, approvedMaxCents ?? 0);

  return {
    ceilingCents: cents(ceiling),
    freeCents: cents(free),
    actualCents: cents(actual),
    overCeiling: actual > allowed + 1,          // 1 cent of tolerance, as in SQL
    reasonRequired: approvedMaxCents == null && actual > free + 1,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace web -- allowance
```

Expected: 9 passed.

- [ ] **Step 5: Prove the existing money tests still pass**

```bash
npm test --workspace web
```

Expected: the whole suite green, including `money.test.ts` and `discount.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/money/allowance.ts apps/web/src/lib/money/allowance.test.ts
git commit -m "feat(money): the discount allowance, mirrored on the web"
```

---

## Task 8: The product form states the policy

**Files:**
- Modify: `apps/web/src/features/products/ProductFormModal.tsx`

- [ ] **Step 1: Read the file and find the `kind` control**

```bash
grep -n "kind" apps/web/src/features/products/ProductFormModal.tsx | head -20
```

Note the exact shape of an existing select/field group — the new control must match it, not introduce a new idiom.

- [ ] **Step 2: Add `discountPolicy` to the form state and the payload**

Follow the file's existing pattern for a nullable text column. The field is
`discount_policy`, the four values are `inherit | none | carwash | free`, and the
default for a new product is `inherit`.

- [ ] **Step 3: Add the control**

Render a select immediately after the `kind` control, matching its markup:

```tsx
<label className="block">
  <span className="mb-1 block text-[11px] font-semibold text-muted">Discount</span>
  <select
    value={form.discountPolicy}
    onChange={(e) => setForm({ ...form, discountPolicy: e.target.value })}
    className={selectClass}
  >
    <option value="inherit">Follow the kind — a service gives nothing away</option>
    <option value="carwash">Carwash — up to 5%, with a reason</option>
    <option value="none">Never discounted</option>
    <option value="free">No limit</option>
  </select>
</label>
```

- [ ] **Step 4: Verify in the running app**

Start the preview with the `preview_start` tool (never `npm run dev` in a shell),
open Products, edit `WASH & VACUUM SEDAN`, set Discount to *Carwash*, save, reopen,
and confirm the value stuck. Check the browser console for errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/products/ProductFormModal.tsx
git commit -m "feat(catalogue): the product form states how it may be discounted"
```

---

## Task 9: The builder clamps, explains, and asks

**Files:**
- Modify: `apps/web/src/features/documents/builder/state.ts`
- Modify: `apps/web/src/features/documents/builder/DocumentBuilder.tsx`
- Modify: `apps/web/src/features/documents/payload.ts`
- Modify: `apps/web/src/lib/supabase/queries/builder.ts`

- [ ] **Step 1: Carry the policy and the reason through state**

In `apps/web/src/features/documents/builder/state.ts`, make these four edits.

Add the import and the line field (the line type is at lines 16-18):

```ts
import { policyOf, type DiscountPolicy } from "@/lib/money/allowance";

// …inside the line interface, beside discountAmountCents:
  discountPolicy: DiscountPolicy;  // 'none' | 'carwash' | 'free' — what this line may give away
```

Add the document field beside `docDiscountKind` (lines 35-36):

```ts
  docDiscountReason: string;             // why — required once the discount reaches a carwash allowance
```

Give a newly typed ad-hoc line its policy (line 78 — a typed line has no product, so its
stated `lineKind` decides):

```ts
  return { key: newKey(), productId: null, title: "", description: "", rich: null, unitLabel: "", qty: 1, unitCents: 0, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: policyOf(null, "service"), vatRatePct: 15, lineKind: "service" };
```

Add the action beside `setDocDiscount` (declared at line 89, handled at line 137):

```ts
// with the other action types:
  | { type: "setDiscountReason"; reason: string }

// with the other cases:
    case "setDiscountReason":
      return touched({ ...state, docDiscountReason: action.reason });
```

Finally add both to the dirty-tracking signature at line 43, so editing either still
autosaves — omit them and a reason typed on its own is silently dropped:

```ts
  JSON.stringify({ l: st.lines, c: st.customerId, d: st.docType, sc: st.sectionConfig, cf: st.customFields, cm: st.comment, dk: st.docDiscountKind, dv: st.docDiscountValue, dr: st.docDiscountReason });
```

- [ ] **Step 2: Fetch the policy with the catalogue**

In `apps/web/src/lib/supabase/queries/builder.ts`, add `discount_policy` to the product
select, and map it onto the picked line at `DocumentBuilder.tsx:450` via
`policyOf(p.discountPolicy, p.kind)`.

- [ ] **Step 3: Send the reason**

In `apps/web/src/features/documents/payload.ts`, add `discount_reason` to the document
payload, and pass `state.docDiscountReason` from `DocumentBuilder.tsx:131`.

- [ ] **Step 4: Clamp the line control**

At `DocumentBuilder.tsx:547-565`, cap what the input accepts using
`lineAllowanceCents`. For a `carwash` line the percentage input clamps at
`CARWASH_MAX_PCT`; for a `none` line the control renders disabled with
`title="This service is not discounted — ask the owner"`.

- [ ] **Step 5: Show the ceiling and the reason box**

Beneath the order-discount row at `DocumentBuilder.tsx:735-755`, compute
`computeAllowance(...)` from the same line inputs already assembled at line 182, then:

- when `actualCents > 0`, render the ceiling as help text: `Up to Rs X may be discounted on this bill`;
- when `reasonRequired`, render a required text input bound to `docDiscountReason`
  with placeholder `Why — e.g. regular customer, repeat wash`;
- when `overCeiling`, render an *Ask the owner* button opening the dialog from Task 10,
  and disable the issue action until an approval comes back.

- [ ] **Step 6: Verify in the running app**

With the preview open, build a quote containing one carwash service:

- setting 6% clamps to 5%;
- the reason box appears and the issue button stays disabled while it is empty;
- adding a Rs 200 product line and taking Rs 200 off the order does *not* ask for a reason;
- taking Rs 500 off that same bill offers *Ask the owner*.

Check `read_console_messages` for errors after each.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/documents/builder apps/web/src/features/documents/payload.ts apps/web/src/lib/supabase/queries/builder.ts
git commit -m "feat(builder): the discount controls know what they are allowed to give away"
```

---

## Task 10: The owner-approval route and dialog

**Files:**
- Create: `apps/web/src/app/api/override/route.ts`
- Create: `apps/web/src/features/documents/OwnerOverrideDialog.tsx`

- [ ] **Step 1: Read the Next.js route guide**

`apps/web/AGENTS.md` warns this Next.js is not the one in training data. Before writing
the route, read the route-handler guide under `node_modules/next/dist/docs/` and follow
`apps/web/src/app/api/pos/pin-login/route.ts` as the working local example.

- [ ] **Step 2: Write the route**

Create `apps/web/src/app/api/override/route.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

// The owner approves an exception on the spot: a discount past what the lines
// allow, or a reversal. The PIN is checked inside app.record_owner_override —
// this route only carries it. That keeps the decision in one place rather than
// splitting it between a service-role route and the database.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const appUserId = String(body.appUserId ?? "");
  const pin = String(body.pin ?? "");
  const kind = String(body.kind ?? "");
  const refType = String(body.refType ?? "");
  const refId = String(body.refId ?? "");
  const reason = String(body.reason ?? "").trim();
  const maxDiscountCents = Number(body.maxDiscountCents ?? 0);

  if (!/^[0-9a-f-]{36}$/i.test(appUserId) || !/^[0-9]{4}$/.test(pin)) return json({ error: "bad_request" }, 400);
  if (!["discount", "reversal"].includes(kind)) return json({ error: "bad_request" }, 400);
  if (!["document", "payment"].includes(refType)) return json({ error: "bad_request" }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(refId) || reason === "") return json({ error: "bad_request" }, 400);

  const scope = kind === "discount" ? { max_discount_incl: maxDiscountCents / 100 } : {};

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).schema("app").rpc("record_owner_override", {
    p_app_user_id: appUserId, p_pin: pin, p_kind: kind,
    p_ref_type: refType, p_ref_id: refId, p_reason: reason, p_scope: scope,
  });

  if (error) {
    const msg = String(error.message ?? "");
    // A rejected PIN or a non-owner is the caller's problem, not a server fault.
    if (msg.includes("PIN rejected") || msg.includes("only the owner")) return json({ error: msg }, 401);
    return json({ error: "server_error" }, 500);
  }
  return json({ ok: true, override: data });
}
```

> If `.schema("app").rpc(...)` is not exposed by the installed supabase-js, wrap
> `app.record_owner_override` in a thin `public.record_owner_override(...)` with the same
> signature and grants (service_role only) and call that instead.

- [ ] **Step 3: Write the dialog**

Create `apps/web/src/features/documents/OwnerOverrideDialog.tsx` — an owner picker fed
by the same roster query `/api/pos/roster` uses, a 4-digit PIN input, a reason textarea,
and a submit that POSTs to `/api/override`. Match the markup of an existing dialog in
`apps/web/src/features/documents/` (e.g. `SendDocumentDialog.tsx`) rather than inventing
a new one. On success it calls an `onApproved(maxDiscountCents)` prop so the builder can
re-enable issuing.

- [ ] **Step 4: Verify end to end in the running app**

Build the over-ceiling bill from Task 9, press *Ask the owner*, enter a wrong PIN
(expect a refusal), then the right one, and confirm the document issues. Then confirm in
the database that the approval was recorded and bounded:

```bash
node scripts/q.mjs "select kind, ref_type, scope, reason, created_at from public.owner_overrides order by created_at desc limit 3"
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/override apps/web/src/features/documents/OwnerOverrideDialog.tsx
git commit -m "feat(override): the owner approves an exception at the counter"
```

---

## Task 11: The tablet obeys the same rules

**Files:**
- Create: `android/app/src/main/java/mu/carfection/pos/core/money/Allowance.kt`
- Create: `android/app/src/test/java/mu/carfection/pos/core/money/AllowanceTest.kt`
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt`
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt`

The standing parity rule: a change on one surface lands on both, enforced in the shared
RPC first — which Tasks 1-6 did — then mirrored in each UI.

- [ ] **Step 1: Write the failing Kotlin test**

Create `android/app/src/test/java/mu/carfection/pos/core/money/AllowanceTest.kt` with the
same nine cases as `allowance.test.ts` in Task 7, using the same numbers (a Rs 1,000
ex-VAT line at 15% is 115_000 cents; a carwash allowance on it is 5_750).

- [ ] **Step 2: Run it to verify it fails**

```bash
cd android && ./gradlew testDebugUnitTest --tests "*AllowanceTest*"
```

Expected: compilation failure — `Allowance.kt` does not exist.

- [ ] **Step 3: Port the module**

Create `Allowance.kt` as a direct translation of `allowance.ts`, keeping the function
names (`lineAllowanceCents`, `computeAllowance`, `policyOf`) so the two read as one
implementation. Mirror the comment about the gross derivation — it is the trap.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd android && ./gradlew testDebugUnitTest --tests "*AllowanceTest*"
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Clamp the tablet controls**

At `QuoteScreen.kt:658-680`, the discount presets are a fixed row of percentages. Filter
them by the line's policy: a `carwash` line offers only presets up to 5, a `none` line
renders the whole discount block disabled with the same wording the web uses. Add the
reason field beside the totals block at `QuoteScreen.kt:963`. Repeat for `CounterScreen.kt`.

The tablet must refuse *before* queueing an offline sale. A sale that fails the guard on
replay is a deterministic rejection (`SaleRepository.DETERMINISTIC_ISSUE_REJECTIONS`) and
the cashier has to ring it again — so the clamp is what keeps that from happening.

- [ ] **Step 6: Build and deploy to the emulator**

```bash
cd android && ./gradlew assembleDebug
```

Then install with `adb install -r`. Do not tap coordinates read off a screenshot — dump
the UI tree and tap matched bounds. The emulator holds a live signed-in session and its
taps are real transactions.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/money/Allowance.kt android/app/src/test/java/mu/carfection/pos/core/money/AllowanceTest.kt android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt
git commit -m "feat(pos): the tablet gives away no more than the web does"
```

---

## Task 12: Android ↔ web parity gate

Neither surface is the "main" one. A cashier rings the same sale on the tablet at the
NEOSTRA till and on the web at the back office, and a rule that only one of them enforces
is not a rule. This task is a gate, not a cleanup — do not proceed to Task 13 with a red
row in the table.

The tablet already has **both** discount levels: per line (`SaleRepository.kt:66`,
`DiscountMode.PCT|AMT`) and per order (`SaleRepository.kt:96-97`,
`orderDiscountKind`/`orderDiscountValue`, computed in `core/money/Money.kt:83` as
`orderDiscountInclCents`). So every row below applies to both.

- [ ] **Step 1: Walk the table and mark each cell**

| Capability | Web | Android |
|---|---|---|
| Line discount clamped to the line's allowance | `DocumentBuilder.tsx:547-565` | `QuoteScreen.kt:658-680`, `CounterScreen.kt` |
| A `none` service shows a disabled control, same wording | `DocumentBuilder.tsx` | `QuoteScreen.kt`, `CounterScreen.kt` |
| A `carwash` line caps at 5% | `CARWASH_MAX_PCT` | `CARWASH_MAX_PCT` |
| Order discount capped by the document ceiling | `DocumentBuilder.tsx:735-755` | `SaleRepository.kt` order-discount path |
| Ceiling shown as help text, same wording | `DocumentBuilder.tsx` | `QuoteScreen.kt:963` totals block |
| Reason field appears on the same condition | `reasonRequired` | `reasonRequired` |
| Reason reaches the RPC as `discount_reason` | `payload.ts` | `SaleRepository.kt:378` doc payload |
| Owner override dialog: picker, PIN, reason | `OwnerOverrideDialog.tsx` | tablet equivalent |
| Override result re-enables issuing | `DocumentBuilder.tsx` | `QuoteViewModel`/`CounterViewModel` |
| Same refusal wording surfaced to the cashier | error text from the RPC | error text from the RPC |

- [ ] **Step 2: Prove the two allowance modules agree, on the same numbers**

The web and Kotlin modules are separate implementations of one rule, so they can drift
silently. Assert the identical fixtures in both, and confirm the outputs match:

```bash
npm test --workspace web -- allowance
```

```bash
cd android && ./gradlew testDebugUnitTest --tests "*AllowanceTest*"
```

Both suites must contain the same nine cases with the same expected integers
(115_000-cent line, 5_750-cent carwash allowance, 0 on an undiscounted qty-3 line). If a
case exists on one side only, add it to the other — a missing case *is* the drift.

- [ ] **Step 3: Confirm the shared authority is genuinely shared**

Both clients must be advisory only; the refusal itself comes from the database. Prove no
path skips it:

```bash
node scripts/q.mjs "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('issue_document','save_draft') and position('assert_discount_allowed' in pg_get_functiondef(p.oid)) > 0"
```

Expected: exactly `issue_document`. `save_draft` must **not** appear — a draft is allowed
to hold an over-limit discount so the cashier can go and fetch approval.

- [ ] **Step 4: Exercise the same bill on both surfaces**

Ring an identical basket — one carwash service plus one product — on the web preview and
on the emulator, and confirm both:

1. clamp a 6% carwash discount to 5%;
2. demand a reason before issuing;
3. offer the owner override at the same threshold, not one rupee apart.

On the emulator, dump the UI tree and tap matched bounds. Never tap coordinates read off
a screenshot — that session is signed in and its taps are real transactions.

- [ ] **Step 5: Record the result**

Write the completed table into the commit message. If a row cannot be made green, stop
and report which surface is behind rather than marking the task done.

```bash
git commit --allow-empty -m "test(parity): the tablet and the web give away the same amount"
```

---

## Task 13: Prove the whole thing together

- [ ] **Step 1: Run every probe**

```bash
node scripts/_verify-discount-allowance.mjs && node scripts/_verify-owner-override.mjs && node scripts/_verify-owner-reversal.mjs && node scripts/verify-money-path.mjs
```

Expected: four `ALL GOOD` reports.

- [ ] **Step 2: Run both unit suites**

```bash
npm test --workspace web
```

```bash
cd android && ./gradlew testDebugUnitTest
```

Expected: both green.

- [ ] **Step 3: Tag the seven wash services**

The rules do nothing until the owner's carwash items are tagged. Confirm which they are
before writing:

```bash
node scripts/q.mjs "select p.id, b.trading_name, p.name from products p join business_settings b on b.id = p.tenant_id where p.is_active and p.kind='service' and (p.name ilike '%wash%' or p.name ilike '%vacuum%') order by b.trading_name, p.name"
```

Expected seven names per tenant: `TOUCHLESS FOAM WASH`, `TOUCHLESS FOAM WASH SEDAN`,
`VACUUM ONLY SUV`, and the four `WASH & VACUUM` sizes — once under `Carfectionist` and
once under `Carfectionist Sandbox`. Those are two tenants, **not** a duplicated catalogue;
scope the query and the rows come out singly.

Tag the real tenant's rows so the shop's rules bite, and the sandbox's too so testing
behaves the same. Hand the list to the owner to confirm before relying on it — a service
they consider a wash but is not on this list will be frozen by rule 1.

- [ ] **Step 4: Commit anything outstanding and report**

State plainly which probes ran and what they printed. Do not claim the feature works on
the strength of a compile.
