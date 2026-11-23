import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PosRulesSettings } from "@/lib/supabase/queries/pos-rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./pos-rules-actions", () => ({ savePosRulesAction: vi.fn() }));

import { PosRulesForm } from "./PosRulesForm";

const rules: PosRulesSettings = {
  carwashPct: 5,
  defaultPolicyService: "none",
  defaultPolicyGoods: "free",
  defaultOpeningFloat: 0,
  allowNegativeStock: true,
  reversalRequiresOwner: false,
};

describe("PosRulesForm", () => {
  it("removes carwash controls and uses tyre-centre wording for a tyre shop", () => {
    const html = renderToStaticMarkup(<PosRulesForm rules={rules} tyreShop />);

    expect(html).not.toContain("Carwash cap");
    expect(html).not.toContain("Carwash —");
    expect(html).not.toContain("how far a carwash may go");
    expect(html).toContain("Default for tyres &amp; parts");
    expect(html).toContain("Fitting, balancing and alignment services");
  });

  it("keeps the carwash cap and policy for Carfectionist", () => {
    const html = renderToStaticMarkup(<PosRulesForm rules={rules} tyreShop={false} />);

    expect(html).toContain("Carwash cap %");
    expect(html).toContain("Carwash —");
    expect(html).toContain("Default for products");
  });
});
