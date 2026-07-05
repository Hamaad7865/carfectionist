# Deploying Carfectionist → Cloudflare Workers (OpenNext)

The app deploys to **Cloudflare Workers** via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).
Everything is wired; the only things that need **your** Cloudflare account are the auth
step and the environment values.

> Note on middleware: Next 16's `proxy.ts` is Node-only and OpenNext Cloudflare can't run it,
> so session **token-refresh** was moved to a client keep-alive (`components/shell/AuthKeepalive.tsx`)
> and route protection stays server-side (the `(app)` layout's `requireSession` + Postgres RLS).

## 1. Authenticate wrangler to your Cloudflare account (one of)

```bash
# interactive (opens a browser):
npx wrangler login

# …or non-interactive (CI / headless): create an API token with the
# "Edit Cloudflare Workers" template, then:
export CLOUDFLARE_API_TOKEN=<your-token>
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
```

## 2. Set the environment on the Worker

Run from `apps/web/`. The two `NEXT_PUBLIC_*` values are public; the service-role key is a secret.

```bash
# public — server runtime reads these from the Worker env (add via dashboard or wrangler.jsonc "vars"):
#   NEXT_PUBLIC_SUPABASE_URL       = https://<project>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  = <anon key>
# secret:
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# optional — enables the invoice-PDF download (leave unset → PDF route returns a graceful 503):
npx wrangler secret put CF_BROWSER_RENDERING_TOKEN
# and add CF_ACCOUNT_ID the same way (or as a var)
```

For a **local Workers test** (`npm run preview`), create `apps/web/.dev.vars` (gitignored):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## 3. Preview locally on workerd (optional but recommended)

```bash
npm run preview --workspace web   # opennextjs-cloudflare build && wrangler dev
```

## 4. Deploy

```bash
npm run deploy --workspace web    # opennextjs-cloudflare build && wrangler deploy
```

Wrangler prints the live `*.workers.dev` URL. To use a custom domain, add a route/custom-domain
in the Cloudflare dashboard (Workers → your worker → Domains & Routes) or a `routes` entry in
`wrangler.jsonc`.

## Files
- `wrangler.jsonc` — Worker config (`nodejs_compat`, assets binding).
- `open-next.config.ts` — OpenNext Cloudflare config.
- `next.config.ts` — calls `initOpenNextCloudflareForDev()` so `next dev` mirrors the Worker env.
- scripts: `cf-build`, `preview`, `deploy`, `cf-typegen`.
