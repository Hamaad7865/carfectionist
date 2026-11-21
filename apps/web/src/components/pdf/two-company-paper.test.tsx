import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptCard } from "./ReceiptCard";
import { DocumentA4, type DocumentA4Props } from "./DocumentA4";
import { TicketA4 } from "./TicketA4";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";
import { overlayIssuer } from "@/lib/supabase/queries/issuer";

/**
 * The tyre centre's two companies on paper (phase D): the VAT tyre company prints exactly the
 * slip and A4 every shop prints today; the non-VAT service company prints no VAT number, no VAT
 * rows and does not call itself a VAT invoice. A one-company shop's paper is unchanged.
 */

const slip = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  studioName: "Tyre Centre", logoUrl: null, address: "Port Louis, MU", brn: "C11111111", vatNo: "VAT20000001",
  phone: "+230 5000 0000", number: "TINV-0001", docLabel: "Invoice", saleModeLabel: "Sale - SALES [TYRE CENTRE]",
  ticketNo: 1, billLabel: null, terminalNo: null, voided: false, isInvoice: true, dateTime: "23-11-2026 10:00:00",
  dateLabel: "23 Nov 2026, 10:00", cashier: "STAFF", customerName: "Walk-in", customerEmail: null, customerBrn: "",
  customerVatNo: "",
  lines: [{ qty: 2, title: "TYRE 205/55R16", unitInclCents: 230000, totalInclCents: 460000, fullInclCents: 460000,
    discountInclCents: 0, discountPct: 0, discountLabel: null, unitExclCents: 200000, totalExclCents: 400000, vatRate: 15 }],
  subtotalInclCents: 460000, subtotalCents: 400000, discountInclCents: 0, vatCents: 60000, totalCents: 460000,
  paidCents: 460000, depositReceivedCents: 0, changeCents: 0, balanceDueCents: 0, methodLabel: "card", paid: true,
  vatGroups: [{ rate: 15, baseCents: 400000, vatCents: 60000, inclCents: 460000 }],
  payments: [{ method: "CARD", count: 1, amountCents: 460000, isReversal: false, stamp: null }],
  paymentDetail: [], footerNote: "Thank you", barcodeValue: "TINV-0001", codeLabel: "TINV-0001",
  pointsEarned: null, pointsBalanceAfter: null,
  ...over,
});

const serviceSlip = () => slip({
  studioName: "Wheel Services", number: "TWS-0001", brn: "C22222222", vatNo: "", vatRegistered: false,
  lines: [{ qty: 1, title: "WHEEL ALIGNMENT", unitInclCents: 130000, totalInclCents: 130000, fullInclCents: 130000,
    discountInclCents: 0, discountPct: 0, discountLabel: null, unitExclCents: 130000, totalExclCents: 130000, vatRate: 0 }],
  subtotalInclCents: 130000, subtotalCents: 130000, vatCents: 0, totalCents: 130000, paidCents: 130000,
  vatGroups: [{ rate: 0, baseCents: 130000, vatCents: 0, inclCents: 130000 }],
  payments: [{ method: "CARD", count: 1, amountCents: 130000, isReversal: false, stamp: null }],
  barcodeValue: "TWS-0001", codeLabel: "TWS-0001",
});

describe("receipt — VAT and non-VAT company", () => {
  it("a VAT-registered company prints the slip exactly as before (flag absent or true)", () => {
    expect(renderToStaticMarkup(<ReceiptCard r={slip({ vatRegistered: true })} />))
      .toBe(renderToStaticMarkup(<ReceiptCard r={slip()} />));
    const html = renderToStaticMarkup(<ReceiptCard r={slip()} />);
    expect(html).toContain("NUM VAT INVOICE TINV-0001");
    expect(html).toContain("TAUX NORMAL 15.0%");
    expect(html).toContain("VAT number : 20000001");
  });

  it("the non-VAT company's slip is an invoice with no VAT anywhere", () => {
    const html = renderToStaticMarkup(<ReceiptCard r={serviceSlip()} />);
    expect(html).toContain("NUM INVOICE TWS-0001");
    expect(html).not.toContain("NUM VAT INVOICE");
    expect(html).not.toContain("TAUX NORMAL");
    expect(html).not.toContain("excl. VAT");
    expect(html).not.toContain("VAT number");
    expect(html).toContain("Not registered for VAT");
    expect(html).toContain("BRN : C22222222");
  });

  it("the A4 ticket drops its tax table for the non-VAT company", () => {
    expect(renderToStaticMarkup(<TicketA4 r={slip()} />)).toContain("VAT (15.00%)");
    const html = renderToStaticMarkup(<TicketA4 r={serviceSlip()} />);
    expect(html).not.toContain("VAT (0.00%)");
    expect(html).toContain("Not registered for VAT");
  });
});

