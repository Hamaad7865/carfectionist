import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serverEnv } from "@/lib/server-env";

/**
 * HTML → PDF, isolated behind one function so the engine can be swapped without
 * touching callers. Primary path is the Cloudflare Browser Rendering BINDING
 * (env.BROWSER + @cloudflare/puppeteer) — no account id or API token, the
 * binding is the auth. A REST fallback covers `next dev` if browser-rendering
 * credentials happen to be set locally.
 */
export class PdfConfigError extends Error {}

export async function htmlToPdf(html: string): Promise<ArrayBuffer> {
  // ── Preferred: the Browser Rendering binding (deployed Worker) ──────────────
  let browserBinding: unknown;
  try {
    browserBinding = (getCloudflareContext().env as Record<string, unknown>)?.BROWSER;
  } catch {
    /* no Cloudflare context (e.g. plain node/tests) */
  }
  if (browserBinding) {
    const puppeteer = (await import("@cloudflare/puppeteer")).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = await puppeteer.launch(browserBinding as any);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = (await page.pdf({ printBackground: true, format: "A4" })) as Uint8Array;
      // Copy into a fresh ArrayBuffer (page.pdf's buffer may be Shared on workerd).
      const out = new ArrayBuffer(pdf.byteLength);
      new Uint8Array(out).set(pdf);
      return out;
    } finally {
      await browser.close();
    }
  }

  // ── Fallback: Browser Rendering REST API (local dev, if configured) ─────────
  const accountId = serverEnv("BROWSER_RENDER_ACCOUNT_ID") || serverEnv("CF_ACCOUNT_ID");
  const token = serverEnv("BROWSER_RENDER_TOKEN") || serverEnv("CF_BROWSER_RENDERING_TOKEN");
  if (!accountId || !token) {
    throw new PdfConfigError(
      "Browser Rendering is not available. Enable Browser Rendering on the Cloudflare account (the BROWSER binding), or set BROWSER_RENDER_ACCOUNT_ID + BROWSER_RENDER_TOKEN for the REST fallback.",
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
  if (!res.ok) throw new Error(`Browser Rendering error ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

export function documentHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${body}</body></html>`;
}
