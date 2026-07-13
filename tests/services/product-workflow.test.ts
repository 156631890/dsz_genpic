// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  buildAdminProductPayload,
  buildAdminRequestBody,
  resolveAdminConfig,
  uploadProduct,
  validateDszProductFields
} from "../../server/services/adminUploader";
import {
  buildDszGenerationMessages,
  calculateCbm,
  calculateVendorPrice,
  formatSku,
  generateDszFieldsWithPacky,
  loadRuleDocuments,
  parseGeneratedFields,
  standardZoneRates,
  type RuleDocuments
} from "../../server/services/dszRules";
import {
  extractCanonicalProductFooter,
  loadProductSystemPrompt
} from "../../server/services/productCopy";
import { generateCopyWithPacky } from "../../server/services/copyGenerator";
import {
  buildPackyEditRequest,
  generateShopifyProductImagesWithPacky,
  generateImageWithPacky
} from "../../server/services/packyImages";
import { buildImgbbUploadRequest } from "../../server/services/imageUploader";
import { requestProductFields } from "../../src/productWorkflow";
import type {
  DszProductFields,
  ProductInput,
  ProductResearchEvidence
} from "../../shared/product";

const input: ProductInput = {
  sellingPoints:
    "Soft cotton blend thong underwear, breathable stretch, black white beige colour options, everyday comfortable fit.",
  categoryHint: "Women's Intimates",
  images: ["one.png", "two.png", "three.png", "four.png"],
  imageUrls: [
    "https://cdn.example.com/1.jpg",
    "https://cdn.example.com/2.jpg",
    "https://cdn.example.com/3.jpg",
    "https://cdn.example.com/4.jpg"
  ],
  purchasePriceCny: 12,
  packageWeightKg: 0.08,
  lengthCm: 15,
  widthCm: 17,
  heightCm: 2
};

const fields: DszProductFields = {
  category: 947,
  categories: "947",
  categoryName: "Fashion / Women's Fashion / Women's Intimates",
  product_name:
    "Women Cotton Thong Underwear - Stretch Cotton Blend - Black White Beige, Breathable Everyday Comfort",
  sku: "Elosung10001",
  status: 1,
  ean_code: "4748549810",
  stock: 1000,
  weight: 0.08,
  length: 15,
  width: 17,
  height: 2,
  cbm: 0.00051,
  brand_name: "Elosung",
  colour: "Black / White / Beige",
  enabled: true,
  description:
    "<p><strong>Product Overview</strong></p><p>Women cotton thong underwear designed for everyday comfort.</p><p><strong>Key Features</strong></p><ul><li>Soft cotton blend supports comfortable daily wear.</li></ul><p><strong>Notes</strong></p><p>Wash before first use.</p><p><strong>Returns, Refunds and Replacements </strong><br />Products received faulty, damaged, or not as described are eligible for review under ACL.</p><p><strong>Delivery Timeframe</strong></p><p>Delivery timeframes exclude weekends and public holidays.</p>",
  vendor_price: 19.74,
  rrp: 39.48,
  zone_rates: standardZoneRates(),
  images: input.imageUrls,
  risk_flags: [],
  review_notes: []
};

const workflowPng = Buffer.from("89504e470d0a1a0a", "hex");
const workflowTitle =
  "Multicolour Tourmaline and Pearl Necklace - Layered Statement Design, Adjustable Everyday Styling, Gift Ready Jewellery";
const workflowFooter = extractCanonicalProductFooter(await loadProductSystemPrompt());
const workflowDescription =
  `<p><strong>Product Overview</strong></p><p>A multicolour necklace for everyday styling.</p>${workflowFooter}`;
const workflowRules: RuleDocuments = {
  fieldRules: "Current DSZ field rules.",
  productPrompt: await loadProductSystemPrompt(),
  categoryMapping:
    "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
  uploadSop: "Current full product upload SOP.",
  productUploadAu: "Current Australian upload rules."
};