const a4: DocumentA4Props = {
  docType: "invoice", number: "TWS-0001", issueDate: "2026-11-23", createdBy: "Staff",
  from: { tradingName: "Wheel Services", legalName: "Wheel Services Ltd", country: "Mauritius", brn: "C22222222",
    email: "", phone: "", vatNo: "" },
  billTo: { name: "Customer", country: "Mauritius" },
  lines: [{ title: "Wheel alignment", qty: 1, rateCents: 130000, amountCents: 130000 }],
  subtotalCents: 130000, vatCents: 0, totalCents: 130000,
  bank: { accountName: "", accountNumber: "", bankName: "" }, terms: [],
};

describe("A4 invoice — VAT and non-VAT company", () => {
  it("a VAT-registered company's A4 is unchanged when the flag is absent or true", () => {
    expect(renderToStaticMarkup(<DocumentA4 {...a4} vatRegistered />)).toBe(renderToStaticMarkup(<DocumentA4 {...a4} />));
  });
  it("the non-VAT company's A4 states no VAT row", () => {
    const html = renderToStaticMarkup(<DocumentA4 {...a4} vatRegistered={false} />);
    expect(html).toContain("Not registered for VAT");
    expect(html).not.toMatch(/>VAT</);
    expect(html).not.toContain("VAT NUMBER");
  });
  it("a VAT-registered issuer always prints its VAT number line", () => {
    expect(renderToStaticMarkup(<DocumentA4 {...a4} vatRegistered />)).toContain("VAT NUMBER");
  });
});

describe("overlayIssuer — whose identity the paper prints", () => {
  const settings = { trading_name: "Carfectionist", legal_name: "Diamondbrite Ltd", brn: "C1", vat_number: "VAT1", phone: "5", address: "Moka" };
  it("the default company (or none) is the settings row, untouched", () => {
    expect(overlayIssuer(settings, null)).toEqual({ shop: settings, vatRegistered: true, isDefault: true });
    expect(overlayIssuer(settings, { is_default: true, vat_registered: true, trading_name: "Other" }).shop).toEqual(settings);
  });
  it("another company lays its identity over the shop's, sharing only address and contact", () => {
    const got = overlayIssuer(settings, { is_default: false, vat_registered: false, legal_name: "Wheel Services Ltd", trading_name: "Wheel Services", brn: "C2", vat_number: null, phone: "", address: null });
    expect(got.isDefault).toBe(false);
    expect(got.vatRegistered).toBe(false);
    expect(got.shop).toMatchObject({ trading_name: "Wheel Services", legal_name: "Wheel Services Ltd", brn: "C2", vat_number: null, phone: "5", address: "Moka" });
  });
  it("never borrows the other company's BRN, VAT number, names or bank account", () => {
    const shop = { ...settings, bank_account_number: "000111", bank_name: "MCB", bank_account_name: "Diamondbrite Ltd" };
    const got = overlayIssuer(shop, { is_default: false, vat_registered: true, legal_name: "Wheel Services Ltd", trading_name: "", brn: "", vat_number: "", bank_account_number: null });
    expect(got.shop).toMatchObject({
      legal_name: "Wheel Services Ltd", trading_name: "Wheel Services Ltd", brn: null, vat_number: null,
      bank_account_number: null, bank_name: null, bank_account_name: null, phone: "5", address: "Moka",
    });
  });
});
