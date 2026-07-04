/**
 * HTML → PDF, isolated behind one function so the engine (Cloudflare Browser
 * Rendering today) can be swapped without touching callers.
 */
export class PdfConfigError extends Error {}

export async function htmlToPdf(html: string): Promise<ArrayBuffer> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_BROWSER_RENDERING_TOKEN;
  if (!accountId || !token) {
    throw new PdfConfigError(
      "Cloudflare Browser Rendering is not configured. Set CF_ACCOUNT_ID and CF_BROWSER_RENDERING_TOKEN.",
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