function workflowSse(events: unknown[]): Response {
  return new Response([
    ...events.map((event) => `data: ${JSON.stringify(event)}`),
    "data: [DONE]",
    ""
  ].join("\n\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function researchStream(confidence: "high" | "medium" = "high"): Response {
  const sourceUrl = "https://supplier.example.com/item";
  return workflowSse([
    {
      type: "response.output_text.delta",
      delta: JSON.stringify({
        identity: {
          productType: "Tourmaline style stone and pearl necklace",
          variant: "Multicolour",
          matchSummary: "The image and listing show the same necklace and colourway."
        },
        category: {
          id: 950,
          name: "Fashion / Women's Fashion / Women's Jewellery"
        },
        colour: "Multicolor",
        package: {
          weightKg: 0.12,
          lengthCm: 12,
          widthCm: 8,
          heightCm: 3,
          confidence
        },
        sources: [{
          url: sourceUrl,
          title: "Supplier necklace listing",
          matchedVariant: "Multicolour",
          evidence: "The listing supplies the retail package measurements.",
          exactProductMatch: true,
          package: { weightKg: 0.12, lengthCm: 12, widthCm: 8, heightCm: 3 }
        }],
        riskFlags: [],
        reviewNotes: []
      })
    },
    {
      type: "response.output_text.annotation.added",
      annotation: { type: "url_citation", url: sourceUrl }
    }
  ]);
}

function copyStream(): Response {
  return workflowSse([{
    type: "response.output_text.delta",
    delta: `${workflowTitle}\n${workflowDescription}`
  }]);
}

describe("complete DSZ field generation", () => {
  test("posts source files, facts and identity to the full-field endpoint", async () => {
    const evidence: ProductResearchEvidence = {
      productType: "Cotton thong underwear",
      variant: "Black / White / Beige",
      matchSummary: "The source image matches the cited supplier listing.",
      confidence: "high",
      sources: [{
        url: "https://supplier.example.com/item",
        title: "Supplier product listing",
        matchedVariant: "Black / White / Beige",
        evidence: "The listing supplies the same variant and package facts."
      }]
    };
    const sourceFile = new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ], "product.png", { type: "image/png" });
    const fetchMock = vi.fn(async (
      _url: string | URL | Request,
      _init?: RequestInit
    ) => new Response(JSON.stringify({
      result: {
        fields: { ...fields, providerDebug: "discard-me" },
        source: "ai",
        evidence,
        issues: [],
        providerDebug: "discard-me"
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestProductFields({
      input,
      files: [sourceFile],
      identity: { sku: "Elosung10000", eanCode: "4748549810" }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate-product-fields");
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.getAll("images")).toHaveLength(1);
    expect(JSON.parse(String(body.get("identity")))).toEqual({
      sku: "Elosung10000",
      eanCode: "4748549810"
    });
    expect(result).not.toHaveProperty("providerDebug");
    expect(result.fields).not.toHaveProperty("providerDebug");
  });

  test("researches, writes copy and calculates deterministic DSZ fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(researchStream())
      .mockResolvedValueOnce(copyStream()) as unknown as typeof fetch;

    const result = await generateDszFieldsWithPacky({
      productInput: {
        sellingPoints: "Multicolour tourmaline style stone and pearl necklace",
        categoryHint: "Women's Jewellery",
        purchasePriceCny: 20,
        images: ["source.png"],
        imageUrls: []
      },
      images: [{ mimeType: "image/png", buffer: workflowPng }],
      identity: { sku: "Elosung10000", eanCode: "4748549810" },
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl,
      ruleDocuments: workflowRules
    });

    expect(result.fields).toMatchObject({
      category: 950,
      categories: "950",
      categoryName: "Fashion / Women's Fashion / Women's Jewellery",
      product_name: workflowTitle,
      sku: "Elosung10000",
      status: 1,
      ean_code: "4748549810",
      stock: 1000,
      weight: 0.12,
      length: 12,
      width: 8,
      height: 3,
      brand_name: "Elosung",
      colour: "Multicolor",
      enabled: true,
      description: workflowDescription
    });
    expect(result.fields.cbm).toBe(calculateCbm(12, 8, 3));
    expect(result.fields.vendor_price).toBe(calculateVendorPrice({
      weightKg: 0.12,
      lengthCm: 12,
      widthCm: 8,
      heightCm: 3,
      purchasePriceCny: 20
    }));
    expect(result.fields.zone_rates.nz).toBe(20);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("does not estimate package measurements without exact evidence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(researchStream("medium"))
      .mockResolvedValueOnce(copyStream()) as unknown as typeof fetch;
    const result = await generateDszFieldsWithPacky({
      productInput: {
        sellingPoints: "Multicolour tourmaline style stone and pearl necklace",
        categoryHint: "Women's Jewellery",
        purchasePriceCny: 20,
        images: ["source.png"],
        imageUrls: []
      },
      images: [{ mimeType: "image/png", buffer: workflowPng }],
      identity: { sku: "Elosung10000", eanCode: "4748549810" },
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl,
      ruleDocuments: workflowRules
    });

    expect(result.fields).toMatchObject({
      weight: 0,
      length: 0,
      width: 0,
      height: 0,
      cbm: 0
    });
    expect(result.issues).toContain(
      "Package weight and dimensions need verified same-product evidence."
    );
  });
});

describe("DSZ field rules", () => {
  test("builds Packy messages with uploaded image URLs and rule snippets", () => {
    const productPrompt =
      "【标题生成规则】\n- 标题长度控制在 110 到 200 个字符之间。\n【HTML 描述生成总规则】\n- 描述必须是 Amazon 风格。";
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt,
        categoryMapping: "Women's Intimates | 947",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      }
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("Soft cotton blend thong underwear");
    expect(messages[1].content).toContain("https://cdn.example.com/1.jpg");
    expect(messages[1].content).toContain("F13 Vendor Product Description");
    expect(messages[1].content).toContain(
      "product_name and description must follow the DSZ system prompt rules"
    );
    expect(messages[1].content).toContain(productPrompt);
    expect(messages[1].content).toContain(
      "For product_name and description, PRODUCT PROMPT is the only writing rule source"
    );
    expect(messages[1].content).not.toContain(
      "description must include Product Overview, Key Features, Why It Stands Out and Notes"
    );
    expect(messages[1].content).not.toContain(
      "Use Specifications, Ideal For and FAQ only when supported by reliable input"
    );
    expect(messages[1].content).toContain(
      "return strict JSON for this API call"
    );
    expect(messages[1].content).toContain(
      "Choose exactly one best matching Category_Mapping ID"
    );
    expect(messages[1].content).toContain("JSON");
  });

  test("keeps server-calculated shipping rates out of model-owned fields", async () => {
    const ruleDocuments = await loadRuleDocuments({
      RULES_DIR: "Z:\\missing-dsz-rule-files"
    });
    const messages = buildDszGenerationMessages({ input, ruleDocuments });
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).not.toMatch(/\bnz\b[^\r\n]*\b10\b/i);
    expect(prompt).not.toContain("zone_rates");
    expect(prompt).toContain("Shipping rates are calculated by the server");
    expect(prompt).toContain("length * width * height / 5000");
    expect(prompt).toContain("AUD 20 below 3 kg and AUD 40 at or above 3 kg");
  });

  test("preserves legitimate NZ product content in generation prompts", () => {
    const legitimateContent =
      "NZ women size 10 fit guide must remain product content";
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: {
        fieldRules: "Field rules.",
        productPrompt: legitimateContent,
        categoryMapping: "Category mapping.",
        uploadSop: "Upload SOP.",
        productUploadAu: "AU product content."
      }
    });

    expect(messages[1].content).toContain(legitimateContent);
  });

  test("migrates complete legacy shipping blocks without malformed remnants", () => {
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: {
        fieldRules: [
          "Field rules before shipping.",
          "### Zone Rates format",
          "```python",
          "zone_rates = {",
          "  'act': 0, 'nsw_m': 0,",
          "  'nz': 10",
          "}",
          "```",
          "### Category rules",
          "Field rules after shipping."
        ].join("\n"),
        productPrompt: "Product prompt.",
        categoryMapping: "Category mapping.",
        uploadSop: [
          "Upload rules before shipping.",
          "**Step 5 — Shipping (Incl. GST):**",
          "| Country | Rate |",
          "| AU | 0 |",
          "| NZ | 10 |",
          "",
          "**Pricing examples:**",
          "Upload rules after shipping."
        ].join("\n"),
        productUploadAu: "AU product content."
      }
    });
    const prompt = messages[1].content;
    const codeFenceCount = prompt.match(/```/g)?.length || 0;

    expect(prompt).not.toContain("zone_rates");
    expect(prompt).not.toContain("'act'");
    expect(prompt).not.toContain("'nsw_m'");
    expect(prompt).not.toMatch(/\bnz\b[^\r\n]*\b10\b/i);
    expect(codeFenceCount % 2).toBe(0);
    expect(prompt).toContain("Field rules after shipping.");
    expect(prompt).toContain("**Pricing examples:**");
    expect(prompt).toContain("Upload rules after shipping.");
  });

  test("restricts shipping migration to field rules and upload SOP", () => {
    const productPrompt = "Product prompt keeps zone_rates verbatim.";
    const categoryMapping = "NZ women size 10 category mapping stays verbatim.";
    const productUploadAu = "AU content keeps zone_rates and NZ size 10 verbatim.";
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: {
        fieldRules: "Field rules.",
        productPrompt,
        categoryMapping,
        uploadSop: "Upload SOP.",
        productUploadAu
      }
    });

    expect(messages[1].content).toContain(productPrompt);
    expect(messages[1].content).toContain(categoryMapping);
    expect(messages[1].content).toContain(productUploadAu);
  });

  test("builds standard zone rates from named measurements", () => {
    expect(
      standardZoneRates({
        actualWeightKg: 1,
        lengthCm: 50,
        widthCm: 40,
        heightCm: 30
      }).nz
    ).toBe(40);
  });

  test("parses generated DSZ field JSON from fenced content", () => {
    const parsed = parseGeneratedFields(`
\`\`\`json
${JSON.stringify(fields)}
\`\`\`
`);

    expect(parsed.sku).toBe("Elosung10001");
    expect(parsed.categories).toBe("947");
    expect(parsed.description).toContain("Product Overview");
  });

  test("calculates CBM and vendor price from field rules", () => {
    expect(calculateCbm(15, 17, 2)).toBe(0.00051);
    expect(calculateVendorPrice({
      weightKg: 0.08,
      lengthCm: 15,
      widthCm: 17,
      heightCm: 2,
      purchasePriceCny: 12
    })).toBe(19.74);
  });

  test("formats Elosung SKU from local counter value", () => {
    expect(formatSku(10001)).toBe("Elosung10001");
  });

  test("loads bundled rule documents when external rule files are missing", async () => {
    const rules = await loadRuleDocuments({
      RULES_DIR: "Z:\\missing-dsz-rule-files"
    });

    expect(rules.fieldRules).toContain("Dropshipzone");
    expect(rules.productPrompt).toContain("固定页脚规则");
    expect(rules.categoryMapping).toContain("Fashion / Women's Fashion / Women's Intimates");
    expect(rules.uploadSop).toContain("Dropshipzone 16 字段");
    expect(rules.productUploadAu).toContain("澳洲独立站");
  });

  test("loads all provided DSZ rule documents from the rules directory", async () => {
    const rulesDir = await mkdtemp(join(tmpdir(), "dsz-rules-"));
    const productPrompt =
      "【标题生成规则】\n标题必须是纯英文电商标题。\n【HTML 描述生成总规则】\n描述必须是英文单行 HTML。";

    try {
      await Promise.all([
        writeFile(
          join(rulesDir, "Dropshipzone_Field_Rules.md"),
          "Dropshipzone Supplier API actual format. name and price are required.",
          "utf8"
        ),
        writeFile(
          join(rulesDir, "DSZ系统prompt 4月20版本.txt"),
          productPrompt,
          "utf8"
        ),
        writeFile(
          join(rulesDir, "Category_Mapping.md"),
          "Fashion / Women's Fashion / Women's Intimates | 947",
          "utf8"
        ),
        writeFile(
          join(rulesDir, "Full_Product_Upload_SOP.md"),
          "Dropshipzone 16 字段上品规则. Vendor Price. Vendor RRP.",
          "utf8"
        ),
        writeFile(
          join(rulesDir, "Product_Upload_AU.md"),
          "澳洲独立站. 标题生成规则. HTML 描述结构.",
          "utf8"
        )
      ]);

      const rules = await loadRuleDocuments({ RULES_DIR: rulesDir });

      expect(rules.fieldRules).toContain("name and price are required");
      expect(rules.productPrompt).toBe(productPrompt);
      expect(rules.categoryMapping).toContain("Women's Intimates | 947");
      expect(rules.uploadSop).toContain("Dropshipzone 16 字段");
      expect(rules.productUploadAu).toContain("澳洲独立站");
    } finally {
      await rm(rulesDir, { recursive: true, force: true });
    }
  });

  test("includes bundled category mapping and upload SOP in Packy field prompts", async () => {
    const rules = await loadRuleDocuments({
      RULES_DIR: "Z:\\missing-dsz-rule-files"
    });
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: rules
    });
    const userMessage = messages[1].content;

    expect(userMessage).toContain("Fashion / Women's Fashion / Women's Intimates");
    expect(userMessage).toContain("FULL PRODUCT UPLOAD SOP");
    expect(userMessage).toContain("Use ean_code as a 10 digit string");
  });

  test("falls back to local rules when Packy field generation is temporarily unavailable", async () => {
    const result = await generateDszFieldsWithPacky({
      productInput: input,
      env: {
        PACKY_API_KEY: "packy-key"
      },
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Women's Intimates | 947",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      },
      fetchImpl: vi.fn(async () => new Response("Service unavailable", { status: 503 })) as unknown as typeof fetch
    });

    expect(result.source).toBe("fallback");
    expect(result.fields.images).toEqual(input.imageUrls);
    expect(result.fields.review_notes).toContain(
      "Packy field generation failed with 503. Local fallback fields were generated."
    );
    expect(result.fields.description).toContain("<p><strong>Product Overview</strong></p>");
    expect(result.fields.description).toContain("<p><strong>Key Features</strong></p>");
    expect(result.fields.description).toContain("Uses the uploaded product images");
    expect(result.fields.description).toContain("Highlights practical everyday value");
    expect(result.fields.description).toContain("Keeps the product page readable");
    expect(result.fields.description).toContain("Prepared as single-line HTML");
    expect(result.fields.description).toContain("<p><strong>Why It Stands Out</strong></p>");
    expect(result.fields.description).toContain("<p><strong>Notes</strong></p>");
    expect(result.fields.description).not.toContain("<p><strong>Ideal For</strong></p>");
    expect(result.fields.description).not.toMatch(/\r|\n/);
  });

  test("repairs invalid AI HTML descriptions through Packy with the DSZ product prompt", async () => {
    const productPrompt =
      "【HTML 描述生成总规则】\n- 描述必须是 Amazon 风格。\n【HTML 描述建议结构】\nProduct Overview, Key Features, Why It Stands Out, Notes.";
    const repairedDescription =
      "<p><strong>Product Overview</strong></p><p>Women cotton thong underwear designed for breathable everyday comfort and smooth daily wear.</p><p><strong>Key Features</strong></p><ul><li>Soft cotton blend helps support comfortable everyday wear.</li><li>Breathable stretch fabric supports flexible movement.</li><li>Low-profile thong cut helps reduce visible lines under outfits.</li><li>Multiple colour options support easy wardrobe matching.</li></ul><p><strong>Why It Stands Out</strong></p><p>The design focuses on a practical balance of softness, stretch and everyday fit without unsupported claims.</p><p><strong>Notes</strong></p><p>Please check the selected colour and size before purchase.</p><p><strong>Returns, Refunds and Replacements </strong><br />Products that are received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with the Australian Consumer Law (ACL). We are committed to ensuring all products meet the standards of quality and reliability expected by our customers. However, please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p><p><strong>Delivery Timeframe</strong></p><p>Please note that we cannot guarantee the exact date of arrival, and the delivery timeframes excluding weekends and public holidays are as follows:</p><ul><li>For customers in Victoria, approximately 7-10 working days;</li><li>For customers in NSW, SA, ACT, and QLD, approximately 9-12 working days;</li><li>For customers in WA, NT, and TAS, approximately 9-12 working days.</li></ul>";
    let callIndex = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      const currentCallIndex = callIndex;
      callIndex += 1;
      const body = JSON.parse(String(init?.body));

      if (currentCallIndex === 1) {
        expect(body.messages[1].content).toContain(productPrompt);
        expect(body.messages[1].content).toContain(
          "For product_name and description, PRODUCT PROMPT is the only writing rule source"
        );
        expect(body.messages[1].content).toContain(
          "Return JSON with keys: product_name, description"
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  currentCallIndex === 0
                    ? {
                        ...fields,
                        description: "<p>Comfortable daily underwear.</p>"
                      }
                    : {
                        product_name:
                          "Women Cotton Thong Underwear - Soft Stretch Blend, Breathable Everyday Fit, Low Profile Comfort",
                        description: repairedDescription
                      }
                )
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateDszFieldsWithPacky({
      productInput: input,
      env: {
        PACKY_API_KEY: "packy-key"
      },
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt,
        categoryMapping: "Women's Intimates | 947",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      },
      fetchImpl
    });

    expect(result.source).toBe("ai");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.fields.product_name).toBe(
      "Women Cotton Thong Underwear - Soft Stretch Blend, Breathable Everyday Fit, Low Profile Comfort"
    );
    expect(result.fields.description).toBe(repairedDescription);
    expect(result.fields.description).toContain("<p><strong>Product Overview</strong></p>");
    expect(result.fields.description).toContain("<p><strong>Key Features</strong></p>");
    expect(result.fields.description).toContain("<p><strong>Why It Stands Out</strong></p>");
    expect(result.fields.description).toContain("<p><strong>Notes</strong></p>");
    expect(result.fields.description).not.toContain("<p><strong>Ideal For</strong></p>");
    expect(result.fields.description).toContain("Returns, Refunds and Replacements");
    expect(result.fields.description).not.toMatch(/\r|\n/);
  });

  test("uses explicit category hint to correct stale AI category IDs", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(fields) } }]
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await generateDszFieldsWithPacky({
      productInput: {
        ...input,
        categoryHint: "Women's Swimwear"
      },
      env: {
        PACKY_API_KEY: "packy-key"
      },
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Fashion / Women's Fashion / Women's Swimwear | 956",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      },
      fetchImpl
    });

    expect(result.source).toBe("ai");
    expect(result.fields.category).toBe(956);
    expect(result.fields.categories).toBe("956");
    expect(result.fields.categoryName).toBe("Fashion / Women's Fashion / Women's Swimwear");
  });

  test("uses Chinese category hints for local fallback category IDs", async () => {
    const result = await generateDszFieldsWithPacky({
      productInput: {
        ...input,
        categoryHint: "女士泳装",
        sellingPoints: "women beach swimwear"
      },
      env: {},
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Fashion / Women's Fashion / Women's Swimwear | 956",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      }
    });

    expect(result.source).toBe("fallback");
    expect(result.fields.category).toBe(956);
    expect(result.fields.categories).toBe("956");
    expect(result.fields.categoryName).toBe("Fashion / Women's Fashion / Women's Swimwear");
  });

  test("prefers specific gendered category hints over generic keywords", async () => {
    const result = await generateDszFieldsWithPacky({
      productInput: {
        ...input,
        categoryHint: "Men's Swimwear",
        sellingPoints: "quick dry beach swim shorts"
      },
      env: {},
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Fashion / Men's Fashion / Men's Swimwear | 961",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      }
    });

    expect(result.fields.category).toBe(961);
    expect(result.fields.categories).toBe("961");
    expect(result.fields.categoryName).toBe("Fashion / Men's Fashion / Men's Swimwear");
  });

  test("uses the field-specific Packy API key for DSZ field generation", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.headers).toEqual({
        Authorization: "Bearer field-key",
        "Content-Type": "application/json"
      });
      expect(JSON.parse(String(init?.body)).model).toBe("field-model");

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(fields) } }]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateDszFieldsWithPacky({
      productInput: input,
      env: {
        PACKY_API_KEY: "shared-key",
        PACKY_FIELD_API_KEY: "field-key",
        PACKY_TEXT_MODEL: "field-model"
      },
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Women's Intimates | 947",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      },
      fetchImpl
    });

    expect(result.source).toBe("ai");
    expect(result.fields.sku).toBe("Elosung10001");
  });
});

