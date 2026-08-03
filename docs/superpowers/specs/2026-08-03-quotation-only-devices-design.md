# Quotation-only devices — a tablet that never opens a till

**Date:** 2026-08-03 · **Approved by:** owner (chat) · **Scope:** DB + web back office + Android app

## Problem

The Samsung tablet is not a till. Reception uses it to take in vehicles, build quotations
and send them. It never charges anyone. Yet:

1. The app lands on **Checkout** and shows a warning-orange chip reading
   *"Till closed — open it"* ([CounterScreen.kt:142](../../../android/app/src/main/java/mu/carfection/pos/feature/counter/CounterScreen.kt)).
   On a device that never sells, that reads as a fault.
2. Staff act on it. Someone opens a session out of habit, nobody closes it, and the
   forgotten service is exactly the failure `20260730000040_stale_till_guard.sql` was
   written for — a till trading on yesterday's day, money on the wrong journal.

The till already stopped gating the app in `320572b`; quotes, intake, jobs and contacts all
work with no session. What remains is a device that *looks* like it needs a till and a
staff habit that follows the look.

## Decision

Make "this device does not take money" a fact the server holds, not a habit the staff must
keep. One flag on the device row, enforced at `open_cash_session`, read back by the tablet.

A switch the staff can flip themselves does not break a staff habit. A refusal does.

## Non-goals

- **Blocking `record_payment` on a quotation device.** A payment needs a `cash_session_id`,
  and the tablet only ever asks for *its own* device's session — which will not exist. The
  guard at `open_cash_session` is sufficient and is the one choke point web and Android
  already share. Adding a second check against another device's session buys nothing here
  and risks the back office.
- **Any change to the web back office as a paying terminal.** It opens tills as
  `back-office` and stays `takes_payments = true`.
- **A general device-role taxonomy.** One boolean answers the question asked. A role enum
  can come the day a third kind of device exists.

## 1. The flag — `devices.takes_payments`

New migration `supabase/migrations/20260803000020_quotation_only_devices.sql`.

```sql
alter table public.devices
  add column if not exists takes_payments boolean not null default true;
```

Defaulting to `true` makes the rollout a no-op: every registered device, including the
Samsung, behaves exactly as it does today until the owner flips it.

### `set_device_takes_payments(p_device_id uuid, p_takes boolean)`

Owner/manager, `security definer`, shaped like the existing `set_device_active`. Audits
`device_payments_disabled` / `device_payments_enabled` into `audit_events` with the device
stamp.

**Refuses to switch off while that device has an open session:**

> close the open service on this device first — it still holds today's takings

Without this, flipping the switch strands a session on a tablet whose till screen has just
disappeared: open forever, closable from nowhere.

### The guard in `open_cash_session`

`public.open_cash_session(p_device_id text, p_opening_float numeric)` — last redefined in
`20260714000006_close_service_day.sql:18` — gains one check, after the role check and
before `app.open_trading_day`:

```sql
if exists (select 1 from public.devices
            where tenant_id = v_tenant and device_code = v_dev
              and takes_payments = false) then
  raise exception 'this device does not take payments — open the till on the paying terminal';
end if;
```

Scoped to *registered* devices by construction: an unknown `device_code` and
`'back-office'` have no row, match nothing, and are unaffected.

### How the tablet finds out

`register_device` already returns `public.devices`. The new column rides back on a call the
tablet makes at login and on every heartbeat. No new endpoint, and no new round trip.

## 2. The owner's switch (web)

- `PosDevice` gains `takesPayments: boolean`; `getPosOverview` and the per-device query in
  `apps/web/src/lib/supabase/queries/pos-devices.ts` select it. Synthesized entries
  (back-office, unregistered) report `true`.
- `apps/web/src/lib/supabase/rpc.ts` gains `setDeviceTakesPayments`.
- `apps/web/src/features/pos/actions.ts` gains `setDeviceTakesPaymentsAction` — same shape
  as `setDeviceActiveAction`: `requireRole("owner","manager")`, zod parse, RPC, surface the
  RPC's own message on failure (the "close the open service first" text is the useful one),
  `revalidatePath("/point-of-sale")`.
- `apps/web/src/features/pos/DeviceSettings.tsx` gains a third card between name and
  active, mirroring the Deactivate card's layout and busy/error handling:

  > **This device takes payments** — Opens a till and collects money.
  > **Quotation only** — Never opens a till. Reception, quotes and jobs only; money is
  > taken at a paying terminal.

