# Quotation-only devices — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner mark a tablet "Quotation only" so it never opens a till — the database refuses the session, and the tablet drops Checkout and lands on Intake.

**Architecture:** One boolean on the `devices` row (`takes_payments`, default `true`) enforced at the single choke point both web and Android already call, `open_cash_session`. `register_device` — which the tablet calls at login and every 4-minute heartbeat — already returns the device row, so the flag rides back with no new endpoint. The tablet caches it in DataStore and adapts its nav.

**Tech Stack:** Postgres/Supabase RPCs (`security definer`), Next.js server actions + React, Kotlin/Jetpack Compose with Hilt + DataStore, JUnit for the Android unit tests, `pg` + `BEGIN/ROLLBACK` probes for the DB tests.

**Spec:** [docs/superpowers/specs/2026-08-03-quotation-only-devices-design.md](../specs/2026-08-03-quotation-only-devices-design.md)

---

## Environment notes (read before Task 1)

- **The sandbox blocks port 5432.** Every `node scripts/*.mjs` command in this plan that
  touches the database must be run with the sandbox disabled, or it will hang and then fail
  with a connection error. In Claude Code that means `dangerouslyDisableSandbox: true` on
  the Bash call.
- `scripts/_env.mjs` reads `SUPABASE_DB_URL` from the repo `.env`. If you are working in a
  git worktree, copy `.env` into it first — the scripts do not walk up to the main checkout.
- Migrations are applied with `node scripts/db-exec.mjs <path>`. The Supabase CLI is not
  linked to this project.
