# Tablet catalogue periodic sync — design

**Date:** 2026-07-30 · **Approved by:** owner (chat) · **Scope:** Android app only

## Problem

The tablet's catalogue (products/prices/settings) is an offline-first Room cache that
refreshes only on login, on screen creation, and via the header Sync button. A price
corrected in the web back office keeps selling at the old figure on any tablet that has
been sitting open — today that produced a Rs 1,505.35 shelf price for a product the web
had already fixed to Rs 1,309.00 (~4 h of staleness).

## Decision (approved)

Foreground-only periodic sync, ~5-minute freshness. No WorkManager — the app is a
kiosk that is open all day; background sync adds machinery (15-min OS floor, deferrable)
for a case that doesn't occur.

A dedicated loop in `RootViewModel` (beside the existing 4-min device heartbeat, same
lifecycle idiom), gated on **signed-in AND validated-online**:

```kotlin
viewModelScope.launch {
    catalogSyncActive(session.isLoggedIn, connectivity.online).collectLatest { active ->
        if (active) while (true) {
            runCatching { catalog.refresh() }
            delay(CATALOG_SYNC_MS) // 5 min
        }
    }
}
```

`catalogSyncActive(loggedIn, online)` = `combine(...) { l, o -> l == true && o }
.distinctUntilChanged()` — extracted to `core/sync` so the gate is unit-testable.

## Properties

- **Refresh-first loop**: an offline tablet catches up the moment connectivity returns
  (and on login), not one tick later. `collectLatest` cancels an in-flight pull when the
  gate closes; `CatalogRepository.refresh()` is cancellation-safe (atomic prefs edit,
  Room `replaceAll` in a transaction, empty-fetch treated as no-update).
- **No mid-sale re-pricing**: `CartLine` (counter) and `QuoteLine` (builder) capture the
  product/price at add time; a background `replaceAll` re-prices the product grid live
  but never a basket already under the cashier's finger.
- **Cheap tick**: 3 small PostgREST reads; logo sync is a string-compare no-op when
  unchanged. No new dependencies; `RootViewModel` already injects `catalog` and
  `connectivity`.
- **Offline behaviour**: the gate closes — no doomed request attempts (unlike the
  heartbeat, which intentionally pings blind).

## Not mirrored on web

`android-web-parity` applies to behaviour/RPCs. The web has no equivalent staleness:
pages are server-rendered per request, so there is no cache to keep fresh.

## Testing

- Unit: `catalogSyncActive` gate — null/false/true login states × online transitions,
  distinct-until-changed collapsing.
- End-to-end: build APK, run on tablet/emulator, edit a price in the DB, observe the
  counter grid update within 5 min with no manual Sync.

## Rollout

Ships in the APK (assembleDebug → Desktop `Carfectionist-POS.apk`); tablets receive it
via the existing in-app update offer.
