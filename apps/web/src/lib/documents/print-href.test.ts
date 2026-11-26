import { describe, expect, it } from "vitest";
import { parseAlsoDocIds, printDocsHref } from "./print-href";

const ID_1 = "5056dc73-9572-4a2e-8c87-148bdb09fbb8";
const ID_2 = "7162dc73-9572-4a2e-8c87-148bdb09fcc9";
const ID_3 = "8273dc73-9572-4a2e-8c87-148bdb09fdd0";

describe("printDocsHref", () => {
  it("builds a single-window multi-document print URL in company order", () => {
    expect(printDocsHref([ID_1])).toBe(`/print/doc/${ID_1}`);
    expect(printDocsHref([ID_1, ID_2])).toBe(`/print/doc/${ID_1}?also=${ID_2}`);
    expect(printDocsHref([ID_1, ID_2, ID_1, ID_3])).toBe(`/print/doc/${ID_1}?also=${ID_2},${ID_3}`);
  });
});

describe("parseAlsoDocIds", () => {
  it("keeps valid unique sibling UUIDs and drops the primary or malformed ids", () => {
    expect(parseAlsoDocIds(ID_1, undefined)).toEqual([]);
    expect(parseAlsoDocIds(ID_1, `${ID_1}, not-a-uuid, ${ID_2}, ${ID_2}, ${ID_3}`)).toEqual([ID_2, ID_3]);
    expect(parseAlsoDocIds(ID_1, `${ID_2},${ID_3}`, 1)).toEqual([ID_2]);
  });
});
