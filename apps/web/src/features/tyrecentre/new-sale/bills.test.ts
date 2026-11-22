import { describe, expect, it } from "vitest";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import type { SaleCompany } from "@/lib/supabase/queries/tyrecentre-sale";
import { EMPTY_BASKET, addProduct, setOrderDiscount, setQty, type Basket } from "@/features/counter/settle";
import { billsBlockReason, billsOf, companyDiscountsPayload, grandTotalCents, NO_DISCOUNT } from "./bills";

const TYRES: SaleCompany = { id: "00000000-0000-4000-8000-00000000000a", name: "Tyre Co", vatRegistered: true, vatRate: 15, isDefault: true };
const SERVICES: SaleCompany = { id: "00000000-0000-4000-8000-00000000000b", name: "Service Co", vatRegistered: false, vatRate: 0, isDefault: false };

const product = (id: string, priceCents: number, vatRate: number, legalEntityId: string | null, policy: CounterProduct["discountPolicy"] = "free"): CounterProduct => ({
  id, name: id, kind: "product", category: null, priceCents, vatRate, discountPolicy: policy, priceIncludesVat: false,
  barcode: null, photoUrl: null, isStocked: false, shopQty: 0, warehouseQty: 0, legalEntityId,
});
const tyre = product("tyre", 200000, 15, null);          // Rs 2,000 + VAT → Rs 2,300 each
const align = product("align", 130000, 0, SERVICES.id);  // Rs 1,300, no VAT

const cart = (): Basket => setQty(addProduct(addProduct(EMPTY_BASKET, tyre), align), "tyre", 2);

describe("billsOf — one bill per company", () => {
  it("splits a mixed cart into the tyre bill and the service bill, in company order", () => {
    const bills = billsOf(cart(), [TYRES, SERVICES], {}, 10);
    expect(bills.map((b) => [b.company.name, b.lines.map((l) => l.product.id), b.totals.totalCents])).toEqual([
      ["Tyre Co", ["tyre"], 460000],
      ["Service Co", ["align"], 130000],
    ]);
    expect(bills[1].totals.vatCents).toBe(0);
    expect(grandTotalCents(bills)).toBe(590000);
  });

  it("a product with no company is the main company's", () => {
    const bills = billsOf(addProduct(EMPTY_BASKET, tyre), [SERVICES, TYRES], {}, 10);
    expect(bills).toHaveLength(1);
    expect(bills[0].company.id).toBe(TYRES.id);
  });

  it("a company with nothing in the cart has no bill", () => {
    expect(billsOf(addProduct(EMPTY_BASKET, align), [TYRES, SERVICES], {}, 10).map((b) => b.company.id)).toEqual([SERVICES.id]);
  });

  it("each company's discount applies to its own bill only", () => {
    const bills = billsOf(cart(), [TYRES, SERVICES], { [SERVICES.id]: { ...NO_DISCOUNT, kind: "amount", value: 10000 } }, 10);
    expect(bills.map((b) => b.totals.totalCents)).toEqual([460000, 120000]);
    expect(companyDiscountsPayload(bills)).toEqual([{ legalEntityId: SERVICES.id, kind: "amount", value: 10000, reason: undefined }]);
  });

  it("a one-company shop keeps the whole-sale discount — the single invoice it always was", () => {
    const b = setOrderDiscount(addProduct(EMPTY_BASKET, tyre), "percent", 10);
    const bills = billsOf(b, [TYRES], { [TYRES.id]: { ...NO_DISCOUNT, kind: "percent", value: 50 } }, 10);
    expect(bills).toHaveLength(1);
    expect(bills[0].totals.totalCents).toBe(207000);
  });

  it("checks each bill's discount rules on its own and names the company", () => {
    const svc = product("svc", 130000, 0, SERVICES.id, "none");
    const b = addProduct(addProduct(EMPTY_BASKET, tyre), svc);
    const bills = billsOf(b, [TYRES, SERVICES], { [SERVICES.id]: { ...NO_DISCOUNT, kind: "amount", value: 5000 } }, 10);
    expect(bills[0].blockReason).toBeNull();
    expect(billsBlockReason(bills)).toMatch(/^Service Co: /);
  });

  it("an empty cart has no bills", () => {
    expect(billsOf(EMPTY_BASKET, [TYRES, SERVICES], {}, 10)).toEqual([]);
  });
});
