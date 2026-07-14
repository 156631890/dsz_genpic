import { describe, expect, test } from "vitest";
import {
  CATEGORY_MATCH_REQUIRED_MESSAGE,
  CategoryMatchRequiredError,
  formatCategoryCandidates,
  parseCategoryEntries,
  rankCategoryEntries,
  resolveMappedCategory
} from "../../server/services/categoryMatcher";

const mapping = [
  "| Fashion / Men's Fashion / Men's Jewellery | 924 |",
  "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
  "| Duplicate category that must be ignored | 950 |",
  "| Fashion / Women's Fashion / Women's Swimwear | 956 |",
  "| Appliances / Kitchen Appliances / Kitchen Appliance Accessories | 1022 |",
  "| malformed | not-an-id |"
].join("\n");

describe("category matcher", () => {
  test("parses canonical rows and ignores duplicate IDs", () => {
    expect(parseCategoryEntries(mapping)).toEqual([
      { id: 924, name: "Fashion / Men's Fashion / Men's Jewellery" },
      { id: 950, name: "Fashion / Women's Fashion / Women's Jewellery" },
      { id: 956, name: "Fashion / Women's Fashion / Women's Swimwear" },
      {
        id: 1022,
        name: "Appliances / Kitchen Appliances / Kitchen Appliance Accessories"
      }
    ]);
  });

  test("normalises American spelling and selects the canonical leaf", () => {
    const ranked = rankCategoryEntries(
      parseCategoryEntries(mapping),
      "Women's Jewelry"
    );

    expect(ranked[0]).toMatchObject({
      id: 950,
      name: "Fashion / Women's Fashion / Women's Jewellery",
      highConfidence: true
    });
  });

  test("compares common singular and plural category tokens", () => {
    expect(rankCategoryEntries(
      parseCategoryEntries(mapping),
      "Kitchen Appliance Accessory"
    )[0]).toMatchObject({ id: 1022, highConfidence: true });
  });

  test("lets an unambiguous hint override a conflicting model category", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "Women's Jewelry",
      generatedCategoryId: 956
    })).toMatchObject({
      category: {
        id: 950,
        name: "Fashion / Women's Fashion / Women's Jewellery"
      },
      source: "hint"
    });
  });

  test("canonicalises a semantic model ID for a Chinese hint", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "项链",
      generatedCategoryId: 950
    })).toMatchObject({
      category: {
        id: 950,
        name: "Fashion / Women's Fashion / Women's Jewellery"
      },
      source: "model"
    });
  });

  test("falls back from an invalid model ID to the best local hint", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "Women's Jewelry",
      generatedCategoryId: 999999
    }).category.id).toBe(950);
  });

  test("requires a more specific hint when no live category can be resolved", () => {
    const resolve = () => resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "unclassifiable phrase",
      generatedCategoryId: 999999
    });

    expect(CATEGORY_MATCH_REQUIRED_MESSAGE).toBe(
      "No valid Dropshipzone category matched. Enter a more specific category hint and generate again."
    );
    expect(CategoryMatchRequiredError).toBeTypeOf("function");
    expect(resolve).toThrow(CategoryMatchRequiredError);
    expect(resolve).toThrow(CATEGORY_MATCH_REQUIRED_MESSAGE);
  });

  test("formats only canonical mapping rows for AI selection", () => {
    expect(formatCategoryCandidates(
      mapping,
      "Women's Jewelry",
      "necklace"
    )).toContain(
      "| Fashion / Women's Fashion / Women's Jewellery | 950 |"
    );
  });

  test("rejects an unusable mapping", () => {
    expect(() => resolveMappedCategory({
      categoryMapping: "# no category rows",
      categoryHint: "jewellery"
    })).toThrow("Category mapping is unavailable.");
  });
});