- `apps/web/src/features/pos/DeviceCards.tsx`: a `Quotation only` badge beside the
  `Inactive` badge, and in the card body a quotation device shows that line instead of the
  "Till closed" state — the Points of Sale page should stop reporting a closed till for a
  device that is not supposed to open one.

## 3. The tablet adapts

**Learning the role.** `PosApi.registerDevice` currently discards its response
([PosApi.kt:346](../../../android/app/src/main/java/mu/carfection/pos/core/network/PosApi.kt)).
It parses `takes_payments` instead and hands it to a small `DeviceRoleRepository` that
caches it in DataStore and exposes `takesPayments: Flow<Boolean>`.

**Unknown means `true`.** A real till that has never reached the server, or is offline on
first launch, must still sell. Failing safe here fails toward selling.

**It stays fresh on its own.** `RootViewModel` already heartbeats `registerDevice` every
four minutes while signed in, so flipping the switch on the web reaches the tablet without
a re-login.

**What changes when it is false:**

| Place | Today | On a quotation device |
| --- | --- | --- |
| `PosShell` nav (`PosShell.kt:254`) | `PosTab.entries` | `PosTab.entries` minus `SALE` |
| `RootViewModel` landing tab | `PosTab.SALE` | `PosTab.INTAKE` |
| `RootViewModel.navigate(SALE)` | switches tab | ignored |
| `TillRepository.openSession()` on login | called | not called |
| Quote deposit (`QuoteScreen.kt:554`) | "Collect the deposit →" jumps to Checkout | notice: *"Deposit invoice raised. Collect Rs X at the till."* |
| Quote auto-jump (`QuoteScreen.kt:120`) | navigates on `depositPending` | suppressed |
| Jobs ready action (`JobsScreen.kt:589`) | "Go to checkout →" | "Raise the invoice →" |

**The deposit still gets raised.** `QuoteViewModel` already raises the deposit invoice
server-side and only *hands* it to Checkout via `collectBus`
([QuoteViewModel.kt:1017](../../../android/app/src/main/java/mu/carfection/pos/feature/quote/QuoteViewModel.kt)).
On a quotation device the `collectBus.request` is skipped and the screen states where the
money is collected. The bill appears in TO COLLECT on the paying till either way.

**The jobs hand-off keeps its work.** `JobsViewModel.goToCheckout` calls
`ensureQuoteInvoice` before navigating. On a quotation device it runs the same call — so
the till has a bill waiting — then reports *"Invoice raised — collect it at the till."*
instead of navigating. Reception's step is finished; only the collecting moves.

## 4. Parity

Enforcement lives in `open_cash_session`, which web and Android both call, so neither can
drift from the other. The tablet's UI changes have no web counterpart: the back office is
always a paying terminal, and the Points of Sale page gains the badge described above.

## 5. Edge cases

- **Flip with a session open** → refused, naming the fix. Covered by a DB test.
- **Offline after a flip** → the cached role holds; unknown falls back to taking payments.
- **Flipped back to a till** → Checkout returns at the next heartbeat, within four minutes.
- **A device that traded before the registry existed** has no `devices` row, so the guard
  does not match it and nothing changes. It gets settings the first time the app starts on
  it, as today.
- **Rollout** changes no behaviour anywhere until the owner sets the Samsung to Quotation
  only.

## 6. Verification

**Database** (`scripts/db-exec.mjs`, probes inside `BEGIN … ROLLBACK`):

1. `open_cash_session` on a device with `takes_payments = false` raises.
2. The same device with `takes_payments = true` opens normally.
3. `set_device_takes_payments(device, false)` raises while that device has an open session,
   and succeeds once it is closed.
4. `'back-office'` and an unregistered device code still open.

**Android unit tests** — the role is pure state, so these need no device:

1. The visible tab list excludes `SALE` when `takesPayments = false`, and includes it when
   `true`.
2. The landing tab is `INTAKE` when `false`, `SALE` when `true`.
3. An unseen/unparseable cached role reads as `true`.

**Emulator, end to end** — sign in on a flipped device: no Checkout tab, lands on Intake,
accept a quote with a deposit, confirm the notice names the till, then confirm on the web
that the deposit invoice is sitting in TO COLLECT.
