import { getCloudflareContext } from "@opennextjs/cloudflare";

// TEMPORARY diagnostic — reports which access path can see each secret, as
// booleans only (never values). Gated by a token so it isn't world-readable.
// Remove once secret resolution is confirmed.
export const dynamic = "force-dynamic";

const KEYS = ["CF_ACCOUNT_ID", "CF_BROWSER_RENDERING_TOKEN", "BROWSER_RENDER_ACCOUNT_ID", "BROWSER_RENDER_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== "cfx-envcheck-9271") return new Response("no", { status: 404 });

  const has = (v: unknown) => typeof v === "string" && v.length > 0;
  const out: Record<string, unknown> = {};

  // process.env
  out.processEnv = Object.fromEntries(KEYS.map((k) => [k, has(process.env[k])]));

  // getCloudflareContext (sync)
  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    out.cfSync = Object.fromEntries(KEYS.map((k) => [k, has(env?.[k])]));
    out.cfEnvKeyCount = Object.keys(env ?? {}).length;
    out.cfEnvKeys = Object.keys(env ?? {}).sort(); // names only (no values) — token-gated
  } catch (e) {
    out.cfSync = `threw: ${(e as Error).message}`;
  }

  // getCloudflareContext (async)
  try {
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx.env as Record<string, unknown>;
    out.cfAsync = Object.fromEntries(KEYS.map((k) => [k, has(env?.[k])]));
  } catch (e) {
    out.cfAsync = `threw: ${(e as Error).message}`;
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json" } });
}
