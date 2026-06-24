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
    "<p><strong>Product Overview</strong></p><p>Women cotton thong underwear designed for everyday comfort.</p><p><strong>Key Features</strong></p><ul><li>Soft cotton blend supports comfortable daily wear.</li></ul><p><strong>Notes</strong></p><p>Wash before first use.</p>",
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
        categoryMapping: "Women's Intimates | 7032"
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

  test("loads built-in rule documents when deployed rule files are missing", async () => {
    const rules = await loadRuleDocuments({
      RULES_DIR: "Z:\\missing-dsz-rule-files"
    });

    expect(rules.fieldRules).toContain("Dropshipzone");
    expect(rules.productPrompt).toContain("single-line HTML");
    expect(rules.categoryMapping).toContain("Women's Intimates | 7032");
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
        categoryMapping: "Women's Intimates | 7032"
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
        categoryMapping: "Women's Intimates | 7032"
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const result = validateDszProductFields({ ...fields, images: fields.images.slice(0, 3) });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Images must contain at least 4 URLs"]);
  });

  test("wraps product in Dropshipzone products array", () => {
    const payload = buildAdminProductPayload(fields);
    const body = buildAdminRequestBody(payload);

    expect(payload.categories).toBe("7032");
    expect(payload.brand_name).toBe("Elosung");
    expect(payload.zone_rates.nz).toBe(10);
    expect(body).toEqual({ products: [payload] });
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

  test("returns mock upload body when token is missing", async () => {
    const result = await uploadProduct({
      payload: fields,
      env: {},
      fetchImpl: vi.fn()
    });

    expect(result.mode).toBe("mock");
    expect(result.requestBody).toEqual({ products: [fields] });
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
      payload: fields,
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
      payload: fields,
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
});
