// @vitest-environment node

import request from "supertest";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createApp, type AppDependencies } from "../../server/app";
import { standardZoneRates } from "../../server/services/dszRules";
import {
  extractCanonicalProductFooter,
  loadProductSystemPrompt
} from "../../server/services/productCopy";
import {
  PRODUCT_IMAGE_ROLES,
  type AmazonMarketAnalysis,
  type DszProductFields,
  type GeneratedProductCopy,
  type GeneratedProductImage,
  type ProductInput,
  type ProductResearchEvidence
} from "../../shared/product";
import { formatSegmentedDescriptionHtml } from "../../shared/description";

const productInput: ProductInput = {
  sellingPoints: "Soft cotton thong underwear, breathable stretch, everyday fit.",
  categoryHint: "Women's Intimates",
  imageUrls: [
    "https://cdn.example.com/1.jpg",
    "https://cdn.example.com/2.jpg",
    "https://cdn.example.com/3.jpg",
    "https://cdn.example.com/4.jpg"
  ],
  images: [],
  purchasePriceCny: 12,
  packageWeightKg: 0.08,
  lengthCm: 15,
  widthCm: 17,
  heightCm: 2
};

const pngImage = Buffer.from("89504e470d0a1a0a", "hex");
const jpegImage = Buffer.from("ffd8ffe000104a464946", "hex");
const webpImage = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBP")
]);
const canonicalProductFooter = extractCanonicalProductFooter(
  await loadProductSystemPrompt()
);
const validGeneratedTitle = "Compact Storage Organiser - Practical Space Saving Design, Easy Everyday Access, Versatile Home and Travel Use";
const validGeneratedDescription = formatSegmentedDescriptionHtml(
  `<p><strong>Product Overview</strong></p><p>A practical organiser for everyday use.</p>${canonicalProductFooter}`
);

const amazonMarketAnalysis: AmazonMarketAnalysis = {
  source: "proboost-amazon-au",
  marketplace: "Amazon Australia",
  query: "cotton thong underwear",
  analyzedAt: "2026-07-17T08:00:00.000Z",
  snapshotDate: "2026-07-16",
  confidence: "high",
  categoryName: "Clothing->Women->Underwear",
  categoryPath: "1->2->3",
  currentRrpAud: 39.48,
  competitorCount: 1,
  priceMinimumAud: 44.99,
  priceMedianAud: 44.99,
  priceMaximumAud: 44.99,
  priceAdvantagePercent: 12.2,
  pricePosition: "moderate_advantage",
  suggestedRrpMinimumAud: 38.24,
  suggestedRrpMaximumAud: 42.74,
  sampledMonthlySales: 120,
  competitors: [],
  priceBands: [],
  notes: []
};

const fields: DszProductFields = {
  category: 947,
  categories: "947",
  categoryName: "Fashion / Women's Fashion / Women's Intimates",
  product_name: "Women Cotton Thong Underwear - Stretch Cotton Blend",
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
    "<p><strong>Product Overview</strong></p><p>Comfortable daily underwear.</p><p><strong>Returns, Refunds and Replacements </strong><br />Products received faulty, damaged, or not as described are eligible for review under ACL.</p><p><strong>Delivery Timeframe</strong></p><p>Delivery timeframes exclude weekends and public holidays.</p>",
  vendor_price: 19.74,
  rrp: 39.48,
  zone_rates: standardZoneRates(),
  images: productInput.imageUrls,
  risk_flags: [],
  review_notes: []
};

