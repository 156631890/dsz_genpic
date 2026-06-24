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
  standardZoneRates
} from "../../server/services/dszRules";
import {
  buildPackyEditRequest,
  generateAmazonMainImagesWithPacky,
  generateImageWithPacky
} from "../../server/services/packyImages";
import { buildImgbbUploadRequest } from "../../server/services/imageUploader";
import type { DszProductFields, ProductInput } from "../../shared/product";

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
  category: 7032,
  categories: "7032",
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

describe("DSZ field rules", () => {
  test("builds Packy messages with uploaded image URLs and rule snippets", () => {
    const messages = buildDszGenerationMessages({
      input,
      ruleDocuments: {
        fieldRules: "F2 Product Name. F13 Vendor Product Description.",
        productPrompt: "Title must be pure English. HTML must be single line.",
        categoryMapping: "Women's Intimates | 7032",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      }
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("Soft cotton blend thong underwear");
    expect(messages[1].content).toContain("https://cdn.example.com/1.jpg");
    expect(messages[1].content).toContain("F13 Vendor Product Description");
    expect(messages[1].content).toContain("JSON");
  });

  test("parses generated DSZ field JSON from fenced content", () => {
    const parsed = parseGeneratedFields(`
\`\`\`json
${JSON.stringify(fields)}
\`\`\`
`);

    expect(parsed.sku).toBe("Elosung10001");
    expect(parsed.categories).toBe("7032");
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

    try {
      await Promise.all([
        writeFile(
          join(rulesDir, "Dropshipzone_Field_Rules.md"),
          "Dropshipzone Supplier API actual format. name and price are required.",
          "utf8"
        ),
        writeFile(
          join(rulesDir, "DSZ系统prompt 4月20版本.txt"),
          "固定页脚规则. 输出规则. 最终自检.",
          "utf8"
        ),
        writeFile(
          join(rulesDir, "Category_Mapping.md"),
          "Fashion / Women's Fashion / Women's Intimates | 7032",
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
      expect(rules.productPrompt).toContain("固定页脚规则");
      expect(rules.categoryMapping).toContain("Women's Intimates | 7032");
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
        categoryMapping: "Women's Intimates | 7032",
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
        categoryMapping: "Women's Intimates | 7032",
        uploadSop: "Full upload SOP.",
        productUploadAu: "AU product content rules."
      },
      fetchImpl
    });

    expect(result.source).toBe("ai");
    expect(result.fields.sku).toBe("Elosung10001");
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

  test("generates 4 to 6 Amazon main images through Packy image API", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;

      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });
      expect(form.get("model")).toBe("gpt-image-2");
      expect(form.get("n")).toBe("6");
      expect(String(form.get("prompt"))).toContain("Amazon main image");
      expect(form.getAll("image")).toHaveLength(2);

      return new Response(
        JSON.stringify({
          data: [
            { url: "https://cdn.example.com/main-1.png" },
            { url: "https://cdn.example.com/main-2.png" },
            { url: "https://cdn.example.com/main-3.png" },
            { url: "https://cdn.example.com/main-4.png" },
            { url: "https://cdn.example.com/main-5.png" },
            { url: "https://cdn.example.com/main-6.png" }
          ]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await generateAmazonMainImagesWithPacky({
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

    expect(result.imageUrls).toEqual([
      "https://cdn.example.com/main-1.png",
      "https://cdn.example.com/main-2.png",
      "https://cdn.example.com/main-3.png",
      "https://cdn.example.com/main-4.png",
      "https://cdn.example.com/main-5.png",
      "https://cdn.example.com/main-6.png"
    ]);
  });

  test("requests extra Packy main images when the first response has fewer than requested", async () => {
    const packyUrls = [
      ["https://cdn.example.com/main-1.png"],
      ["https://cdn.example.com/main-2.png"],
      ["https://cdn.example.com/main-3.png"],
      ["https://cdn.example.com/main-4.png"]
    ];
    const fetchMock = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      const callIndex = fetchMock.mock.calls.length - 1;

      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });
      expect(form.get("n")).toBe(callIndex === 0 ? "4" : "1");

      return new Response(
        JSON.stringify({
          data: packyUrls[callIndex].map((url) => ({ url }))
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateAmazonMainImagesWithPacky({
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
      "https://cdn.example.com/main-1.png",
      "https://cdn.example.com/main-2.png",
      "https://cdn.example.com/main-3.png",
      "https://cdn.example.com/main-4.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("retries transient Packy main image failures before falling back", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/v1/images/edits");
      expect(init?.headers).toEqual({
        Authorization: "Bearer image-key"
      });

      if (fetchMock.mock.calls.length < 3) {
        return new Response("Service unavailable", { status: 503 });
      }

      return new Response(
        JSON.stringify({
          data: [
            { url: "https://cdn.example.com/retry-main-1.png" },
            { url: "https://cdn.example.com/retry-main-2.png" },
            { url: "https://cdn.example.com/retry-main-3.png" },
            { url: "https://cdn.example.com/retry-main-4.png" }
          ]
        }),
        { status: 200 }
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await generateAmazonMainImagesWithPacky({
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
      "https://cdn.example.com/retry-main-1.png",
      "https://cdn.example.com/retry-main-2.png",
      "https://cdn.example.com/retry-main-3.png",
      "https://cdn.example.com/retry-main-4.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("falls back to ImgBB source image URLs when Packy main image API is unavailable", async () => {
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

    const result = await generateAmazonMainImagesWithPacky({
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
      "https://i.ibb.co/source-fallback.png"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("uploads Packy base64 Amazon main images to ImgBB and keeps URL order", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/images/edits")) {
        return new Response(
          JSON.stringify({
            data: [
              { b64_json: Buffer.from("main-1").toString("base64") },
              { url: "https://cdn.example.com/main-2.png" },
              { b64_json: Buffer.from("main-3").toString("base64") },
              { url: "https://cdn.example.com/main-4.png" }
            ]
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

    const result = await generateAmazonMainImagesWithPacky({
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
      "https://cdn.example.com/main-4.png"
    ]);
    expect(result.imageUrls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(result.imageUrls.some((url) => url.startsWith("data:image"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(result.errors).toEqual(["Images must contain at least 4 URLs"]);
  });

  test("wraps product in Dropshipzone products array", () => {
    const payload = buildAdminProductPayload(fields);
    const body = buildAdminRequestBody(payload);

    expect(payload.categories).toBe("7032");
    expect(payload.name).toBe(fields.product_name);
    expect(payload.price).toBe(fields.vendor_price);
    expect(payload.brand_name).toBe("Elosung");
    expect(payload.zone_rates.nz).toBe(10);
    expect(body).toEqual({ products: [payload] });
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
        "category",
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
    expect(payload).not.toHaveProperty("cbm");
    expect(payload).not.toHaveProperty("risk_flags");
    expect(payload).not.toHaveProperty("review_notes");
    expect(payload.sku).toBe("Elosung10001");
    expect(payload.name).toBe(fields.product_name);
    expect(payload.price).toBe(fields.vendor_price);
  });

  test("pads existing HTTPS image URLs to the minimum DSZ image count before upload validation", () => {
    const payload = buildAdminProductPayload({
      ...fields,
      images: ["https://cdn.example.com/only-image.jpg"]
    });

    expect(payload.images).toEqual([
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
        description: "<p>Missing required footer</p>\n<p>https://example.com</p>",
        vendor_price: 0,
        rrp: 0
      }),
      zone_rates: {
        nz: 10
      } as Record<string, number>
    };

    const result = validateDszProductFields(payload);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Category must be a positive integer",
        "Product name is required",
        "Categories must be a string",
        "EAN code must be a 10 digit string",
        "Price must be greater than 0",
        "Weight must be greater than 0",
        "Length, width and height must be greater than 0",
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
