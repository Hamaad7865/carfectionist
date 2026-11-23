import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyChip } from "./CompanySplitPanel";

describe("CompanyChip", () => {
  it("clips a long company name to the width available in its line", () => {
    const html = renderToStaticMarkup(
      <CompanyChip name="Prayag Tyre Center & SpareParts" index={0} />,
    );

    expect(html).toContain('title="Sold by Prayag Tyre Center &amp; SpareParts"');
    expect(html).toContain("min-w-0 max-w-full");
    expect(html).toContain('<span class="min-w-0 truncate">Prayag Tyre Center &amp; SpareParts</span>');
  });
});