- Android builds: `cd android && ./gradlew testDebugUnitTest` for unit tests,
  `./gradlew assembleDebug` for the APK.

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260803000020_quotation_only_devices.sql` | **Create.** The column, `set_device_takes_payments`, and the guard inside `open_cash_session`. |
| `scripts/_verify-quotation-devices.mjs` | **Create.** Rolled-back DB probe: default, guard, flip refusal, unregistered devices. |
| `apps/web/src/lib/supabase/rpc.ts` | **Modify.** `DeviceRow.takes_payments` + `setDeviceTakesPayments` helper. |
| `apps/web/src/lib/supabase/queries/pos-devices.ts` | **Modify.** `PosDevice.takesPayments` at all three construction sites. |
| `apps/web/src/features/pos/actions.ts` | **Modify.** `setDeviceTakesPaymentsAction`. |
| `apps/web/src/features/pos/DeviceSettings.tsx` | **Modify.** The owner's switch. |
| `apps/web/src/features/pos/DeviceCards.tsx` | **Modify.** "Quotation only" badge; no "Till closed" for such a device. |
| `android/.../core/data/DeviceRole.kt` | **Create.** Pure parser + the two pure nav decisions. Testable without Android. |
| `android/.../core/data/DeviceRoleRepository.kt` | **Create.** DataStore cache of the flag. |
| `android/.../core/network/PosApi.kt` | **Modify.** `registerDevice` returns the row instead of discarding it. |
| `android/.../ui/PosShell.kt` | **Modify.** `PosShell`/`NavRail` take the visible tab list. |
| `android/.../ui/PosNavHost.kt` | **Modify.** Landing tab, nav guard, skip `openSession`, remember the flag. |
| `android/.../feature/quote/QuoteViewModel.kt` + `QuoteScreen.kt` | **Modify.** Deposit notice instead of the Checkout jump. |
| `android/.../feature/jobs/JobsViewModel.kt` + `JobsScreen.kt` | **Modify.** "Raise the invoice →" instead of "Go to checkout →". |
| `android/app/src/test/.../core/data/DeviceRoleTest.kt` | **Create.** Unit tests for the pure decisions. |

---

## Task 1: The database flag and its guard

**Files:**
- Create: `supabase/migrations/20260803000020_quotation_only_devices.sql`
- Create: `scripts/_verify-quotation-devices.mjs`

- [ ] **Step 1: Write the failing probe**

Create `scripts/_verify-quotation-devices.mjs`. It impersonates the owner, exercises every
rule, and rolls back — nothing persists. `AUTH` is Anesh's auth uid, copied from the
existing `scripts/_verify-pos-devices.mjs`.

```javascript
// Rolled-back verification for quotation-only devices
// (20260803000020_quotation_only_devices.sql). Runs as `authenticated`
// impersonating the owner, then ROLLS BACK — nothing persists.
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
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: AUTH, role: "authenticated" })]);

  console.log("▸ a newly registered device takes payments");
  const dev = (await c.query("select * from public.register_device('TAB-QO1', 'SM-X200', '1.9.0', false)")).rows[0];
  check("takes_payments defaults true", dev.takes_payments, "true");

  console.log("▸ a paying device opens a till normally");
  const sid = (await c.query("select id from public.open_cash_session('TAB-QO1', 500)")).rows[0].id;
  check("session opened", sid != null, "true");

  console.log("▸ the switch is refused while that device holds an open session");
  try {
    await c.query("savepoint sp0");
    await c.query("select public.set_device_takes_payments($1::uuid, false)", [dev.id]);
    check("flip refused with a session open", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp0");
    check("flip refused with a session open", "refused", "refused");
    check("message names the fix", /close the open service/.test(e.message), "true");
  }

  console.log("▸ close the service, then the switch is allowed");
  await c.query("select public.close_cash_session($1::uuid, 500)", [sid]);
  const off = (await c.query("select takes_payments from public.set_device_takes_payments($1::uuid, false)", [dev.id])).rows[0];
  check("switched to quotation only", off.takes_payments, "false");
  const audit = await c.query(
    "select count(*)::int n from audit_events where event_type='device_payments_disabled' and device_id='TAB-QO1'");
  check("device_payments_disabled audited", audit.rows[0].n, 1);

  console.log("▸ a quotation device cannot open a till");
  try {
    await c.query("savepoint sp1");
    await c.query("select public.open_cash_session('TAB-QO1', 500)");
    check("till refused on a quotation device", "allowed", "refused");
  } catch (e) {
    await c.query("rollback to savepoint sp1");
    check("till refused on a quotation device", "refused", "refused");
    check("message names the paying terminal", /does not take payments/.test(e.message), "true");
  }

  console.log("▸ unregistered device codes are unaffected");
  const unreg = (await c.query("select id from public.open_cash_session('TAB-QO-UNREG', 100)")).rows[0].id;
  check("unregistered device still opens", unreg != null, "true");

  console.log("▸ switching back restores the till");
  const on = (await c.query("select takes_payments from public.set_device_takes_payments($1::uuid, true)", [dev.id])).rows[0];
  check("switched back", on.takes_payments, "true");
  const sid2 = (await c.query("select id from public.open_cash_session('TAB-QO1', 500)")).rows[0].id;
  check("opens again", sid2 != null, "true");

  await c.query("rollback");
  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`} (rolled back — nothing persisted)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("✗ verify error:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run (sandbox disabled):

```bash
node scripts/_verify-quotation-devices.mjs
```

Expected: `✗ verify error: column "takes_payments" does not exist` — or a failure on the
very first check. Either proves the probe is testing something that is not there yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260803000020_quotation_only_devices.sql`. The
`open_cash_session` body below is the current definition from
`20260714000006_close_service_day.sql:18` with one `if exists` block added — copy it
exactly, do not paraphrase the rest.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — a device that does not take money is never asked to open a till
--
-- The Samsung is reception's tablet: intake, quotations, jobs. It never charges
-- anyone. But Checkout was its landing screen and showed "Till closed — open it"
-- in warning orange, so staff opened a session out of habit, nobody closed it,
-- and the forgotten service is exactly what 20260730000040_stale_till_guard.sql
-- was written for — a till trading on yesterday's day.
--
-- A switch the staff can flip themselves does not break a staff habit. So the
-- fact lives on the device row and the refusal lives in open_cash_session, the
-- one choke point web and Android already share.
--
-- Defaults to true: every device registered today keeps behaving exactly as it
-- does now until the owner flips one in Points of Sale → device → Settings.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.devices
  add column if not exists takes_payments boolean not null default true;

comment on column public.devices.takes_payments is
  'false = quotation-only terminal: open_cash_session refuses it and the tablet hides Checkout.';

-- ── set_device_takes_payments (owner/manager, Settings tab) ─────────────────
-- Refuses to switch OFF while the device holds an open session: the flip would
-- strand that session on a tablet whose till screen has just disappeared —
-- open forever, closable from nowhere.
create or replace function public.set_device_takes_payments(p_device_id uuid, p_takes boolean)
returns public.devices language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := app.current_app_user_id();
  v_dev    public.devices;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager');

  select * into v_dev from public.devices
   where id = p_device_id and tenant_id = v_tenant for update;
  if not found then raise exception 'device not found'; end if;

  if p_takes = false and exists (
    select 1 from public.cash_sessions
     where tenant_id = v_tenant and device_id = v_dev.device_code and status = 'open'
  ) then
    raise exception 'close the open service on this device first — it still holds today''s takings';
  end if;

  update public.devices set takes_payments = p_takes
   where id = v_dev.id
   returning * into v_dev;

  insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload, device_id)
  values (v_tenant, v_actor,
          case when p_takes then 'device_payments_enabled' else 'device_payments_disabled' end,
          'device', v_dev.id, jsonb_build_object('device_code', v_dev.device_code), v_dev.device_code);

  return v_dev;
end $$;
revoke execute on function public.set_device_takes_payments(uuid, boolean) from public;
grant  execute on function public.set_device_takes_payments(uuid, boolean) to authenticated;

-- ── open_cash_session: the refusal ─────────────────────────────────────────
-- Unchanged from 20260714000006 except the takes_payments block. Scoped to
-- REGISTERED devices by construction: 'back-office' and any pre-registry
-- device code have no devices row, match nothing, and are unaffected.
create or replace function public.open_cash_session(p_device_id text, p_opening_float numeric)
returns cash_sessions language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_day    public.trading_days;
  v_dev    text := coalesce(nullif(p_device_id, ''), 'back-office');
  v_no     int;
  v_sess   public.cash_sessions;
