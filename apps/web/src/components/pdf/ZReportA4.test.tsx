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
    <ZReportA4 from={from} number="Z000088" scope="service" closedAt="2026-09-25T13:21:38" closedByName="Nick" note={null} totals={totals} />,
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

/**
 * 2026-10-19: Z000114 (no sales) printed "Closed by —" although Anshika closed it, and
 * stamped 13:12 for a 17:12 close. "Closed by" read the first cashier in the frozen totals
 * (nobody, on a no-sale day) and the time was the raw UTC string.
 */
describe("ZReportA4 closed by", () => {
  const noSales = { service_no: 1, float_initial: 2000, float_final: 2000, total_incl: 0, tickets: 0, avg_basket: 0, cashiers: [] };

  it("names the person who closed the till, even with no sales", () => {
    const html = renderToStaticMarkup(
      <ZReportA4 from={from} number="Z000114" scope="day" closedAt="2026-10-19T13:12:04.235083+00:00" closedByName="Anshika" note={null} totals={noSales} />,
    );
    expect(html).toContain("Closed by Anshika");
  });

  it("names the closer, not whoever rang the sales", () => {
    const html = renderToStaticMarkup(
      <ZReportA4 from={from} number="Z000088" scope="service" closedAt="2026-09-25T13:21:38+00:00" closedByName="Anshika" note={null} totals={totals} />,
    );
    expect(html).toContain("Closed by Anshika");
    expect(html).not.toContain("Closed by Nick");
  });

  it("prints the close time in Mauritius time", () => {
    const html = renderToStaticMarkup(
      <ZReportA4 from={from} number="Z000114" scope="day" closedAt="2026-10-19T13:12:04.235083+00:00" closedByName="Anshika" note={null} totals={noSales} />,
    );
    expect(html).toContain("2026-10-19 17:12");
    expect(html).not.toContain("13:12");
  });
});

/**
 * Two-company shop (tyre centre, phase D): z_totals adds `companies` only for a shop with more
 * than one active company. The Z prints a "By company" block from it; without it, nothing changes.
 */
describe("ZReportA4 by company", () => {
  const base = { service_no: 1, float_initial: 0, total_incl: 9500, tickets: 4, avg_basket: 2375, methods: [], cashiers: [] };
  const companies = [
    { id: "a", name: "Tyre Centre", vat_registered: true, tickets: 2, total_incl: 6900, excl: 6000, vat: 900, refunds: 0,
      methods: [{ method: "card", net: 2300 }, { method: "cash", net: 4600 }] },
    { id: "b", name: "Wheel Services", vat_registered: false, tickets: 2, total_incl: 2600, excl: 2600, vat: 0, refunds: 0,
      methods: [{ method: "cash", net: 1300 }] },
  ];
  const render = (totals: Record<string, unknown>) => renderToStaticMarkup(
    <ZReportA4 from={from} number="Z000001" scope="day" closedAt={null} closedByName="Staff" note={null} totals={totals} />,
  );

  it("a one-company shop's Z has no company block", () => {
    expect(render(base)).not.toContain("By company");
  });

  it("prints each company's sales, VAT and money", () => {
    const html = render({ ...base, companies });
    expect(html).toContain("By company");
    expect(html).toContain("Tyre Centre");
    expect(html).toContain("Rs 6,900.00");
    expect(html).toContain("Rs 900.00");
    expect(html).toContain("Wheel Services");
    expect(html).toContain("Rs 2,600.00");
    expect(html).toContain("Not registered for VAT — no VAT");
    // Sale modes name each company, as the sales journal does.
    expect(html).toContain("SALES [TYRE CENTRE]");
    expect(html).toContain("SALES [WHEEL SERVICES]");
    expect(html).not.toContain("SALES [CARFECTIONIST]");
  });

  it("reads the company block from the period on a service close", () => {
    const html = render({ ...base, period: { ...base, companies } });
    expect(html).toContain("By company");
  });
});