describe("Packy copy helpers", () => {
  test("uses the field-specific Packy API key for text copy generation", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.headers).toEqual({
        Authorization: "Bearer field-key",
        "Content-Type": "application/json"
      });
      expect(JSON.parse(String(init?.body)).model).toBe("field-model");

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Women Cotton Thong Underwear",
                  bullets: ["Soft cotton blend"],
                  description: "Comfortable everyday underwear"
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateCopyWithPacky({
      draft: {
        sku: "Elosung10001",
        productType: "Women Cotton Thong Underwear",
        material: "95% cotton, 5% elastane",
        colors: "Black / White / Beige",
        sizes: "S-XL",
        packaging: "Single pack",
        weight: "20g",
        cartonSpec: "600 pieces per carton",
        sellingPoints: "Soft stretch cotton for daily comfort.",
        imageUrls: []
      },
      env: {
        PACKY_API_KEY: "shared-key",
        PACKY_FIELD_API_KEY: "field-key",
        PACKY_TEXT_MODEL: "field-model"
      },
      fetchImpl
    });

    expect(result.title).toBe("Women Cotton Thong Underwear");
  });
});

describe("image upload helpers", () => {
  test("builds ImgBB upload request without exposing key in headers", () => {
    const request = buildImgbbUploadRequest({
      apiKey: "imgbb-secret"
    });

    expect(request.url).toBe("https://api.imgbb.com/1/upload?key=imgbb-secret");
    expect(request.headers).toEqual({});
  });
});