begin
  if v_tenant is null then raise exception 'no tenant context'; end if;
  perform app.require_role('owner','manager','cashier');
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'count the opening float before opening the till';
  end if;

  if exists (select 1 from public.devices
              where tenant_id = v_tenant and device_code = v_dev
                and takes_payments = false) then
    raise exception 'this device does not take payments — open the till on the paying terminal';
  end if;

  -- Opens today's day if the shop has not opened yet; refuses if the day was closed.
  select * into v_day from app.open_trading_day(v_tenant);

  if exists (select 1 from public.cash_sessions
              where tenant_id = v_tenant and device_id = v_dev and status = 'open') then
    raise exception 'this till is already open';
  end if;

  select coalesce(max(service_no), 0) + 1 into v_no
    from public.cash_sessions where trading_day_id = v_day.id;

  insert into public.cash_sessions (tenant_id, device_id, opened_by, opening_float, trading_day_id, service_no)
  values (v_tenant, v_dev, app.current_app_user_id(), p_opening_float, v_day.id, v_no)
  returning * into v_sess;

  return v_sess;
end $function$;
```

- [ ] **Step 4: Apply the migration**

Run (sandbox disabled):

```bash
node scripts/db-exec.mjs supabase/migrations/20260803000020_quotation_only_devices.sql
```

Expected: `✓ Done.`

- [ ] **Step 5: Run the probe to verify it passes**

Run (sandbox disabled):

```bash
node scripts/_verify-quotation-devices.mjs
```

Expected: every line prefixed `✓`, ending with
`✓ ALL CHECKS PASSED (rolled back — nothing persisted)`.

If "flip refused with a session open" fails as *allowed*, the `p_takes = false and exists`
block is wrong. If "unregistered device still opens" fails, the guard is matching devices
it should not — check the `device_code = v_dev` join.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803000020_quotation_only_devices.sql scripts/_verify-quotation-devices.mjs
git commit -m "feat(pos): a device can be marked as never taking money"
```

---

## Task 2: Web data layer — the flag reaches the back office

**Files:**
- Modify: `apps/web/src/lib/supabase/rpc.ts:248-267`
- Modify: `apps/web/src/lib/supabase/queries/pos-devices.ts:23-35, 133-172`
- Modify: `apps/web/src/features/pos/actions.ts:43-56`

- [ ] **Step 1: Add the row field and the RPC helper**

In `apps/web/src/lib/supabase/rpc.ts`, add `takes_payments` to the `DeviceRow` interface,
after `is_active`:

```ts
  is_active: boolean;
  takes_payments: boolean;
```

Then add the helper immediately after `setDeviceActive`:

```ts
export const setDeviceTakesPayments = (sb: Client, deviceId: string, takes: boolean) =>
  callRpc<DeviceRow>(sb, "set_device_takes_payments", { p_device_id: deviceId, p_takes: takes });
```

- [ ] **Step 2: Carry it onto `PosDevice`**

In `apps/web/src/lib/supabase/queries/pos-devices.ts`, add the field to the interface after
`isActive`:

```ts
  isActive: boolean;
  takesPayments: boolean; // false = quotation-only terminal; never opens a till
```

There are exactly **three** places a `PosDevice` is built. Update all three.

Registered devices (`deviceRows.map`) — `!== false` so a row read before the column
existed still reads as a paying till:

```ts
    isActive: !!d.is_active,
    takesPayments: d.takes_payments !== false,
```

The back office (`devices.unshift`):

```ts
    isActive: true,
    takesPayments: true,
```

The synthesized pre-registry entry:

```ts
        isActive: true, isBackOffice: false, online: false, takesPayments: true,
```

`getDeviceDashboard` reads its device out of `getPosOverview`, so it needs no change.

- [ ] **Step 3: Add the server action**

In `apps/web/src/features/pos/actions.ts`, after `setDeviceActiveAction`:

```ts
// Quotation-only terminals (reception's tablet): the RPC refuses the switch while
// the device still holds an open session, and its message is the useful one —
// surface it rather than a generic failure.
const takesPaymentsSchema = z.object({ deviceId: z.string(), takesPayments: z.boolean() });
export async function setDeviceTakesPaymentsAction(input: z.infer<typeof takesPaymentsSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = takesPaymentsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  try {
    await rpc.setDeviceTakesPayments(sb, p.data.deviceId, p.data.takesPayments);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}
```

- [ ] **Step 4: Typecheck**

Run:

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. If it reports `takesPayments` missing on an object literal, you have
missed one of the three construction sites.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/rpc.ts apps/web/src/lib/supabase/queries/pos-devices.ts apps/web/src/features/pos/actions.ts
git commit -m "feat(pos): the back office reads whether a device takes money"
```

---

## Task 3: Web UI — the owner's switch

**Files:**
- Modify: `apps/web/src/features/pos/DeviceSettings.tsx`
- Modify: `apps/web/src/features/pos/DeviceCards.tsx:139, 158`

- [ ] **Step 1: Add the switch to the device settings page**

In `apps/web/src/features/pos/DeviceSettings.tsx`, import the new action alongside the
existing two:

```ts
import { renameDeviceAction, setDeviceActiveAction, setDeviceTakesPaymentsAction } from "./actions";
```

Add the handler beside `toggleActive`:

```ts
  async function toggleTakesPayments() {
    if (!device.id) return;
    setError(null);
    setBusy(true);
    const r = await setDeviceTakesPaymentsAction({ deviceId: device.id, takesPayments: !device.takesPayments });
    setBusy(false);
    if (r.ok) router.refresh(); else setError(r.error);
  }
