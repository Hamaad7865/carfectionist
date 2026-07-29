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

/**
 * Opt-in true A4 pagination with a running footer, for multi-page REPORTS.
 * Documents (invoices, statements, Z-reports) deliberately do NOT use this —
 * they grow one tall page instead of splitting, and passing no options keeps
 * exactly that behaviour.
 */
export interface PaginatedPdf {
  /** Left-hand footer text, e.g. "Generated on Wednesday 29 July 2026". */
  footerLeft: string;
}

/** Chromium renders header/footer templates in an isolated document — no inherited
 *  styles, and no font-size unless one is stated, so it must be spelled out here. */
function footerTemplate(left: string): string {
  const esc = left.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<div style="width:100%;margin:0 12mm;font:9px Arial,Helvetica,sans-serif;color:#5b6b7a;display:flex;justify-content:space-between;">
    <span>${esc}</span>
    <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

export async function htmlToPdf(html: string, paginate?: PaginatedPdf): Promise<ArrayBuffer> {
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

      let options: Record<string, unknown>;
      if (paginate) {
        // A report flows onto real sheets, each carrying the running footer.
        // The bottom margin is what reserves room for it — with margin 0 the
        // footer renders off the page and silently disappears.
        options = {
          printBackground: true,
          format: "A4",
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: footerTemplate(paginate.footerLeft),
          margin: { top: "10mm", right: "0", bottom: "14mm", left: "0" },
        };
      } else {
        // One page sized to the content (min A4), like the reference system: a
        // long invoice grows the page instead of splitting onto a second sheet.
        const contentPx = await page.evaluate(() => document.documentElement.scrollHeight);
        const heightMm = Math.max(297, Math.ceil((contentPx * 25.4) / 96) + 2);
        // margin 0 is load-bearing: unset, Chromium applies ~1cm defaults, which
        // shrinks the printable area below the measured height (content spills to
        // a 2nd page) and insets the full-bleed banner bands off the page edges.
        options = {
          printBackground: true,
          width: "210mm",
          height: `${heightMm}mm`,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdf = (await page.pdf(options as any)) as Uint8Array;
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
      body: JSON.stringify({
        html,
        pdfOptions: {
          printBackground: true,
          format: "A4",
          ...(paginate
            ? {
                displayHeaderFooter: true,
                headerTemplate: "<span></span>",
                footerTemplate: footerTemplate(paginate.footerLeft),
                margin: { top: "10mm", right: "0", bottom: "14mm", left: "0" },
              }
            : {}),
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Browser Rendering error ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

export function documentHtml(body: string, baseHref?: string): string {
  // The PDF renderer loads this HTML via setContent (about:blank), so relative
  // asset URLs (/brand/….png) resolve to nothing without a <base href> pointing
  // at the deployed origin — banners silently render as broken images.
  const base = baseHref ? `<base href="${baseHref.replace(/"/g, "")}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body style="margin:0">${body}</body></html>`;
}
