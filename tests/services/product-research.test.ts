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
  includeSources?: boolean;
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
  const sources = options.includeSources === false ? [] : [{
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

  test("generates conventional defaults in one structured request", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const serialized = JSON.stringify(body);
      expect(body.tools).toBeUndefined();
      expect(serialized).toContain("input_image");
      expect(serialized).toContain("conventional packed shipping estimates");
      return new Response(JSON.stringify({
        output_text: JSON.stringify(researchFixture({
          confidence: "low",
          includeSources: false
        }))
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const result = await generateProductResearchWithPacky({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        categoryHint: "Women's Jewellery",
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
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.package).toEqual({
      weightKg: 0.12,
      lengthCm: 12,
      widthCm: 8,
      heightCm: 3
    });
  });

  test("builds a vision-assisted conventional default request for GPT-5.6 SOL", () => {
    const body = buildProductResearchRequest({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        categoryHint: "Women's Jewellery",
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
      store: false
    });
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(body)).toContain("input_image");
    expect(JSON.stringify(body)).toContain("strict JSON");
    expect(JSON.stringify(body)).toContain("conventional packed shipping estimates");
    expect(JSON.stringify(body)).toContain(
      "| Fashion / Women's Fashion / Women's Jewellery | 950 |"
    );
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
  ])("uses conventional package defaults for $name", ({
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

    expect(result.package).toEqual({
      weightKg: 0.12,
      lengthCm: 12,
      widthCm: 8,
      heightCm: 3
    });
    expect(result.issues).toContain(
      "Package weight and dimensions use conventional estimates."
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

    expect(result.package).toEqual({
      weightKg: 0.12,
      lengthCm: 12,
      widthCm: 8,
      heightCm: 3
    });
    expect(result.issues).toContain("Package sources conflict and need review.");
    expect(result.issues).toContain(
      "Package weight and dimensions use conventional estimates."
    );
  });

  test("accepts low-confidence conventional package defaults without sources", () => {
    const raw = researchFixture({
      confidence: "low",
      includeSources: false
    });
    const result = validateProductResearch({
      raw,
      annotatedUrls: [],
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: { sellingPoints: "necklace", images: [], imageUrls: [] }
    });

    expect(result.package).toEqual({
      weightKg: 0.12,
      lengthCm: 12,
      widthCm: 8,
      heightCm: 3
    });
    expect(result.issues).toContain(
      "Package weight and dimensions use conventional estimates."
    );
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
    expect(result.issues).not.toContain(
      "Package weight and dimensions use conventional estimates."
    );
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

  test("normalizes multicolour selling points to the DSZ colour value", () => {
    const raw = researchFixture();
    const result = validateProductResearch({
      raw: {
        ...raw,
        colour: "Gold-tone with pink and purple accents"
      },
      annotatedUrls: ["https://supplier.example.com/item"],
      categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      input: {
        sellingPoints: "Multicolour tourmaline and pearl necklace",
        images: [],
        imageUrls: []
      }
    });

    expect(result.colour).toBe("Multicolor");
    expect(result.issues).not.toContain("Colour needs review.");
  });
});
