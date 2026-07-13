// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import {
  buildProductResearchRequest,
  generateProductResearchWithPacky,
  parseCategoryMapping,
  validateProductResearch,
  type ProductResearchImage
} from "../../server/services/productResearch";

const png: ProductResearchImage = {
  mimeType: "image/png",
  buffer: Buffer.from("89504e470d0a1a0a", "hex")
};

function researchFixture(options: {
  sourceUrl?: string;
  confidence?: "high" | "medium" | "low";
  exactProductMatch?: boolean;
  sourcePackageAvailable?: boolean;
  secondSourcePackage?: {
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
} = {}) {
  const sourceUrl = options.sourceUrl || "https://supplier.example.com/item";
  const packageFacts = {
    weightKg: 0.12,
    lengthCm: 12,
    widthCm: 8,
    heightCm: 3
  };
  const sources = [{
    url: sourceUrl,
    title: "Supplier necklace listing",
    matchedVariant: "Multicolour",
    evidence: "The listing identifies the multicolour necklace and its retail package.",
    exactProductMatch: options.exactProductMatch ?? true,
    package: options.sourcePackageAvailable === false ? null : packageFacts
  }];

  if (options.secondSourcePackage) {
    sources.push({
      url: "https://manufacturer.example.com/item",
      title: "Manufacturer necklace listing",
      matchedVariant: "Multicolour",
      evidence: "The manufacturer page identifies the same multicolour necklace.",
      exactProductMatch: true,
      package: options.secondSourcePackage
    });
  }

  return {
    identity: {
      productType: "Tourmaline style stone and pearl necklace",
      variant: "Multicolour",
      matchSummary: "Source image and listing show the same necklace and colourway."
    },
    category: {
      id: 950,
      name: "Fashion / Women's Fashion / Women's Jewellery"
    },
    colour: "Multicolor",
    package: { ...packageFacts, confidence: options.confidence || "high" },
    sources,
    riskFlags: [],
    reviewNotes: []
  };
}

describe("product research request", () => {
  test("retries transient Packy failures before surfacing the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("", { status: 503 })
    );

    await expect(generateProductResearchWithPacky({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        images: [],
        imageUrls: []
      },
      images: [png],
      fieldRules: "Current DSZ field rules.",
      categoryMapping:
        "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      uploadSop: "Current full upload SOP.",
      productUploadAu: "Current Australian upload rules.",
      env: {
        PACKY_TEXT_API_KEY: "text-key",
        PACKY_TEXT_MODEL: "gpt-5.6-sol"
      },
      fetchImpl
    })).rejects.toThrow("Packy product research API failed: 503");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("retries transient Packy transport failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(generateProductResearchWithPacky({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        images: [],
        imageUrls: []
      },
      images: [png],
      fieldRules: "Current DSZ field rules.",
      categoryMapping:
        "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      uploadSop: "Current full upload SOP.",
      productUploadAu: "Current Australian upload rules.",
      env: {
        PACKY_TEXT_API_KEY: "text-key",
        PACKY_TEXT_MODEL: "gpt-5.6-sol"
      },
      fetchImpl
    })).rejects.toThrow("fetch failed");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("sends source images, current rules and web search to GPT-5.6 SOL", () => {
    const body = buildProductResearchRequest({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        images: ["source.png"],
        imageUrls: []
      },
      images: [png],
      fieldRules: "Current DSZ field rules.",
      categoryMapping:
        "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      uploadSop: "Current full upload SOP.",
      productUploadAu: "Current Australian upload rules.",
      model: "gpt-5.6-sol"
    });

    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      stream: true,
      store: false,
      tools: [{ type: "web_search" }]
    });
    expect(body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "input_image",
        image_url: expect.stringMatching(/^data:image\/png;base64,/)
      }),
      expect.objectContaining({
        type: "input_text",
        text: expect.stringContaining("Similar-product estimates are forbidden.")
      })
    ]));
    expect(JSON.stringify(body)).toContain("Current DSZ field rules.");
    expect(JSON.stringify(body)).toContain("Current full upload SOP.");
    expect(JSON.stringify(body)).toContain("Current Australian upload rules.");
  });

  test.each([
    {
      name: "unannotated source",
      annotatedUrls: [] as string[],
      sourceUrl: "https://supplier.example.com/item",
      exactProductMatch: true,
      confidence: "high" as const,
      sourcePackageAvailable: true
    },
    {
      name: "non-HTTPS source",
      annotatedUrls: ["https://supplier.example.com/item"],
      sourceUrl: "http://supplier.example.com/item",
      exactProductMatch: true,
      confidence: "high" as const,
      sourcePackageAvailable: true
    },
    {
      name: "medium confidence",
      annotatedUrls: ["https://supplier.example.com/item"],
      sourceUrl: "https://supplier.example.com/item",
      exactProductMatch: true,
      confidence: "medium" as const,
      sourcePackageAvailable: true
    },
    {
      name: "similar product",
      annotatedUrls: ["https://supplier.example.com/item"],
      sourceUrl: "https://supplier.example.com/item",
      exactProductMatch: false,
      confidence: "high" as const,
      sourcePackageAvailable: true
    },
    {
      name: "source without published package facts",
      annotatedUrls: ["https://supplier.example.com/item"],
      sourceUrl: "https://supplier.example.com/item",
      exactProductMatch: true,
      confidence: "high" as const,
      sourcePackageAvailable: false
    }
  ])("does not accept package measurements from $name", ({
    annotatedUrls,
    sourceUrl,
    exactProductMatch,
    confidence,
    sourcePackageAvailable
  }) => {
    const result = validateProductResearch({
      raw: researchFixture({
        sourceUrl,
        exactProductMatch,
        confidence,
        sourcePackageAvailable
      }),
      annotatedUrls,
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: { sellingPoints: "necklace", images: [], imageUrls: [] }
    });

    expect(result.package).toEqual({});
    expect(result.issues).toContain(
      "Package weight and dimensions need verified same-product evidence."
    );
  });

  test("rejects conflicting exact-product package facts", () => {
    const result = validateProductResearch({
      raw: researchFixture({
        secondSourcePackage: {
          weightKg: 0.2,
          lengthCm: 14,
          widthCm: 9,
          heightCm: 4
        }
      }),
      annotatedUrls: [
        "https://supplier.example.com/item",
        "https://manufacturer.example.com/item"
      ],
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: { sellingPoints: "necklace", images: [], imageUrls: [] }
    });

    expect(result.package).toEqual({});
    expect(result.issues).toContain("Package sources conflict and need review.");
  });

  test("accepts a category only when ID and path match the mapping", () => {
    expect(parseCategoryMapping(
      "| Fashion / Women's Fashion / Women's Jewellery | 950 |"
    )).toEqual(new Map([
      [950, "Fashion / Women's Fashion / Women's Jewellery"]
    ]));
  });

  test("preserves verified manual measurements over web research", () => {
    const result = validateProductResearch({
      raw: researchFixture(),
      annotatedUrls: ["https://supplier.example.com/item"],
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: {
        sellingPoints: "necklace",
        images: [],
        imageUrls: [],
        packageWeightKg: 0.2,
        lengthCm: 15,
        widthCm: 10,
        heightCm: 4
      }
    });

    expect(result.package).toEqual({
      weightKg: 0.2,
      lengthCm: 15,
      widthCm: 10,
      heightCm: 4
    });
  });

  test("preserves a mapped manual category and valid manual colour", () => {
    const result = validateProductResearch({
      raw: researchFixture(),
      annotatedUrls: ["https://supplier.example.com/item"],
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: {
        sellingPoints: "necklace",
        images: [],
        imageUrls: [],
        categoryId: 950,
        categoryName: "Fashion / Women's Fashion / Women's Jewellery",
        colour: "Black / White / Beige"
      }
    });

    expect(result.category).toEqual({
      id: 950,
      name: "Fashion / Women's Fashion / Women's Jewellery"
    });
    expect(result.colour).toBe("Black / White / Beige");
  });
});
