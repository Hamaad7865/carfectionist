import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Server-side secret/config lookup that works EVERYWHERE:
 *  - deployed Worker → getCloudflareContext().env (wrangler secrets live here;
 *    process.env is NOT reliably populated on this OpenNext setup)
 *  - `next dev` → falls through to process.env (.env.local)
 *  - vitest/node → getCloudflareContext throws → process.env
 * Never import from client code.
 */
export function serverEnv(name: string): string | undefined {
  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    const v = env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* outside a Cloudflare request context */
  }
  return process.env[name];
}
