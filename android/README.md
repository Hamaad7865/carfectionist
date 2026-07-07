# Carfectionist POS (Android)

Native Android tablet POS for the shop floor. Shares the **same Supabase backend**
as the web back office — every sale, payment, and stock movement it writes shows
up in the web app (see `../docs/android-pos-plan.md`).

## Status — M1 (counter MVP)

- [x] Project + Carfectionist theme (gold-C on near-black), Hilt, Room, Compose, supabase-kt
- [x] Money engine (integer cents, line-level VAT) with the shared 88,780 test vector
- [x] Auth (email/password) — the seeded staff logins work
- [x] Offline-first catalogue cache (Room is the read source of truth)
- [x] **Counter sale**: product **search bar** + tap-to-add + qty steppers
- [x] **Fast payment pad**: pre-filled Cash + exact amount, quick-tender chips + on-screen numpad, live change → 2–3 taps
- [x] Card / Juice / Bank (reference) · Credit (on-account)
- [x] **Till**: open float / close + count / variance
- [x] Receipt + drawer behind interfaces (log-only until the real hardware model is set)

M2 (offline outbox + sync), M3 (jobs), M4 (stock/certs/dashboard) follow.

## Open & run

1. Open the **`android/`** folder in **Android Studio** (Ladybug or newer).
2. Let it sync Gradle (first sync downloads the SDK/deps). If it prompts to update
   AGP/Gradle, accept.
3. `local.properties` (gitignored) already has the Supabase URL + **anon** key
   (public client key — RLS is the boundary; the service-role key is never here).
4. Run on a **landscape tablet** or a tablet emulator (min SDK 26).
5. Sign in with a seeded staff login (e.g. the owner), open the till, ring a sale.

### CLI build
```
cd android
./gradlew :app:assembleDebug      # build the APK
./gradlew :app:testDebugUnitTest  # run the money unit tests
```

## Where things are

```
app/src/main/java/mu/carfection/pos/
  core/
    money/       cents math + VAT (mirrors web lib/money) + tests
    database/    Room entities, DAOs, PosDatabase (offline read cache)
    network/     DTOs + PosApi (the RPC seam — same hardened fns as web)
    data/        Session, Catalog, Sale, Till repositories
    hardware/    ReceiptPrinter / CashDrawer interfaces (+ log stubs)
    di/          Hilt modules (Supabase client, Room, DataStore)
  feature/
    login/       LoginScreen + ViewModel
    counter/     CounterScreen (search + cart) + PaymentPad + ViewModel  ← the star
    till/        TillScreen + ViewModel
  ui/            theme + PosNavHost
```

## Hardware (TBD)

Printer, cash drawer, and barcode scanner are separate devices — models to be
confirmed. They sit behind `ReceiptPrinter` / `CashDrawer` / (scanner) interfaces
so the real DantSu ESC/POS transport + drawer kick drop in with **zero** change to
the sale logic. Until then, receipts print to Logcat and the drawer logs a "kick".