```

Insert this card between the name card and the active card (i.e. immediately after the
closing `</div>` of the "Device name" card):

```tsx
          <div className="rounded-[15px] border border-line bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold text-ink">
                  {device.takesPayments ? "This device takes payments" : "Quotation only"}
                </div>
                <p className="mt-0.5 text-[12px] text-muted">
                  {device.takesPayments
                    ? "Opens a till and collects money. Checkout is on the tablet."
                    : "Never opens a till. Reception, quotations and jobs only — money is taken at a paying terminal."}
                </p>
              </div>
              <button
                onClick={toggleTakesPayments}
                disabled={busy}
                className="h-9 shrink-0 rounded-[10px] border border-line-2 px-3.5 text-[12.5px] font-bold text-body hover:border-brand disabled:opacity-60"
              >
                {device.takesPayments ? "Make quotation only" : "Let it take payments"}
              </button>
            </div>
          </div>
```

- [ ] **Step 2: Badge it on the device list**

In `apps/web/src/features/pos/DeviceCards.tsx`, add a badge beside the existing `Inactive`
badge (the line reading `{!device.isActive && <span ...>Inactive</span>}`):

```tsx
            {!device.takesPayments && <span className="rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-faint">Quotation only</span>}
```

- [ ] **Step 3: Stop reporting a closed till for a device that never opens one**

Still in `DeviceCards.tsx`, the card body is a ternary chain
`device.till ? (…) : device.isBackOffice ? (…) : (…)`. Find the single line reading
`      ) : device.isBackOffice ? (` and **replace that one line** with the three lines
below, inserting a branch ahead of it so a quotation device explains itself instead of
reporting till state:

```tsx
      ) : !device.takesPayments ? (
        <div className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
          Quotation only — this device never opens a till. Money for its quotes and jobs is taken at a paying terminal.
        </div>
      ) : device.isBackOffice ? (
```

- [ ] **Step 4: Typecheck and lint**

Run:

```bash
cd apps/web && npx tsc --noEmit && npx eslint src/features/pos
```

Expected: no errors.

- [ ] **Step 5: Verify in the browser**

Mint an owner session and open the Points of Sale page:

```bash
node scripts/_mint-session.mjs
```

Then start the dev server via the preview tool (never `npm run dev` in Bash), open
`/point-of-sale`, click into a device, and confirm: the new card appears, the button
switches the device, the list shows the "Quotation only" badge, and the card body no longer
says the till is closed. Switch it back before moving on.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/pos/DeviceSettings.tsx apps/web/src/features/pos/DeviceCards.tsx
git commit -m "feat(pos): the owner marks a tablet quotation only from its settings"
```

---

## Task 4: Android — the tablet learns its role

**Files:**
- Create: `android/app/src/main/java/mu/carfection/pos/core/data/DeviceRole.kt`
- Create: `android/app/src/main/java/mu/carfection/pos/core/data/DeviceRoleRepository.kt`
- Create: `android/app/src/test/java/mu/carfection/pos/core/data/DeviceRoleTest.kt`
- Modify: `android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt:346-353`

- [ ] **Step 1: Write the failing test**

Create `android/app/src/test/java/mu/carfection/pos/core/data/DeviceRoleTest.kt`:

```kotlin
package mu.carfection.pos.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import mu.carfection.pos.ui.PosTab

/**
 * A tablet that never charges anyone must not be asked to open a till. The role
 * comes back on register_device; everything here is the decision it drives.
 *
 * The default matters more than it looks: a real till that has never reached the
 * server, or is offline on first launch, must still be able to sell. Unknown
 * therefore means "takes payments" — failing safe means failing toward selling.
 */
class DeviceRoleTest {

    private fun row(json: String): JsonObject = Json.parseToJsonElement(json) as JsonObject

    @Test
    fun `reads the flag off the device row`() {
        assertTrue(takesPaymentsOf(row("""{"device_code":"TAB-1","takes_payments":true}""")))
        assertFalse(takesPaymentsOf(row("""{"device_code":"TAB-1","takes_payments":false}""")))
    }

    @Test
    fun `anything unreadable means the device takes payments`() {
        assertTrue("no row at all", takesPaymentsOf(null))
        assertTrue("column absent (older server)", takesPaymentsOf(row("""{"device_code":"TAB-1"}""")))
        assertTrue("null value", takesPaymentsOf(row("""{"takes_payments":null}""")))
        assertTrue("wrong type", takesPaymentsOf(row("""{"takes_payments":{"a":1}}""")))
    }

    @Test
    fun `a quotation device has no Checkout tab`() {
        assertTrue("a till keeps every tab", visibleTabs(true) == PosTab.entries.toList())
        assertFalse("Checkout is gone", visibleTabs(false).contains(PosTab.SALE))
        assertEquals("nothing else is lost", PosTab.entries.size - 1, visibleTabs(false).size)
    }

    @Test
    fun `a quotation device lands on Intake`() {
        assertEquals(PosTab.SALE, landingTab(true))
        assertEquals(PosTab.INTAKE, landingTab(false))
    }

    @Test
    fun `a live switch moves an operator off Checkout, and leaves them alone otherwise`() {
        assertEquals("sitting on Checkout when the switch flips", PosTab.INTAKE, tabAfterRoleChange(PosTab.SALE, false))
        assertEquals("sitting elsewhere — do not yank them", PosTab.JOBS, tabAfterRoleChange(PosTab.JOBS, false))
        assertEquals("a till is never moved", PosTab.SALE, tabAfterRoleChange(PosTab.SALE, true))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
cd android && ./gradlew testDebugUnitTest --tests "*DeviceRoleTest*"
```

Expected: compilation failure — `Unresolved reference: takesPaymentsOf` (and the other
three).

- [ ] **Step 3: Write the pure decisions**

Create `android/app/src/main/java/mu/carfection/pos/core/data/DeviceRole.kt`:

```kotlin
package mu.carfection.pos.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import mu.carfection.pos.ui.PosTab

/**
 * Does this tablet take money?
 *
 * Reception's tablet does not — it takes cars in, builds quotations, and sends them.
 * The owner marks it "Quotation only" in Points of Sale; `register_device` returns the
 * flag on login and on every heartbeat, so a switch flipped on the web reaches the
 * tablet within minutes without a re-login.
 *
 * Unknown means TRUE. A real till that has never reached the server, or is offline on
 * first launch, must still be able to sell — so the fallback fails toward selling, not
 * toward a dead counter.
 */
fun takesPaymentsOf(row: JsonObject?): Boolean =
    runCatching { row?.get("takes_payments")?.jsonPrimitive?.booleanOrNull }.getOrNull() ?: true

/** The nav rail. A device that cannot take money has no business showing Checkout. */
fun visibleTabs(takesPayments: Boolean): List<PosTab> =
    if (takesPayments) PosTab.entries.toList() else PosTab.entries.filter { it != PosTab.SALE }

/** Where the app opens, and where a sign-out returns to. */
fun landingTab(takesPayments: Boolean): PosTab =
    if (takesPayments) PosTab.SALE else PosTab.INTAKE

/**
 * The role can change under a running app (the owner flips the switch; the heartbeat
 * brings it back). Move the operator off a tab that just disappeared — and only then.
 */
fun tabAfterRoleChange(current: PosTab, takesPayments: Boolean): PosTab =
    if (!takesPayments && current == PosTab.SALE) PosTab.INTAKE else current
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd android && ./gradlew testDebugUnitTest --tests "*DeviceRoleTest*"
```

Expected: `BUILD SUCCESSFUL`, 5 tests passing.

- [ ] **Step 5: Write the repository**

Create `android/app/src/main/java/mu/carfection/pos/core/data/DeviceRoleRepository.kt`:

```kotlin
package mu.carfection.pos.core.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * This device's role, cached on disk.
 *
 * Kept rather than asked for, because the answer decides which tabs exist and the shell
 * is built before any network call resolves — and because a tablet that boots during an
 * outage must still know what it is. Refreshed on every register_device call (login, then
 * every four minutes), so flipping the switch on the web lands here on its own.
 */
@Singleton
class DeviceRoleRepository @Inject constructor(
    private val prefs: DataStore<Preferences>,
) {
    private val key = booleanPreferencesKey("device_takes_payments")

    /** Defaults to true — see [takesPaymentsOf]: unknown fails toward being able to sell. */
    val takesPayments: Flow<Boolean> = prefs.data.map { it[key] ?: true }

    suspend fun remember(takes: Boolean) = prefs.edit { it[key] = takes }
}
```

- [ ] **Step 6: Return the device row from `registerDevice`**

In `android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt`, replace the
existing `registerDevice` (line 346) with:

```kotlin
    /**
     * Returns the device row so the caller can read its role (takes_payments). Decoding is
     * tolerant on purpose: registration is an observation and the row is written server-side
     * either way, so a shape we cannot parse must not read as a failed registration.
     */
    suspend fun registerDevice(
        code: String,
        model: String?,
        version: String?,
        heartbeat: Boolean,
    ): kotlinx.serialization.json.JsonObject? {
        val res = client.postgrest.rpc("register_device", buildJsonObject {
            put("p_code", code)
            if (model != null) put("p_model", model) else put("p_model", JsonNull)
            if (version != null) put("p_version", version) else put("p_version", JsonNull)
            put("p_heartbeat", heartbeat)
        })
        return runCatching { res.decodeAs<kotlinx.serialization.json.JsonObject>() }.getOrNull()
    }
```

- [ ] **Step 7: Compile**

Run:

```bash
cd android && ./gradlew compileDebugKotlin
```

Expected: `BUILD SUCCESSFUL`. The existing call site in `PosNavHost.kt` ignores the return
value, so it still compiles unchanged.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/core/data/DeviceRole.kt android/app/src/main/java/mu/carfection/pos/core/data/DeviceRoleRepository.kt android/app/src/test/java/mu/carfection/pos/core/data/DeviceRoleTest.kt android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt
git commit -m "feat(pos): the tablet learns whether it is a till or a quotation pad"
```

---

## Task 5: Android — no Checkout tab, land on Intake

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/ui/PosShell.kt:89-103, 225-255`
- Modify: `android/app/src/main/java/mu/carfection/pos/ui/PosNavHost.kt:47-215, 252-271`

- [ ] **Step 1: Let the shell take a tab list**

In `PosShell.kt`, add a `tabs` parameter to `PosShell` after `onSelect`:

```kotlin
fun PosShell(
    active: PosTab,
    onSelect: (PosTab) -> Unit,
    tabs: List<PosTab>,
    studioName: String,
```

and pass it down where `NavRail` is called inside `PosShell`:

```kotlin
            NavRail(active, tabs, onSelect)
```

Then change `NavRail`'s signature and the one line that enumerates tabs. Find the
declaration (it takes `active` and `onSelect`) and make it:

```kotlin
private fun NavRail(active: PosTab, tabs: List<PosTab>, onSelect: (PosTab) -> Unit) {
```

and replace `PosTab.entries.forEach { tab ->` with:

```kotlin
        tabs.forEach { tab ->
```

- [ ] **Step 2: Hold the role on the root view model**

In `PosNavHost.kt`, add the repository to `RootViewModel`'s constructor after `tillRepo`:

```kotlin
    private val tillRepo: mu.carfection.pos.core.data.TillRepository,
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
) : ViewModel() {
```

and expose it as state, next to `val till = tillRepo.current`:

```kotlin
    /** False on reception's tablet: no Checkout, no till, money is taken elsewhere. */
    val takesPayments = deviceRole.takesPayments.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, true)
```

Add the import at the top of the file:

```kotlin
import kotlinx.coroutines.flow.stateIn
```

- [ ] **Step 3: Guard navigation and the landing tab**

Still in `RootViewModel`, change `navigate` and `resetNav`:

```kotlin
    fun navigate(next: PosTab) {
        if (next == PosTab.SALE && !takesPayments.value) return // the tab does not exist here
        if (next != _tab.value) {
            backStack.addLast(_tab.value)
            if (backStack.size > 24) backStack.removeFirst()
            _backDepth.value = backStack.size
            _tab.value = next
        }
        _showTill.value = false
    }
```

```kotlin
    private fun resetNav() {
        backStack.clear(); _backDepth.value = 0
        _tab.value = mu.carfection.pos.core.data.landingTab(takesPayments.value)
        _showTill.value = false
    }
```

Then add an `init` block that reacts to the role resolving or changing — this is what moves
the operator off Checkout at startup, since `_tab` is constructed before DataStore answers:

```kotlin
    init {
        // The role arrives from disk (and then the server) after this ViewModel is built, so
        // the shell starts on SALE and is corrected here. Also covers a live switch: the
        // owner flips it on the web and the heartbeat brings it back within four minutes.
        viewModelScope.launch {
            takesPayments.collect { takes ->
                val next = mu.carfection.pos.core.data.tabAfterRoleChange(_tab.value, takes)
                if (next != _tab.value) {
                    _tab.value = next
                    backStack.clear(); _backDepth.value = 0
                    _showTill.value = false
                }
            }
        }
    }
```

- [ ] **Step 4: Stop asking for a till, and remember the role**

In the `init` block that loads the till on sign-in, skip the call entirely on a quotation
device — there is no session to find and nothing that could use one:

```kotlin
        // Load this device's open till on sign-in — the state that drives the checkout chip.
        // A quotation device has none and never will, so it does not ask.
        viewModelScope.launch {
            session.isLoggedIn.collect { logged ->
                _tillLoaded.value = false
                if (logged == true) {
                    if (takesPayments.value) runCatching { tillRepo.openSession() }
                    _tillLoaded.value = true
                }
            }
        }
```

In the device-registry `init` block, stop discarding the row and store the role — both on
the announce and on every heartbeat:

```kotlin
        viewModelScope.launch {
            var announced = false
            session.isLoggedIn.collectLatest { logged ->
                if (logged == true) {
                    runCatching {
                        api.registerDevice(session.deviceId(), Build.MODEL, BuildConfig.VERSION_NAME, heartbeat = announced)
                    }.getOrNull()?.let { deviceRole.remember(mu.carfection.pos.core.data.takesPaymentsOf(it)) }
                    announced = true
                    while (true) {
                        delay(HEARTBEAT_MS)
                        runCatching { api.registerDevice(session.deviceId(), null, null, heartbeat = true) }
                            .getOrNull()?.let { deviceRole.remember(mu.carfection.pos.core.data.takesPaymentsOf(it)) }
                    }
                }
            }
        }
```

- [ ] **Step 5: Pass the tab list to the shell**

In `PosApp`, collect the role and hand the filtered list to `PosShell`. Add the collection
beside the other `collectAsState` calls in the `true ->` branch:

```kotlin
                val takesPayments by rootViewModel.takesPayments.collectAsState()
```

and add the argument to the `PosShell(` call, immediately after `onSelect`:

```kotlin
                    onSelect = rootViewModel::navigate,
                    tabs = mu.carfection.pos.core.data.visibleTabs(takesPayments),
```

- [ ] **Step 6: Build and run the unit tests**

Run:

```bash
cd android && ./gradlew testDebugUnitTest
```

Expected: `BUILD SUCCESSFUL`, the whole suite green including `DeviceRoleTest`.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/ui/PosShell.kt android/app/src/main/java/mu/carfection/pos/ui/PosNavHost.kt
git commit -m "feat(pos): a quotation tablet opens on Intake and has no Checkout tab"
```

---

## Task 6: Android — deposits and ready jobs still reach the till

**Files:**
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteViewModel.kt:1017`
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteScreen.kt:118-121, 552-563`
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/jobs/JobsViewModel.kt:762-773`
- Modify: `android/app/src/main/java/mu/carfection/pos/feature/jobs/JobsScreen.kt:589`

Nothing about *raising* the bill changes. The deposit invoice and the ready job's invoice
are still created exactly as today — only the hand-off to a Checkout tab that no longer
exists is replaced by telling the operator where the money is collected.

- [ ] **Step 1: Expose the role on the quote state**

In `QuoteViewModel.kt`, add the repository to the constructor beside `collectBus`:

```kotlin
    private val collectBus: mu.carfection.pos.core.data.CollectBus,
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
```

Add the field to `QuoteState` (beside `depositPending`):

```kotlin
    /** False on reception's tablet — the deposit is collected at a paying terminal. */
    val takesPayments: Boolean = true,
```

Add an `init` collector to the view model so the state follows the role:

```kotlin
    init {
        viewModelScope.launch { deviceRole.takesPayments.collect { t -> _s.update { it.copy(takesPayments = t) } } }
    }
```

- [ ] **Step 2: Only hand the bill to Checkout when there is one**

In `QuoteViewModel.kt`, replace the `collectBus.request` line (currently line 1017):

```kotlin
                // Hand the bill to Checkout with the deposit already dialled in. The cashier
                // still presses the button — the customer's money is theirs to take, not ours.
                // On a quotation tablet there is no Checkout: the invoice is raised all the
                // same and waits in TO COLLECT on the paying till.
                if (_s.value.takesPayments) depositInvoice?.let { collectBus.request(it, _s.value.depositCents) }
```

- [ ] **Step 3: Stop the auto-jump, and reword the panel**

In `QuoteScreen.kt`, change the auto-navigate effect (line 119) so it only fires on a device
that has a Checkout:

```kotlin
    LaunchedEffect(s.createdJobId, s.depositPending) {
        if (s.createdJobId != null && s.depositPending && s.takesPayments) { viewModel.clearToast(); onGoCheckout() }
    }
```

Then in `QuoteBuilder`, replace the `if (s.depositPending) {` branch's first two children
(the accent "Collect the deposit →" box and the paragraph under it) with a version that
branches on the role. The "View job" box below them stays exactly as it is:

```kotlin
                        if (s.depositPending) {
                            if (s.takesPayments) {
                                Box(Modifier.fillMaxWidth().height(52.dp).background(Accent, RoundedCornerShape(13.dp)).clickable { onGoCheckout() }, contentAlignment = Alignment.Center) {
                                    Text("Collect the deposit →", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AccentInk)
                                }
                                Text(
                                    "The bill is waiting in Checkout with ${formatMUR(s.depositCents)} dialled in. Nothing has been taken yet.",
                                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.5.sp, lineHeight = 15.sp, color = TextMuted,
                                )
                            } else {
                                // This tablet takes no money. The bill exists; say where it is paid.
                                Text(
                                    "Deposit invoice raised. Collect ${formatMUR(s.depositCents)} at the till — the bill is waiting in TO COLLECT. Nothing has been taken yet.",
                                    fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, lineHeight = 17.sp, color = TextSecondary,
                                )
                            }
                            Box(Modifier.fillMaxWidth().height(46.dp).border(1.dp, AccentLine, RoundedCornerShape(13.dp)).clickable { vm.viewJob(); onViewJob() }, contentAlignment = Alignment.Center) {
                                Text("View job", fontFamily = Barlow, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Accent)
                            }
                        } else {
```

- [ ] **Step 4: Expose the role on the jobs state**

In `JobsViewModel.kt`, add the repository as the **last** parameter of the
`@HiltViewModel class JobsViewModel @Inject constructor(...)` list:

```kotlin
    private val deviceRole: mu.carfection.pos.core.data.DeviceRoleRepository,
```

Then add a field to `JobsState`, beside `toast` (around line 75):

```kotlin
    /** False on reception's tablet — a ready job's invoice is raised here, collected there. */
    val takesPayments: Boolean = true,
```

Add the same `init` collector pattern as the quote view model:

```kotlin
    init {
        viewModelScope.launch { deviceRole.takesPayments.collect { t -> _s.update { it.copy(takesPayments = t) } } }
    }
```

- [ ] **Step 5: Raise the invoice without navigating**

In `JobsViewModel.kt`, replace `goToCheckout` (line 762) with:

```kotlin
    /**
     * The ready job's bill. On a till this ensures the invoice exists and then walks the
     * operator to Checkout. On a quotation tablet the invoice is raised exactly the same —
     * that is reception's step, and it is what puts the bill in TO COLLECT — but there is
     * nowhere to walk to, so it says where the money is taken instead.
     */
    fun goToCheckout(onGo: () -> Unit) {
        val quotationOnly = !_s.value.takesPayments
        // On a till: close the sheet and walk to Checkout, exactly as before. On a quotation
        // tablet: stay put and say where the money is taken — closing the sheet would hide
        // the confirmation the operator needs to read.
        fun finish(closeSheet: Boolean) {
            if (quotationOnly) _s.update { it.copy(toast = "Invoice raised — collect it at the till.") }
            else { if (closeSheet) close(); onGo() }
        }
        val job = active(_s.value) ?: run { finish(closeSheet = false); return }
        val quoteId = job.sourceQuoteId
        val hasLiveInvoice = job.invoices.any { it.docType == "invoice" && it.status != "void" && it.status != "draft" }
        if (quoteId == null || hasLiveInvoice) { finish(closeSheet = true); return }
        _s.update { it.copy(busy = true) }
        viewModelScope.launch {
            runCatching { ensureQuoteInvoice(quoteId) }
                .onSuccess { _s.update { it.copy(busy = false) }; finish(closeSheet = true) }
                .onFailure { e -> _s.update { it.copy(busy = false, error = e.uiMessage("Couldn't create the invoice — check the connection and try again")) } }
        }
    }
```

Two things to preserve exactly:

- The sheet stays **open** on a quotation device — the toast is shown inside it, and closing
  it would hide the confirmation the operator needs to read.
- `closeSheet = false` on the no-active-job path matches the original, which called `onGo()`
  without closing. Do not collapse the two calls into one unconditional `close()`; that path
  has no sheet to close.

- [ ] **Step 6: Reword the button**

In `JobsScreen.kt`, change the `j.status == "ready"` arm of the `when` (line 589):

```kotlin
                    j.status == "ready" -> (if (s.takesPayments) "Go to checkout →" else "Raise the invoice →") to { vm.goToCheckout(onGoCheckout) }
```

- [ ] **Step 7: Build and test**

Run:

```bash
cd android && ./gradlew testDebugUnitTest assembleDebug
```

Expected: `BUILD SUCCESSFUL`. If Hilt complains it cannot provide
`DeviceRoleRepository`, check that the class carries `@Singleton` and `@Inject constructor`
— it is provided by constructor injection, not by a module.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/mu/carfection/pos/feature/quote android/app/src/main/java/mu/carfection/pos/feature/jobs
git commit -m "feat(pos): reception raises the bill, the till collects it"
```

---

## Task 7: End-to-end verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Re-run the DB probe**

Run (sandbox disabled):

```bash
node scripts/_verify-quotation-devices.mjs
```

Expected: `✓ ALL CHECKS PASSED (rolled back — nothing persisted)`.

- [ ] **Step 2: Re-run the money-path probe for regressions**

`open_cash_session` was rewritten, so confirm nothing else moved:

```bash
node scripts/_verify-pos-devices.mjs
```

Expected: `✓ ALL CHECKS PASSED`.

- [ ] **Step 3: Deploy the APK**

Run:

```bash
cd android && ./gradlew assembleDebug
```

Then overwrite the desktop copy the owner installs from:

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk "/c/Users/sheik/OneDrive/Desktop/Carfectionist-POS.apk"
```

- [ ] **Step 4: Emulator run — the till is unaffected**

Install on the emulator and sign in. Before flipping anything, confirm the app is
**unchanged**: Checkout is present, it is the landing tab, and the till chip behaves as it
always did. This is the rollout guarantee — no device changes until the owner switches one.

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

- [ ] **Step 5: Emulator run — flip it and watch**

In the web back office, set the emulator's device to Quotation only. Then, on the tablet,
either wait for the heartbeat (up to 4 minutes) or sign out and back in. Confirm:

1. The **Checkout** tab is gone from the nav rail.
2. The app is on **Intake** — and if it was sitting on Checkout when the switch flipped, it
   moved there by itself.
3. Build a quote, accept it **with a deposit**, and confirm the panel reads *"Deposit
   invoice raised. Collect Rs X at the till"* — with no jump to Checkout.
4. On the web, confirm that deposit invoice is sitting in TO COLLECT.
5. Open a **ready** job and confirm the button reads *"Raise the invoice →"*, and that
   pressing it reports *"Invoice raised — collect it at the till."*

Note: `adb root` is needed for broadcast-based testing on this emulator, and the emulator is
shared with another project — check the AVD name and which app has focus before tapping.

- [ ] **Step 6: Flip it back, and confirm the tablet recovers**

Set the device back to taking payments on the web. Within four minutes the Checkout tab
must reappear on the tablet without a re-login.

- [ ] **Step 7: Commit anything outstanding**

```bash
git status
```

Expected: clean. If the APK copy or a stray build artifact shows up, do not commit it.

---

## Rollout note

After this ships, **nothing changes on any tablet** until the owner opens Points of Sale →
the Samsung → Settings and presses "Make quotation only". That is deliberate: the column
defaults to `true` and every existing device keeps its current behaviour.