describe("Packy image helpers", () => {
  test("builds Packy gpt-image-2 edit request config", () => {
    const request = buildPackyEditRequest({
      baseUrl: "https://www.packyapi.com",
      prompt: "Create a white background detail image from the uploaded product image.",
      productType: "Women Cotton Thong Underwear"
    });

    expect(request.url).toBe("https://www.packyapi.com/v1/images/edits");
    expect(request.fields.model).toBe("gpt-image-2");
    expect(request.fields.n).toBe("1");
    expect(request.fields.size).toBe("1024x1024");
    expect(request.fields.quality).toBe("high");
    expect(request.fields.prompt).toContain("Women Cotton Thong Underwear");
  });

  test("uses the image-specific Packy API key and image model for image edits", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });
      expect((init?.body as FormData).get("model")).toBe("image-model");

      return new Response(
        JSON.stringify({
          data: [{ url: "https://cdn.example.com/generated.png" }]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateImageWithPacky({
      image: {
        buffer: Buffer.from("image"),
        mimetype: "image/png",
        originalname: "source.png"
      } as Express.Multer.File,
      productType: "Women Cotton Thong Underwear",
      prompt: "Create ecommerce detail image",
      env: {
        PACKY_API_KEY: "shared-key",
        PACKY_IMAGE_API_KEY: "image-key",
        PACKY_IMAGE_MODEL: "image-model"
      },
      fetchImpl
    });

    expect(result.imageUrl).toBe("https://cdn.example.com/generated.png");
  });

  test("uploads Packy base64 image edits to ImgBB before returning a URL", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/images/edits")) {
        expect(init?.headers).toEqual({
          Authorization: "Bearer image-key"
        });

        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("generated-image").toString("base64") }]
          }),
          { status: 200 }
        );
      }

      expect(String(url)).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      expect((init?.body as FormData).get("image")).toBeTruthy();

      return new Response(
        JSON.stringify({
          data: { display_url: "https://i.ibb.co/generated-image.png" }
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateImageWithPacky({
      image: {
        buffer: Buffer.from("image"),
        mimetype: "image/png",
        originalname: "source.png"
      } as Express.Multer.File,
      productType: "Women Cotton Thong Underwear",
      prompt: "Create ecommerce detail image",
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key"
      },
      fetchImpl
    });

    expect(result.imageUrl).toBe("https://i.ibb.co/generated-image.png");
    expect(result.imageUrl).not.toContain("data:image");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("generates the 5 Shopify images as separate one-role Packy requests", async () => {
    const roleUrls = [
      "https://cdn.example.com/feature-main.png",
      "https://cdn.example.com/side-angle.png",
      "https://cdn.example.com/detail.png",
      "https://cdn.example.com/scene-1.png",
      "https://cdn.example.com/scene-2.png"
    ];
    const rolePrompts = [
      "Image 1 URL role: feature main image",
      "Image 2 URL role: side angle",
      "Image 3 URL role: size, packaging, or detail",
      "Image 4 URL role: lifestyle scene 1",
      "Image 5 URL role: lifestyle scene 2"
    ];
    const fetchMock = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      const callIndex = fetchMock.mock.calls.length - 1;

      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });
      expect(form.get("model")).toBe("gpt-image-2");
      expect(form.get("n")).toBe("1");
      expect(String(form.get("prompt"))).toContain(
        "Generate exactly one square Shopify product image for this single role"
      );
      expect(String(form.get("prompt"))).toContain(
        "Do not create a collage, grid, contact sheet, split screen or multi-panel image"
      );
      expect(String(form.get("prompt"))).toContain(rolePrompts[callIndex]);
      if (callIndex === 0) {
        expect(String(form.get("prompt"))).toContain(
          "Do not use a pure white or plain white background"
        );
      }
      expect(String(form.get("prompt"))).not.toContain("Return exactly 5 square ecommerce images");
      expect(form.getAll("image")).toHaveLength(2);

      return new Response(
        JSON.stringify({
          data: [{ url: roleUrls[callIndex] }]
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        },
        {
          buffer: Buffer.from("side"),
          mimetype: "image/png",
          originalname: "side.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 8,
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        PACKY_IMAGE_MODEL: "gpt-image-2"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual(roleUrls);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("keeps 5 fixed Shopify image roles even when caller requests a different count", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      const callIndex = fetchMock.mock.calls.length - 1;

      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });
      expect(form.get("n")).toBe("1");

      return new Response(
        JSON.stringify({
          data: [{ url: `https://cdn.example.com/role-${callIndex + 1}.png` }]
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 4,
      env: {
        PACKY_IMAGE_API_KEY: "image-key"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual([
      "https://cdn.example.com/role-1.png",
      "https://cdn.example.com/role-2.png",
      "https://cdn.example.com/role-3.png",
      "https://cdn.example.com/role-4.png",
      "https://cdn.example.com/role-5.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("retries transient Packy Shopify product image failures before falling back", async () => {
    const roleUrls = [
      "https://cdn.example.com/retry-main-1.png",
      "https://cdn.example.com/retry-main-2.png",
      "https://cdn.example.com/retry-main-3.png",
      "https://cdn.example.com/retry-main-4.png",
      "https://cdn.example.com/retry-main-5.png"
    ];
    let packyCalls = 0;
    let successIndex = 0;
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/v1/images/edits");
      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });

      packyCalls += 1;
      if (packyCalls < 3) {
        return new Response("Service unavailable", { status: 503 });
      }

      return new Response(
        JSON.stringify({
          data: [{ url: roleUrls[successIndex++] }]
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 4,
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual(roleUrls);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  test("falls back to ImgBB source image URLs when Packy Shopify product image API is unavailable", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/images/edits")) {
        return new Response("Service unavailable", { status: 503 });
      }

      expect(String(url)).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      expect((init?.body as FormData).get("image")).toBeTruthy();

      return new Response(
        JSON.stringify({
          data: { display_url: "https://i.ibb.co/source-fallback.png" }
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 4,
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual([
      "https://i.ibb.co/source-fallback.png",
      "https://i.ibb.co/source-fallback.png",
      "https://i.ibb.co/source-fallback.png",
      "https://i.ibb.co/source-fallback.png",
      "https://i.ibb.co/source-fallback.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("falls back when Packy Shopify product image API returns non-JSON text", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/images/edits")) {
        return new Response("An error occurred while generating the image", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }

      expect(String(url)).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      expect((init?.body as FormData).get("image")).toBeTruthy();

      return new Response(
        JSON.stringify({
          data: { display_url: "https://i.ibb.co/non-json-fallback.png" }
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 4,
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual([
      "https://i.ibb.co/non-json-fallback.png",
      "https://i.ibb.co/non-json-fallback.png",
      "https://i.ibb.co/non-json-fallback.png",
      "https://i.ibb.co/non-json-fallback.png",
      "https://i.ibb.co/non-json-fallback.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("uploads Packy base64 Shopify product images to ImgBB and keeps URL order", async () => {
    const packyResults = [
      { b64_json: Buffer.from("main-1").toString("base64") },
      { url: "https://cdn.example.com/main-2.png" },
      { b64_json: Buffer.from("main-3").toString("base64") },
      { url: "https://cdn.example.com/main-4.png" },
      { url: "https://cdn.example.com/main-5.png" }
    ];
    let packyIndex = 0;
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/images/edits")) {
        return new Response(
          JSON.stringify({
            data: [packyResults[packyIndex++]]
          }),
          { status: 200 }
        );
      }

      expect(String(url)).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      expect((init?.body as FormData).get("image")).toBeTruthy();

      const uploadCall = fetchMock.mock.calls.filter(([callUrl]) =>
        String(callUrl).includes("api.imgbb.com")
      ).length;

      return new Response(
        JSON.stringify({
          data: { display_url: `https://i.ibb.co/main-${uploadCall}.png` }
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateShopifyProductImagesWithPacky({
      images: [
        {
          buffer: Buffer.from("front"),
          mimetype: "image/png",
          originalname: "front.png"
        }
      ] as Express.Multer.File[],
      productType: "Women Cotton Thong Underwear",
      sellingPoints: "Soft cotton breathable stretch everyday fit",
      count: 4,
      env: {
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key"
      },
      fetchImpl
    });

    expect(result.imageUrls).toEqual([
      "https://i.ibb.co/main-1.png",
      "https://cdn.example.com/main-2.png",
      "https://i.ibb.co/main-2.png",
      "https://cdn.example.com/main-4.png",
      "https://cdn.example.com/main-5.png"
    ]);
    expect(result.imageUrls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(result.imageUrls.some((url) => url.startsWith("data:image"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});

describe("admin upload helpers", () => {
  test("resolves Dropshipzone /products endpoint and jwt auth from environment", () => {
    const config = resolveAdminConfig({
      ADMIN_API_BASE_URL:
        "https://services.dropshipzone.com.au/admin/api/supplier/v1/",
      ADMIN_API_TOKEN: "secret-token"
    });

    expect(config.baseUrl).toBe(
      "https://services.dropshipzone.com.au/admin/api/supplier/v1"
    );
    expect(config.productUploadUrl).toBe(
      "https://services.dropshipzone.com.au/admin/api/supplier/v1/products"
    );
    expect(config.headers.Authorization).toBe("jwt secret-token");
    expect(config.mockMode).toBe(false);
  });

  test("uses mock mode when admin token is missing", () => {
    const config = resolveAdminConfig({});

    expect(config.productUploadUrl).toBe(
      "https://services.dropshipzone.com.au/admin/api/supplier/v1/products"
    );
    expect(config.mockMode).toBe(true);
  });

  test("uses Dropshipzone auth credentials instead of mock mode when token is missing", () => {
    const config = resolveAdminConfig({
      ADMIN_API_EMAIL: "supplier@example.com",
      ADMIN_API_PASSWORD: "supplier-password"
    });

    expect(config.authUrl).toBe(
      "https://services.dropshipzone.com.au/admin/api/supplier/v1/auth"
    );
    expect(config.mockMode).toBe(false);
  });

  test("validates DSZ required fields before upload", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      images: []
    });
    const result = validateDszProductFields(payload);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Images must contain at least 5 URLs"]);
  });

  test("wraps product in Dropshipzone products array", () => {
    const payload = buildAdminProductPayload(fields);
    const body = buildAdminRequestBody(payload);

    expect(payload.categories).toBe("947");
    expect(payload.name).toBe(fields.product_name);
    expect(payload.price).toBe(fields.vendor_price);
    expect(payload.brand_name).toBe("Elosung");
    expect(payload.zone_rates.nz).toBe(20);
    expect(body).toEqual({ products: [payload] });
  });

  test("builds free AU rates and the lower NZ rate below 3 kg", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      weight: 2,
      length: 10,
      width: 10,
      height: 10
    });

    expect(payload.zone_rates.act).toBe(0);
    expect(payload.zone_rates.nz).toBe(20);
  });

  test("uses volumetric weight to select the higher NZ rate", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      weight: 1,
      length: 50,
      width: 40,
      height: 30
    });

    expect(payload.zone_rates.nz).toBe(40);
  });

  test("maps legacy local category IDs to real Dropshipzone new category IDs", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      category: 7032,
      categories: "7032"
    });

    expect(payload).not.toHaveProperty("category");
    expect(payload.categories).toBe("947");
  });

  test("normalizes shipping zones to DSZ AU free shipping and NZ paid shipping rules", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      zone_rates: {
        nz: 5
      } as Record<string, number>
    });

    expect(payload.zone_rates).toEqual(standardZoneRates());
  });

  test("builds only Dropshipzone API fields for live product upload", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      sku: "Elosung_10001"
    });

    expect(Object.keys(payload).sort()).toEqual(
      [
        "brand_name",
        "categories",
        "cbm",
        "colour",
        "description",
        "ean_code",
        "height",
        "images",
        "length",
        "name",
        "price",
        "rrp",
        "sku",
        "status",
        "stock",
        "weight",
        "width",
        "zone_rates"
      ].sort()
    );
    expect(payload).not.toHaveProperty("categoryName");
    expect(payload).not.toHaveProperty("product_name");
    expect(payload).not.toHaveProperty("vendor_price");
    expect(payload).not.toHaveProperty("enabled");
    expect(payload).not.toHaveProperty("risk_flags");
    expect(payload).not.toHaveProperty("review_notes");
    expect(payload.sku).toBe("Elosung10001");
    expect(payload.name).toBe(fields.product_name);
    expect(payload.price).toBe(fields.vendor_price);
    expect(payload.cbm).toBe(fields.cbm);
  });

  test("preserves inactive status 0 in the admin payload", () => {
    const payload = buildAdminProductPayload({ ...fields, status: 0 });

    expect(payload.status).toBe(0);
    expect(validateDszProductFields(payload).valid).toBe(true);
  });

  test.each([2, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid admin status %s",
    (status) => {
      const payload = buildAdminProductPayload({ ...fields, status });

      expect(validateDszProductFields(payload)).toEqual({
        valid: false,
        errors: ["Status must be 0 or 1"]
      });
    }
  );

  test("pads existing HTTPS image URLs to the minimum DSZ image count before upload validation", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      images: ["https://cdn.example.com/only-image.jpg"]
    });

    expect(payload.images).toEqual([
      "https://cdn.example.com/only-image.jpg",
      "https://cdn.example.com/only-image.jpg",
      "https://cdn.example.com/only-image.jpg",
      "https://cdn.example.com/only-image.jpg",
      "https://cdn.example.com/only-image.jpg"
    ]);
    expect(validateDszProductFields(payload).valid).toBe(true);
  });

  test("validates all DSZ upload rule fields before live upload", () => {
    const payload = {
      ...buildAdminProductPayload({
        ...fields,
        category: 0,
        categories: "",
        product_name: "",
        ean_code: "5901234567890",
        weight: 0,
        length: 0,
        width: 0,
        height: 0,
        cbm: 0,
        description: "<p>Missing required footer</p>\n<p>https://example.com</p>",
        vendor_price: 0,
        rrp: 0
      }),
      zone_rates: {
        nz: 20
      } as Record<string, number>
    };

    const result = validateDszProductFields(payload);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Product name is required",
        "Categories must be one sub-subcategory ID string",
        "EAN code must be a 10 digit string",
        "Price must be greater than 0",
        "Weight must be greater than 0",
        "Length, width and height must be greater than 0",
        "CBM must be greater than 0",
        "Description must be a single line",
        "Description must not contain URLs",
        "Description must include the required ACL and delivery footer",
        "zone_rates must include all required shipping zones"
      ])
    );
  });

  test("returns mock upload body when token is missing", async () => {
    const payload = buildAdminProductPayload(fields);
    const result = await uploadProduct({
      payload,
      env: {},
      fetchImpl: vi.fn()
    });

    expect(result.mode).toBe("mock");
    expect(result.requestBody).toEqual({ products: [payload] });
  });

  test("authenticates with Dropshipzone credentials before creating products", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "supplier@example.com",
          password: "supplier-password"
        });

        return new Response(JSON.stringify({ data: { token: "fresh-token" } }), {
          status: 200
        });
      }

      expect(String(url)).toBe(
        "https://services.dropshipzone.com.au/admin/api/supplier/v1/products"
      );
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "jwt fresh-token"
      });

      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await uploadProduct({
      payload: buildAdminProductPayload(fields),
      env: {
        ADMIN_API_EMAIL: "supplier@example.com",
        ADMIN_API_PASSWORD: "supplier-password"
      },
      fetchImpl
    });

    expect(result.mode).toBe("live");
    expect(result.response).toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("refreshes Dropshipzone token and retries once after 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ expired: true }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { token: "refreshed-token" } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;

    const result = await uploadProduct({
      payload: buildAdminProductPayload(fields),
      env: {
        ADMIN_API_TOKEN: "expired-token",
        ADMIN_API_EMAIL: "supplier@example.com",
        ADMIN_API_PASSWORD: "supplier-password"
      },
      fetchImpl
    });

    expect(result.mode).toBe("live");
    expect(result.response).toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("includes Dropshipzone 400 response body in live upload errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: "Category is invalid",
          errors: {
            category: ["The selected category is not available."]
          }
        }),
        { status: 400 }
      )
    ) as unknown as typeof fetch;

    await expect(
      uploadProduct({
        payload: buildAdminProductPayload(fields),
        env: {
          ADMIN_API_TOKEN: "live-token"
        },
        fetchImpl
      })
    ).rejects.toThrow(/Category is invalid/);
  });

  test("retries transient Dropshipzone product upload failures before returning an error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ temporary: true }), { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      ) as unknown as typeof fetch;

    const result = await uploadProduct({
      payload: buildAdminProductPayload(fields),
      env: {
        ADMIN_API_TOKEN: "live-token",
        ADMIN_UPLOAD_RETRY_DELAY_MS: "0"
      },
      fetchImpl
    });

    expect(result.mode).toBe("live");
    expect(result.response).toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
