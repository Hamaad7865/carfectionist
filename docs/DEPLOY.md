# Deploying Carfectionist

Everything you need to ship, roll back, and unstick this system without help.

- **Web app** → Cloudflare Worker `carfectionist` → https://app-carfectionist.com
- **Database** → hosted Supabase, project ref `qecydemyqxdxwhkiyjtp`
- **Tablet** → Android APK, built and copied by hand
- **Repo** → `Hamaad7865/carfectionist`, branch `main`

---

## 1. The normal deploy: push to `main`

There is nothing else. Push, and the site updates itself.

```bash
git add -A
git commit -m "what changed"
git push origin main
```

GitHub Actions then runs, in order: install → **390 tests** → Next build → bundle the
Worker → deploy → load real pages and check they render. Takes about **two minutes**.

Watch it at **github.com/Hamaad7865/carfectionist/actions**. Green tick = live.
A red run means **nothing was deployed** — the old site is still up and serving. That
is deliberate: a failing build cannot take the shop down.

### One rule: never add a second deployer

Cloudflare can also build from the Git repo (Workers & Pages → `carfectionist` →
Settings → Build). **Leave that disconnected.** On 2026-07-14 both were connected, and
every push produced two builds of the same commit. Two builds mean two sets of
JavaScript filenames, so a browser would load the page from one build and then ask for
scripts that only existed in the other — pages died with `ChunkLoadError`, intermittently,
and the deploy still went green. It looked like a fluke for days. It wasn't.

GitHub Actions is the only deployer, because it is the only one that runs the tests.

---

## 2. If GitHub is down and you must deploy by hand

Rare. You need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment
(they live in `apps/web/.env.local`).

```bash
cd apps/web        # NEVER from the repo root — OpenNext will misdetect the project
npm run deploy
```

That runs the same three commands CI runs: `next build --webpack`, then
`opennextjs-cloudflare build --skipNextBuild`, then `opennextjs-cloudflare deploy`.

The `--webpack` flag is not optional. Turbopack produces a bundle the Worker cannot
load. `--skipNextBuild` stops OpenNext from re-running the build with Turbopack and
undoing it.

**This skips the tests.** Run them first:

```bash
npm run test --workspace web
```

---

## 3. The site is broken. Get it back up.

**Roll the Worker back to the previous version. Seconds, no build:**

```bash
cd apps/web
npx wrangler rollback
```

Do this *first* when the shop is down and customers are waiting. Diagnose afterwards.

**Then undo the bad commit properly:**

```bash
git revert <bad-sha>
git push origin main
```

To see what's deployed and when:

```bash
cd apps/web
npx wrangler deployments list
```

You should see **one** deployment per push. Two deployments seconds apart means someone
reconnected the Cloudflare dashboard build — see §1.

---

## 4. Secrets

Secrets are **not** in the repo and **not** in the deploy. They are set once on the
Worker and survive every deploy.

**Cloudflare dashboard → Workers & Pages → `carfectionist` → Settings → Variables and
Secrets → Add.** Type must be **Secret**, not Text — Text is readable by anyone with
dashboard access.

| Secret | What it is |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access. Server-side only, never in the browser or the tablet. |
| `POS_DEVICE_KEY` | Lets a tablet fetch the staff roster and sign in by PIN. |
| `WHATSAPP_TOKEN` | Permanent Meta system-user token. |
| `WHATSAPP_APP_SECRET` | Proves an incoming webhook genuinely came from Meta. |
| `WHATSAPP_PHONE_NUMBER_ID` | Which number we send from. |
| `WHATSAPP_WABA_ID` | Which WhatsApp account we belong to. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | The handshake Meta echoes back. Already set. |

After adding a secret the Worker redeploys itself — about 30 seconds. Reload the page
before concluding it didn't work.

Two values are **build-time**, not Worker secrets, because they get baked into the
JavaScript. They live in GitHub → Settings → Secrets → Actions:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

PDF rendering and email need **no** secret at all — the `BROWSER` and `EMAIL` bindings in
`wrangler.jsonc` are the authentication.

---

## 5. Database changes

Migrations are **not** part of the deploy. You run them yourself, and you run them
**before** pushing code that depends on them — otherwise the new code hits columns that
don't exist yet.

```bash
# back up first, always — the wipe is irreversible
node scripts/db-backup.mjs

# apply one migration file
node scripts/db-exec.mjs supabase/migrations/20260714000003_wa_inbox.sql
```

Needs `SUPABASE_DB_URL` in `.env.local`. The Supabase CLI is **not** linked to this
project; don't reach for `supabase db push`. If you ever do need the CLI, it wants
`--project-ref qecydemyqxdxwhkiyjtp`.

---

## 6. The tablet

```bash
cd android
./gradlew assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it over the
one on the Desktop (`Carfectionist-POS.apk`) and install it on the tablet.

---

## 7. When it goes wrong

| What you see | What it means |
|---|---|
| CI red, site still fine | The build failed, so nothing shipped. Read the failing step in Actions. The old site is untouched. |
| CI green, site 500s | A runtime error only the Worker sees. `npx wrangler rollback` now, then investigate. |
| Pages fail intermittently, `ChunkLoadError` | Two deployers. Check `wrangler deployments list` for pairs. See §1. |
| `Cannot find module` in the Worker | You deployed a Turbopack build. Rebuild with `--webpack`. |
| "Application detection logic ran in the root of a workspace" | You ran OpenNext from the repo root. `cd apps/web` first. |
| A feature says "not configured" | A secret is missing or empty. Check §4 — and check the *value*, not just that the name is present. An empty secret looks identical to a set one from the outside. |
| New code errors on a missing column | You pushed before running the migration. See §5. |

### One hard-won lesson

In July 2026 the PDF and email features failed for days. Three theories, all wrong. The
actual cause: two secrets were present but **empty** — length zero. Everything looked
configured. It wasn't.

**When something says "not configured", print the value's length before you theorise.**
