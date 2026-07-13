import { serverEnv } from "@/lib/server-env";

/**
 * HTML → PDF, isolated behind one function so the engine (Cloudflare Browser
 * Rendering today) can be swapped without touching callers.
 */
export class PdfConfigError extends Error {}

export async function htmlToPdf(html: string): Promise<ArrayBuffer> {
  // Cloudflare RESERVES the `CF_` env-var prefix and strips it at runtime on the
  // Worker (wrangler secret put accepts CF_* but the running code never sees it).
  // So the deployed secrets use un-prefixed names; the CF_* fallbacks keep local
  // dev (.env.local / .dev.vars) working unchanged.
  const accountId = serverEnv("BROWSER_RENDER_ACCOUNT_ID") || serverEnv("CF_ACCOUNT_ID");
  const token = serverEnv("BROWSER_RENDER_TOKEN") || serverEnv("CF_BROWSER_RENDERING_TOKEN");
  if (!accountId || !token) {
    throw new PdfConfigError(
      "Cloudflare Browser Rendering is not configured. Set BROWSER_RENDER_ACCOUNT_ID and BROWSER_RENDER_TOKEN.",
    );
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/pdf`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ html, pdfOptions: { printBackground: true, format: "A4" } }),
    },
  );
  if (!res.ok) {
    throw new Error(`Browser Rendering error ${res.status}: ${await res.text()}`);
  }
  return res.arrayBuffer();
}

export function documentHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${body}</body></html>`;
}