describe("API app", () => {
  test("requires asynchronous independent generation dependencies", () => {
    expectTypeOf<
      NonNullable<AppDependencies["generateProductCopy"]>
    >().returns.toEqualTypeOf<Promise<GeneratedProductCopy>>();
    expectTypeOf<
      NonNullable<AppDependencies["generateProductImageRole"]>
    >().returns.toEqualTypeOf<Promise<GeneratedProductImage>>();
  });

  test("allows loopback browser origins and same-origin requests", async () => {
    const app = createApp({ env: {} });

    const localhostResponse = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173")
      .expect(200);
    const loopbackResponse = await request(app)
      .get("/api/health")
      .set("Origin", "https://127.0.0.1:4173")
      .expect(200);
    const sameOriginResponse = await request(app)
      .get("/api/health")
      .expect(200);

    expect(localhostResponse.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173"
    );
    expect(loopbackResponse.headers["access-control-allow-origin"]).toBe(
      "https://127.0.0.1:4173"
    );
    expect(sameOriginResponse.headers).not.toHaveProperty(
      "access-control-allow-origin"
    );
  });

  test("allows preflight requests from the configured app origin", async () => {
    const origin = "https://dsz-genpic.vercel.app";
    const response = await request(createApp({ env: { APP_ORIGIN: origin } }))
      .options("/api/generate-product-copy")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });

  test("rejects external browser origins without exposing request details", async () => {
    const origin = "https://attacker.example/private-token";
    const response = await request(
      createApp({ env: { APP_ORIGIN: "https://dsz-genpic.vercel.app" } })
    )
      .get("/api/health")
      .set("Origin", origin)
      .expect(403);

    expect(response.body).toEqual({ error: "Request origin is not allowed" });
    expect(response.text).not.toContain(origin);
  });

  test("reports health and mock/live upload state", async () => {
    const apiKey = "health-test-secret-key";
    const app = createApp({
      env: {
        PACKY_API_KEY: apiKey,
        PACKY_TEXT_MODEL: "copy-model",
        PACKY_IMAGE_MODEL: "image-model",
        PACKY_IMAGE_SIZE: "1536x1024",
        PACKY_IMAGE_QUALITY: "low",
        IMGBB_API_KEY: "imgbb-key",
        GITHUB_IMAGE_TOKEN: "github-token",
        GITHUB_IMAGE_REPOSITORY: "156631890/dsz_genpic",
        GITHUB_IMAGE_BRANCH: "generated-images",
        ADMIN_API_BASE_URL:
          "https://services.dropshipzone.com.au/admin/api/supplier/v1"
      }
    });

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({
      ok: true,
      packyConfigured: true,
      sharedPackyConfigured: true,
      textConfigured: true,
      imageConfigured: true,
      legacyTextConfigured: true,
      legacyImageConfigured: true,
      textModel: "copy-model",
      imageModel: "image-model",
      imageSize: "1024x1024",
      imageQuality: "high",
      imageUploadConfigured: true,
      githubImageStorageConfigured: true,
      adminBaseUrl: "https://services.dropshipzone.com.au/admin/api/supplier/v1",
      adminMockMode: true
    });
    expect(JSON.stringify(response.body)).not.toContain(apiKey);
  });

  test("reports effective default Packy models and image configuration", async () => {
    const response = await request(createApp({ env: {} }))
      .get("/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      textConfigured: false,
      imageConfigured: false,
      sharedPackyConfigured: false,
      legacyTextConfigured: false,
      legacyImageConfigured: false,
      textModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high"
    });
  });

  test("returns independent Amazon Australia market analysis", async () => {
    const analyzeAmazonMarket = vi.fn(async () => amazonMarketAnalysis);
    const response = await request(createApp({ analyzeAmazonMarket }))
      .post("/api/analyze-amazon-market")
      .send({
        input: {
          productName: `  ${fields.product_name}  `,
          categoryName: fields.categoryName,
          categoryHint: "Women's Intimates",
          sellingPoints: productInput.sellingPoints,
          currentRrpAud: fields.rrp
        }
      })
      .expect(200);

    expect(analyzeAmazonMarket).toHaveBeenCalledWith(expect.objectContaining({
      productName: fields.product_name,
      currentRrpAud: fields.rrp
    }));
    expect(response.body).toEqual({ analysis: amazonMarketAnalysis });
  });

  test("validates market inputs and reports missing ProBoost configuration safely", async () => {
    await request(createApp({ env: {} }))
      .post("/api/analyze-amazon-market")
      .send({ input: { productName: "", currentRrpAud: 0 } })
      .expect(400, { error: "Invalid Amazon market analysis input" });

    await request(createApp({ env: {} }))
      .post("/api/analyze-amazon-market")
      .send({ input: { productName: "Wireless earbuds", currentRrpAud: 29.95 } })
      .expect(503, { error: "ProBoost Amazon market analysis is not configured" });
  });

  test.each([
    ["shared only", { PACKY_API_KEY: "shared-secret" }, true, true, true, true, true, true],
    [
      "legacy only",
      { PACKY_FIELD_API_KEY: "field-secret", PACKY_IMAGE_API_KEY: "image-secret" },
      true, false, false, true, true, true
    ],
    [
      "legacy text alias only",
      { PACKY_TEXT_API_KEY: "text-secret" },
      true, false, true, false, true, false
    ],
    [
      "mixed",
      { PACKY_API_KEY: "shared-secret", PACKY_FIELD_API_KEY: "field-secret" },
      true, true, true, true, true, true
    ],
    ["dedicated image only", { PACKY_IMAGE_API_KEY: "image-secret" }, true, false, false, true, false, true],
    ["empty", {}, false, false, false, false, false, false]
  ])(
    "reports unambiguous %s Packy health state",
    async (
      _name,
      env,
      packyConfigured,
      sharedPackyConfigured,
      textConfigured,
      imageConfigured,
      legacyTextConfigured,
      legacyImageConfigured
    ) => {
      const response = await request(createApp({ env }))
        .get("/api/health")
        .expect(200);

      expect(response.body).toMatchObject({
        packyConfigured,
        sharedPackyConfigured,
        textConfigured,
        imageConfigured,
        legacyTextConfigured,
        legacyImageConfigured
      });
      for (const secret of Object.values(env)) {
        expect(JSON.stringify(response.body)).not.toContain(secret);
      }
    }
  );

  test.each([
    [undefined, "Selling points are required"],
    [null, "Selling points are required"],
    ["wrong", "Selling points are required"],
    [[], "Selling points are required"],
    [{ ...productInput, sellingPoints: 7 }, "Selling points are required"],
    [{ ...productInput, sellingPoints: "   " }, "Selling points are required"],
    [{ ...productInput, sellingPoints: "x".repeat(10001) }, "Selling points are invalid"],
    [{ ...productInput, imageUrls: undefined }, "Uploaded image URLs are required"],
    [{ ...productInput, imageUrls: "not-an-array" }, "Uploaded image URLs are required"],
    [{ ...productInput, imageUrls: ["http://cdn.example.com/a.png"] }, "Uploaded image URLs are invalid"],
    [{ ...productInput, imageUrls: ["not-a-url"] }, "Uploaded image URLs are invalid"],
    [{ ...productInput, imageUrls: ["https://cdn.example.com/a.png", 7] }, "Uploaded image URLs are invalid"],
    [{ ...productInput, imageUrls: Array(11).fill("https://cdn.example.com/a.png") }, "Uploaded image URLs are invalid"],
    [{ ...productInput, images: "wrong" }, "Images are invalid"],
    [{ ...productInput, images: ["ok", 3] }, "Images are invalid"],
    [{ ...productInput, categoryHint: 3 }, "Category hint is invalid"],
    [{ ...productInput, categoryHint: "x".repeat(501) }, "Category hint is invalid"],
    [{ ...productInput, purchasePriceCny: -1 }, "Product numeric facts are invalid"],
    [
      { ...productInput, packageWeightKg: Number.NaN },
      "Package weight, length, width, and height are required."
    ],
    [
      { ...productInput, lengthCm: Number.POSITIVE_INFINITY },
      "Package weight, length, width, and height are required."
    ]
  ])("rejects invalid independent product copy input", async (input, error) => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input })
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("rejects a missing copy request body safely", async () => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .expect(400);

    expect(response.body).toEqual({ error: "Selling points are required" });
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns safe JSON when the JSON body exceeds 2 MiB", async () => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input: { sellingPoints: "x".repeat(2 * 1024 * 1024 + 1) } })
      .expect(413);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "JSON body exceeds 2 MiB limit" });
    expect(response.text).not.toMatch(/stack|SyntaxError|node_modules|[A-Z]:\\/i);
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns safe JSON for malformed JSON", async () => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .set("Content-Type", "application/json")
      .send('{"input":{"sellingPoints":"secret-path C:\\\\private"')
      .expect(400);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Malformed JSON body" });
    expect(response.text).not.toMatch(/stack|SyntaxError|node_modules|private|[A-Z]:\\/i);
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns safe JSON for an unsupported JSON charset", async () => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .set("Content-Type", "application/json; charset=klingon")
      .send("{}")
      .expect(415);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Unsupported request encoding" });
    expect(response.text).not.toMatch(/stack|charset|node_modules|[A-Z]:\\/i);
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns safe JSON for an invalid gzip JSON body", async () => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(Buffer.from("not-valid-gzip C:\\private"))
      .expect(400);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Invalid request body" });
    expect(response.text).not.toMatch(/stack|gzip|private|node_modules|[A-Z]:\\/i);
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns safe JSON for a truncated multipart body", async () => {
    const uploadImages = vi.fn();
    const response = await request(createApp({ uploadImages }))
      .post("/api/upload-images")
      .set("Content-Type", "multipart/form-data; boundary=truncated-boundary")
      .send(
        "--truncated-boundary\r\n" +
          'Content-Disposition: form-data; name="images"; filename="C:\\private.txt"\r\n' +
          "Content-Type: image/png\r\n\r\n" +
          "unfinished"
      )
      .expect(400);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Invalid multipart upload" });
    expect(response.text).not.toMatch(/stack|private|node_modules|[A-Z]:\\/i);
    expect(uploadImages).not.toHaveBeenCalled();
  });

  test("returns safe JSON for an unknown uncaught error", async () => {
    const env = new Proxy<Record<string, string | undefined>>({}, {
      get() {
        throw new Error("unknown C:\\private\\token-secret.txt");
      }
    });
    const response = await request(createApp({ env }))
      .get("/api/health")
      .expect(500);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Internal server error" });
    expect(response.text).not.toMatch(/stack|private|token-secret|node_modules/i);
  });

  test("returns independent generated product copy without a wrapper", async () => {
    const generateProductCopy = vi.fn(async () => ({
      title: "Premium Cotton Underwear",
      description: "A breathable everyday essential."
    }));
    const generateProductImageRole = vi.fn();
    const response = await request(
      createApp({ generateProductCopy, generateProductImageRole })
    )
      .post("/api/generate-product-copy")
      .send({ input: {
        ...productInput,
        sellingPoints: `  ${productInput.sellingPoints}  `,
        imageUrls: []
      } })
      .expect(200);

    expect(response.body).toEqual({
      title: "Premium Cotton Underwear",
      description: "A breathable everyday essential."
    });
    expect(generateProductCopy).toHaveBeenCalledWith({ ...productInput, imageUrls: [] });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test("uses the default Packy copy adapter with the validated product input", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: `${validGeneratedTitle}\n${validGeneratedDescription}`
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    try {
      const response = await request(createApp({
        env: {
          PACKY_API_KEY: "default-adapter-test-key",
          PACKY_TEXT_MODEL: "default-adapter-test-model"
        }
      }))
        .post("/api/generate-product-copy")
        .send({ input: productInput })
        .expect(200);

      expect(response.body).toEqual({
        title: validGeneratedTitle,
        description: validGeneratedDescription
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      const providerBody = JSON.parse(String(init?.body));

      expect(url).toBe("https://www.packyapi.com/v1/responses");
      expect(init?.headers).toEqual({
        Authorization: "Bearer default-adapter-test-key",
        "Content-Type": "application/json"
      });
      expect(providerBody.model).toBe("default-adapter-test-model");
      expect(providerBody.instructions).toBeTruthy();
      expect(providerBody.input).toEqual([{
        role: "user",
        content: [{
          type: "input_text",
          text: expect.stringContaining(`Selling points: ${productInput.sellingPoints}`)
        }]
      }]);
      expect(providerBody.store).toBe(false);
      expect(JSON.stringify(providerBody.input)).not.toContain(productInput.imageUrls[0]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("returns only whitelisted product copy fields", async () => {
    const generateProductCopy = vi.fn(async () => ({
      title: "Public title",
      description: "Public description",
      secret: "provider-token",
      internal: { traceId: "private-trace" },
      debug: true
    }));
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(200);

    expect(response.body).toEqual({
      title: "Public title",
      description: "Public description"
    });
  });

  test.each([
    ["undefined", undefined],
    ["an array", ["title", "description"]],
    ["a non-string title", { title: 7, description: "Public description" }],
    ["a blank title", { title: "   ", description: "Public description" }],
    ["a non-string description", { title: "Public title", description: false }],
    ["a blank description", { title: "Public title", description: "   " }]
  ])("rejects %s from the product copy adapter", async (_label, result) => {
    const generateProductCopy = vi.fn(async () =>
      result as unknown as GeneratedProductCopy
    );
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(502);

    expect(response.body).toEqual({ error: "Invalid copy generation response" });
  });

  test("returns a safe status when default product copy generation fails", async () => {
    const response = await request(createApp({ env: {} }))
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(500);

    expect(response.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(response.body)).not.toContain("secret-key-value");
  });

  test("does not expose the Packy key in independent route errors", async () => {
    const apiKey = "route-test-secret-key";
    const generateProductCopy = vi.fn(async () => {
      throw new Error(`Provider rejected ${apiKey}`);
    });
    const response = await request(
      createApp({ env: { PACKY_API_KEY: apiKey }, generateProductCopy })
    )
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(500);

    expect(response.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(response.body)).not.toContain(apiKey);
  });

  test.each([
    [new Error("Packy product copy API failed: 429 /private/path"), 429],
    [new Error("Packy product copy API failed: 500 token=secret"), 503],
    [new Error("Packy product copy API returned empty content."), 502]
  ])("maps copy provider failures to a safe response", async (error, status) => {
    const app = createApp({
      generateProductCopy: async () => {
        throw error;
      }
    });
    const response = await request(app)
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(status);

    expect(response.body).toEqual({ error: "Packy copy generation failed" });
    expect(JSON.stringify(response.body)).not.toMatch(/private|token|secret/);
  });

  test("maps copy transport failures to a safe unavailable response", async () => {
    const generateProductCopy = vi.fn(async () => {
      throw new TypeError("fetch failed C:\\private\\token.txt");
    });
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(503);

    expect(response.body).toEqual({ error: "Packy copy generation unavailable" });
    expect(response.text).not.toMatch(/private|token|fetch failed/i);
  });

  test("rejects an image role request without source images", async () => {
    const generateProductImageRole = vi.fn();
    const response = await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .expect(400);

    expect(response.body).toEqual({
      error: "At least one source image file is required"
    });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test.each([
    ["blank selling points", { sellingPoints: "   " }, "Selling points are required"],
    ["long selling points", { sellingPoints: "x".repeat(10001) }, "Selling points are invalid"],
    ["long product type", { sellingPoints: "valid", productType: "x".repeat(501) }, "Product type is invalid"]
  ])("rejects %s before image generation", async (_name, fields, error) => {
    const generateProductImageRole = vi.fn();
    let pending = request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main");
    for (const [key, value] of Object.entries(fields)) {
      pending = pending.field(key, value);
    }
    const response = await pending
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test.each([
    ["non-image MIME", pngImage, "text/plain", "one.txt"],
    ["spoofed PNG", Buffer.from("not png"), "image/png", "one.png"],
    ["spoofed JPEG", Buffer.from("not jpeg"), "image/jpeg", "one.jpg"],
    ["spoofed WebP", Buffer.from("RIFFxxxxNOPE"), "image/webp", "one.webp"]
  ])("rejects %s before image generation", async (_name, data, contentType, filename) => {
    const generateProductImageRole = vi.fn();
    const response = await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", data, { filename, contentType })
      .expect(400);

    expect(response.body).toEqual({ error: "Invalid source image file" });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test.each([
    [pngImage, "image/png", "one.png"],
    [jpegImage, "image/jpeg", "one.jpg"],
    [webpImage, "image/webp", "one.webp"]
  ])("accepts recognized supported image magic bytes", async (data, contentType, filename) => {
    const generateProductImageRole = vi.fn(async (input) => ({
      role: input.role,
      imageUrl: "https://cdn.example.com/result.png"
    }));
    await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", data, { filename, contentType })
      .expect(200);

    expect(generateProductImageRole).toHaveBeenCalledOnce();
  });

  test("returns safe JSON when an image exceeds 5 MiB", async () => {
    const generateProductImageRole = vi.fn();
    const response = await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "large.png",
        contentType: "image/png"
      })
      .expect(413);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "Image file exceeds 5 MiB limit" });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test("returns safe JSON when more than 4 images are uploaded", async () => {
    const generateProductImageRole = vi.fn();
    let pending = request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid");
    for (let index = 0; index < 5; index += 1) {
      pending = pending.attach("images", pngImage, {
        filename: `${index}.png`,
        contentType: "image/png"
      });
    }
    const response = await pending.expect(400);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: "At most 4 source images are allowed" });
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test.each(["MAIN", "unknown", "", "main "])(
    "rejects unknown product image role %j before generation",
    async (role) => {
      const generateProductImageRole = vi.fn();
      const response = await request(createApp({ generateProductImageRole }))
        .post("/api/generate-product-image-role")
        .field("role", role)
        .field("sellingPoints", "valid")
        .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
        .expect(400);

      expect(response.body).toEqual({ error: "Invalid product image role" });
      expect(generateProductImageRole).not.toHaveBeenCalled();
    }
  );

  test.each(PRODUCT_IMAGE_ROLES)(
    "generates the independent %s product image role without invoking copy",
    async (role) => {
      const generateProductCopy = vi.fn();
      const generateProductImageRole = vi.fn(async (input) => ({
        role: input.role,
        imageUrl: `https://cdn.example.com/${input.role}.png`
      }));
      const response = await request(
        createApp({ generateProductCopy, generateProductImageRole })
      )
        .post("/api/generate-product-image-role")
        .field("role", role)
        .field("productType", "   ")
        .field("sellingPoints", productInput.sellingPoints)
        .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
        .expect(200);

      expect(response.body).toEqual({
        role,
        imageUrl: `https://cdn.example.com/${role}.png`
      });
      expect(generateProductImageRole).toHaveBeenCalledWith(
        expect.objectContaining({
          role,
          productType: "Product",
          sellingPoints: productInput.sellingPoints,
          images: [expect.objectContaining({ originalname: "one.png" })]
        })
      );
      expect(generateProductCopy).not.toHaveBeenCalled();
    }
  );

  test("returns only whitelisted product image role fields", async () => {
    const generateProductImageRole = vi.fn(async () => ({
      role: "main" as const,
      imageUrl: "https://cdn.example.com/main.png",
      secret: "provider-token",
      internal: { traceId: "private-trace" },
      debug: true
    }));
    const response = await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(200);

    expect(response.body).toEqual({
      role: "main",
      imageUrl: "https://cdn.example.com/main.png"
    });
  });

  test.each([
    ["undefined", undefined],
    ["a mismatched role", { role: "side", imageUrl: "https://cdn.example.com/main.png" }],
    ["a javascript URL", { role: "main", imageUrl: "javascript:alert(1)" }],
    ["a file URL", { role: "main", imageUrl: "file:///private/result.png" }],
    ["a relative URL", { role: "main", imageUrl: "/result.png" }],
    ["an HTTP URL", { role: "main", imageUrl: "http://cdn.example.com/result.png" }],
    ["a malformed URL", { role: "main", imageUrl: "not a url" }],
    ["a non-string URL", { role: "main", imageUrl: 7 }]
  ])("rejects %s from the product image role adapter", async (_label, result) => {
    const generateProductImageRole = vi.fn(async () =>
      result as unknown as GeneratedProductImage
    );
    const response = await request(createApp({ generateProductImageRole }))
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(502);

    expect(response.body).toEqual({ error: "Invalid image generation response" });
  });

  test("maps default Packy image transport failures to a safe unavailable response", async () => {
    const secret = "provider-secret C:\\private\\token.txt";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError(`fetch failed ${secret}`)
    );

    try {
      const response = await request(createApp({
        env: { PACKY_API_KEY: "image-transport-test-key" }
      }))
        .post("/api/generate-product-image-role")
        .field("role", "main")
        .field("sellingPoints", "valid")
        .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
        .expect(503);

      expect(response.body).toEqual({
        error: "Packy image generation unavailable"
      });
      expect(response.text).not.toMatch(/provider-secret|private|token|fetch failed/i);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("a copy failure does not affect a later image role request", async () => {
    const generateProductCopy = vi.fn(async () => {
      throw new Error("copy failed");
    });
    const generateProductImageRole = vi.fn(async (input) => ({
      role: input.role,
      imageUrl: "https://cdn.example.com/main.png"
    }));
    const app = createApp({ generateProductCopy, generateProductImageRole });

    await request(app)
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(500);
    const imageResponse = await request(app)
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(200);

    expect(imageResponse.body.imageUrl).toBe("https://cdn.example.com/main.png");
  });

  test("an image failure does not affect a later copy request", async () => {
    const generateProductCopy = vi.fn(async () => ({
      title: "Recovered copy",
      description: "Independent copy result."
    }));
    const generateProductImageRole = vi.fn(async () => {
      throw new Error("image failed");
    });
    const app = createApp({ generateProductCopy, generateProductImageRole });

    await request(app)
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(500);
    const copyResponse = await request(app)
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(200);

    expect(copyResponse.body).toEqual({
      title: "Recovered copy",
      description: "Independent copy result."
    });
  });

  test("maps image provider and unknown failures to safe responses", async () => {
    const providerApp = createApp({
      generateProductImageRole: async () => {
        throw new Error("Packy image API failed: 500 C:\\private\\token.txt");
      }
    });
    const providerResponse = await request(providerApp)
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(503);

    expect(providerResponse.body).toEqual({ error: "Packy image generation failed" });
    expect(JSON.stringify(providerResponse.body)).not.toMatch(/private|token/);

    const unknownApp = createApp({
      generateProductImageRole: async () => {
        throw new Error("unknown secret path C:\\private");
      }
    });
    const unknownResponse = await request(unknownApp)
      .post("/api/generate-product-image-role")
      .field("role", "main")
      .field("sellingPoints", "valid")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .expect(500);

    expect(unknownResponse.body).toEqual({ error: "Internal server error" });
  });

  test("uploads multiple source images through injected service", async () => {
    const app = createApp({
      uploadImages: async (files) => ({
        imageUrls: files.map((file) => `https://cdn.example.com/${file.originalname}`)
      })
    });

    const response = await request(app)
      .post("/api/upload-images")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .attach("images", jpegImage, { filename: "two.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(response.body.imageUrls).toEqual([
      "https://cdn.example.com/one.png",
      "https://cdn.example.com/two.jpg"
    ]);
  });

  test.each([
    ["non-image", Buffer.from("plain text"), "text/plain", "one.txt"],
    ["spoofed image", Buffer.from("not png"), "image/png", "one.png"]
  ])("rejects %s on the legacy upload-images route", async (_name, data, contentType, filename) => {
    const uploadImages = vi.fn();
    const response = await request(createApp({ uploadImages }))
      .post("/api/upload-images")
      .attach("images", data, { filename, contentType })
      .expect(400);

    expect(response.body).toEqual({ error: "Invalid source image file" });
    expect(uploadImages).not.toHaveBeenCalled();
  });

  test("rejects spoofed input on the legacy generate-image route", async () => {
    const generateImage = vi.fn();
    const response = await request(createApp({ generateImage }))
      .post("/api/generate-image")
      .attach("image", Buffer.from("not jpeg"), {
        filename: "one.jpg",
        contentType: "image/jpeg"
      })
      .expect(400);

    expect(response.body).toEqual({ error: "Invalid source image file" });
    expect(generateImage).not.toHaveBeenCalled();
  });

  test("rejects spoofed input on the legacy generate-main-images route", async () => {
    const generateMainImages = vi.fn();
    const response = await request(createApp({ generateMainImages }))
      .post("/api/generate-main-images")
      .attach("images", Buffer.from("not webp"), {
        filename: "one.webp",
        contentType: "image/webp"
      })
      .expect(400);

    expect(response.body).toEqual({ error: "Invalid source image file" });
    expect(generateMainImages).not.toHaveBeenCalled();
  });

  test.each(["upload", "image", "main"])(
    "does not expose injected legacy %s errors",
    async (route) => {
      const secret = "C:\\private\\token-secret.txt";
      const dependencies: AppDependencies = {};

      if (route === "upload") {
        dependencies.uploadImages = async () => {
          throw new Error(secret);
        };
      } else if (route === "image") {
        dependencies.generateImage = async () => {
          throw new Error(secret);
        };
      } else {
        dependencies.generateMainImages = async () => {
          throw new Error(secret);
        };
      }

      let pending = request(createApp(dependencies)).post(
        route === "upload"
          ? "/api/upload-images"
          : route === "image"
            ? "/api/generate-image"
            : "/api/generate-main-images"
      );
      pending = route === "image"
        ? pending.attach("image", pngImage, {
            filename: "one.png",
            contentType: "image/png"
          })
        : pending.attach("images", pngImage, {
            filename: "one.png",
            contentType: "image/png"
          });
      const response = await pending.expect(500);

      expect(response.body).toEqual({ error: "Internal server error" });
      expect(response.text).not.toMatch(/private|token-secret/i);
    }
  );

  test.each([
    [
      new Error("Packy product research API failed: 503 token-secret"),
      503,
      "Packy product research failed"
    ],
    [
      new Error("Packy product copy API failed: 503 token-secret"),
      503,
      "Packy product copy failed"
    ],
    [
      new Error("Product copy response must contain exactly two lines token-secret"),
      503,
      "Packy product copy failed"
    ]
  ])("reports the safe failing full-field stage", async (error, status, message) => {
    const response = await request(createApp({
      generateProductFields: async () => {
        throw error;
      }
    }))
      .post("/api/generate-product-fields")
      .field("input", JSON.stringify(productInput))
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "4748549810"
      }))
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(status);

    expect(response.body).toEqual({ error: message });
    expect(response.text).not.toContain("token-secret");
  });

  test("passes validated source images, product facts and identity to full-field generation", async () => {
    const evidence: ProductResearchEvidence = {
      productType: "Cotton thong underwear",
      variant: "Black / White / Beige",
      matchSummary: "The uploaded image matches the cited supplier listing.",
      confidence: "high",
      sources: [{
        url: "https://supplier.example.com/item",
        title: "Supplier product listing",
        matchedVariant: "Black / White / Beige",
        evidence: "The listing supplies the same variant and package facts."
      }]
    };
    const generateProductFields = vi.fn(async () => ({
      fields,
      source: "ai" as const,
      evidence,
      issues: []
    }));

    const response = await request(createApp({ generateProductFields }))
      .post("/api/generate-product-fields")
      .field("input", JSON.stringify(productInput))
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "4748549810"
      }))
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(200);

    expect(generateProductFields).toHaveBeenCalledWith({
      productInput,
      images: [expect.objectContaining({ mimetype: "image/png" })],
      identity: { sku: "Elosung10000", eanCode: "4748549810" }
    });
    expect(response.body.result.issues).toEqual([]);
  });

  test("rejects invalid full-field generation multipart inputs safely", async () => {
    const validInput = JSON.stringify(productInput);
    const validIdentity = JSON.stringify({
      sku: "Elosung10000",
      eanCode: "4748549810"
    });
    const app = createApp({
      generateProductFields: vi.fn(async () => ({ fields, source: "ai" as const }))
    });

    await request(app)
      .post("/api/generate-product-fields")
      .field("input", validInput)
      .field("identity", validIdentity)
      .expect(400, { error: "At least one source image file is required" });
    await request(app)
      .post("/api/generate-product-fields")
      .field("input", validInput)
      .field("identity", validIdentity)
      .attach("images", Buffer.from("not-a-png"), {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: "Invalid source image file" });
    await request(app)
      .post("/api/generate-product-fields")
      .field("input", "{invalid-json")
      .field("identity", validIdentity)
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: "Product input is invalid" });
    await request(app)
      .post("/api/generate-product-fields")
      .field("input", validInput)
      .field("identity", JSON.stringify({
        sku: "Wrong10000",
        eanCode: "4748549810"
      }))
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: "Product identity is invalid" });
    await request(app)
      .post("/api/generate-product-fields")
      .field("input", validInput)
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "123"
      }))
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: "Product identity is invalid" });
  });

  test.each([
    ["missing weight", { ...productInput, packageWeightKg: undefined }],
    ["zero weight", { ...productInput, packageWeightKg: 0 }],
    ["negative weight", { ...productInput, packageWeightKg: -1 }],
    [
      "non-finite weight",
      { ...productInput, packageWeightKg: Number.POSITIVE_INFINITY }
    ],
    ["missing length", { ...productInput, lengthCm: undefined }],
    ["zero width", { ...productInput, widthCm: 0 }],
    ["negative height", { ...productInput, heightCm: -1 }],
    [
      "non-finite length",
      { ...productInput, lengthCm: Number.POSITIVE_INFINITY }
    ]
  ])("rejects %s before product field generation", async (_name, input) => {
    const generateProductFields = vi.fn();
    const response = await request(createApp({ generateProductFields }))
      .post("/api/generate-product-fields")
      .field("input", JSON.stringify(input))
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "4748549810"
      }))
      .attach("images", pngImage, {
        filename: "source.png",
        contentType: "image/png"
      })
      .expect(400);

    expect(response.body).toEqual({
      error: "Package weight, length, width, and height are required."
    });
    expect(generateProductFields).not.toHaveBeenCalled();
  });

  test("rejects a full-field generation image batch above four million bytes", async () => {
    const oversizedPng = Buffer.concat([
      pngImage,
      Buffer.alloc(4_000_001 - pngImage.length)
    ]);

    await request(createApp())
      .post("/api/generate-product-fields")
      .field("input", JSON.stringify(productInput))
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "4748549810"
      }))
      .attach("images", oversizedPng, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: "Source image batch is too large" });
  });

  test.each([
    ["category ID", { categoryId: 0 }, "Category ID is invalid"],
    ["category name", { categoryName: 123 }, "Category name is invalid"],
    ["colour", { colour: ["Black"] }, "Colour is invalid"]
  ])("rejects an invalid manual %s in full-field generation", async (
    _label,
    override,
    expectedError
  ) => {
    await request(createApp())
      .post("/api/generate-product-fields")
      .field("input", JSON.stringify({ ...productInput, ...override }))
      .field("identity", JSON.stringify({
        sku: "Elosung10000",
        eanCode: "4748549810"
      }))
      .attach("images", pngImage, {
        filename: "product.png",
        contentType: "image/png"
      })
      .expect(400, { error: expectedError });
  });

  test("generates 5 Shopify product images through injected Packy image service", async () => {
    const app = createApp({
      generateMainImages: async (input) => {
        expect(input.count).toBe(5);

        return {
          imageUrls: Array.from(
            { length: input.count },
            (_item, index) => `https://cdn.example.com/shopify-${index + 1}.png`
          )
        };
      }
    });

    const response = await request(app)
      .post("/api/generate-main-images")
      .field("productType", "Women Cotton Thong Underwear")
      .field("sellingPoints", productInput.sellingPoints)
      .field("count", "6")
      .attach("images", pngImage, { filename: "one.png", contentType: "image/png" })
      .attach("images", jpegImage, { filename: "two.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(response.body.imageUrls).toEqual([
      "https://cdn.example.com/shopify-1.png",
      "https://cdn.example.com/shopify-2.png",
      "https://cdn.example.com/shopify-3.png",
      "https://cdn.example.com/shopify-4.png",
      "https://cdn.example.com/shopify-5.png"
    ]);
  });

  test("creates a Newton import task from a canonicalized 1688 product URL", async () => {
    const createNewtonImportTask = vi.fn(async () => ({ taskId: "task_123" }));
    const response = await request(createApp({ createNewtonImportTask }))
      .post("/api/newton/import-tasks")
      .send({
        sourceUrl:
          "https://m.1688.com/offer/972942337202.html?spm=private-tracking"
      })
      .expect(202);

    expect(response.body).toEqual({ taskId: "task_123" });
    expect(createNewtonImportTask).toHaveBeenCalledWith(
      "https://detail.1688.com/offer/972942337202.html"
    );
  });

  test.each([
    [undefined, "请输入有效的 1688 商品链接"],
    ["https://example.com/offer/972942337202.html", "请输入有效的 1688 商品链接"],
    ["https://detail.1688.com/", "链接中未找到 1688 商品 ID"]
  ])("rejects invalid Newton product URL %j", async (sourceUrl, error) => {
    const createNewtonImportTask = vi.fn();
    const response = await request(createApp({ createNewtonImportTask }))
      .post("/api/newton/import-tasks")
      .send({ sourceUrl })
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(createNewtonImportTask).not.toHaveBeenCalled();
  });

  test("returns public Newton task status without provider internals", async () => {
    const product = {
      offerId: "972942337202",
      sourceUrl: "https://detail.1688.com/offer/972942337202.html",
      title: "秋冬防风眼镜针织毛线帽",
      categoryHint: "Goggle beanie",
      sellingPoints: "罗纹针织，带圆形护目镜",
      purchasePriceCny: 9,
      imageUrls: ["https://cbu01.alicdn.com/img/ibank/example.jpg"]
    };
    const getNewtonImportTask = vi.fn(async () => ({
      status: "complete" as const,
      product
    }));
    const response = await request(createApp({ getNewtonImportTask }))
      .get("/api/newton/import-tasks/task_123")
      .expect(200);

    expect(response.body).toEqual({ status: "complete", product });
    expect(getNewtonImportTask).toHaveBeenCalledWith("task_123");
  });

  test("proxies only allowlisted Newton product images", async () => {
    const downloadNewtonImage = vi.fn(async () => ({
      buffer: pngImage,
      contentType: "image/png" as const
    }));
    const app = createApp({ downloadNewtonImage });

    const response = await request(app)
      .post("/api/newton/import-image")
      .send({
        imageUrl: "https://cbu01.alicdn.com/img/ibank/example.png"
      })
      .expect(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.body).toEqual(pngImage);

    await request(app)
      .post("/api/newton/import-image")
      .send({ imageUrl: "https://127.0.0.1/private.png" })
      .expect(400, { error: "牛顿商品图片链接无效" });
    expect(downloadNewtonImage).toHaveBeenCalledTimes(1);
  });

  test("does not expose injected Newton provider errors", async () => {
    const privateMessage = "access-token=C:\\private\\newton-secret";
    const response = await request(createApp({
      createNewtonImportTask: async () => {
        throw new Error(privateMessage);
      }
    }))
      .post("/api/newton/import-tasks")
      .send({
        sourceUrl: "https://detail.1688.com/offer/972942337202.html"
      })
      .expect(502);

    expect(response.body).toEqual({ error: "牛顿云端请求失败" });
    expect(response.text).not.toContain(privateMessage);
  });

  test("returns mock DSZ upload request when token is not configured", async () => {
    const app = createApp({
      env: {
        ADMIN_API_BASE_URL:
          "https://services.dropshipzone.com.au/admin/api/supplier/v1"
      }
    });

    const response = await request(app)
      .post("/api/upload-product")
      .send({ fields })
      .expect(200);

    expect(response.body.mode).toBe("mock");
    expect(response.body.requestBody.products[0].sku).toBe("Elosung10001");
    expect(response.body.requestBody.products[0].categories).toBe("947");
  });
});
