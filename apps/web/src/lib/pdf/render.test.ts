import { describe, it, expect, vi, beforeEach } from "vitest";

// Every PDF the Worker makes goes through htmlToPdf over the BROWSER binding. On
// Browser Run's Chrome 152, setContent + "networkidle0" never settles — not even
// for a blank page — so every invoice, share link, statement and Z-report timed
// out after 30 s (2026-11-03). These pin the wait mode that does settle.

const setContent = vi.fn();
const page = {
  setContent,
  evaluate: vi.fn(async () => 1200),
  pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
};
const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { BROWSER: {} } }),
}));
vi.mock("@cloudflare/puppeteer", () => ({ default: { launch: vi.fn(async () => browser) } }));

import { htmlToPdf } from "./render";

describe("htmlToPdf over the Browser Run binding", () => {
  beforeEach(() => setContent.mockClear());

  it('waits for "load", never "networkidle0"', async () => {
    await htmlToPdf("<p>x</p>");
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(setContent.mock.calls[0][1]).toMatchObject({ waitUntil: "load" });
  });

  it("uses the same wait for a paginated report", async () => {
    await htmlToPdf("<p>x</p>", { footerLeft: "Generated today" });
    expect(setContent.mock.calls[0][1]).toMatchObject({ waitUntil: "load" });
  });

  it("returns the rendered bytes and closes the browser", async () => {
    const out = await htmlToPdf("<p>x</p>");
    expect(new Uint8Array(out)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(browser.close).toHaveBeenCalled();
  });
});
