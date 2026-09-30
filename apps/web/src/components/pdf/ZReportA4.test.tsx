import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ZReportA4 } from "./ZReportA4";

/**
 * 2026-09-25: Z000088 printed Service 1 + 3 only while its Period said 9 tickets —
 * Service 2 (back-office, still open) was omitted from services[]. The server now
 * includes open sessions as provisional blocks; the A4 must label them "still open"
 * and hide the uncounted drawer lines instead of printing Rs 0.00.
 */

const from = { tradingName: "Carfectionist", address: "Helvetia", brn: "B", vatNo: "V", phone: "P" };

const totals = {
  service_no: 3,
  services: [
    { service_no: 1, status: "closed", float_initial: 2000, float_final: 9480.01, counted_cash: 9480.01, variance: 0, total_incl: 55164.01, tickets: 5, avg_basket: 11032.8 },
    { service_no: 2, device: "back-office", status: "open", provisional: true, float_initial: 0, float_final: null, counted_cash: null, variance: null, total_incl: 2150, tickets: 2, avg_basket: 1075 },
    { service_no: 3, status: "closed", float_initial: 2000, float_final: 2000, counted_cash: 2000, variance: 0, total_incl: 2804.99, tickets: 2, avg_basket: 1402.5 },
  ],
  period: { total_incl: 60119, tickets: 9, avg_basket: 7514.88, methods: [], categories: [], cashiers: [], vat: [] },
  cashiers: [{ name: "Nick", total: 1 }],
};

describe("ZReportA4 open service", () => {
  const html = renderToStaticMarkup(
    <ZReportA4 from={from} number="Z000088" scope="service" closedAt="2026-09-25T13:21:38" note={null} totals={totals} />,
  );

  it("labels the open block still open", () => {
    expect(html).toContain("Service 2 (still open)");
    expect(html).toContain("Still open — not counted yet");
  });

  it("period total reconciles all three services", () => {
    // 55,164.01 + 2,150.00 + 2,804.99 = 60,119.00 — the breakdown must add up to this.
    expect(html).toContain("Rs 60,119.00");
    expect(html).toContain("9 tickets");
  });

  it("hides the uncounted drawer lines for the open block only", () => {
    // One open block hides its Final/Counted; two closed blocks keep theirs (2 each).
    expect(html.match(/Final cash float/g)?.length).toBe(2);
    expect(html.match(/Counted/g)?.length).toBe(2);
  });
});
