import request from "supertest";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../../server/app";
import { standardZoneRates } from "../../server/services/dszRules";
import {
  PRODUCT_IMAGE_ROLES,
  type DszProductFields,
  type ProductInput
} from "../../shared/product";

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
  test("reports health and mock/live upload state", async () => {
    const apiKey = "health-test-secret-key";
    const app = createApp({
      env: {
        PACKY_API_KEY: apiKey,
        PACKY_TEXT_MODEL: "copy-model",
        PACKY_IMAGE_MODEL: "image-model",
        PACKY_IMAGE_SIZE: "1536x1024",
        PACKY_IMAGE_QUALITY: "high",
        IMGBB_API_KEY: "imgbb-key",
        ADMIN_API_BASE_URL:
          "https://services.dropshipzone.com.au/admin/api/supplier/v1"
      }
    });

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({
      ok: true,
      packyConfigured: true,
      textConfigured: true,
      imageConfigured: true,
      textModel: "copy-model",
      imageModel: "image-model",
      imageSize: "1536x1024",
      imageQuality: "high",
      imageUploadConfigured: true,
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
      textModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high"
    });
  });

  test.each([
    [undefined, "Selling points are required"],
    [{ ...productInput, sellingPoints: "   " }, "Selling points are required"],
    [{ ...productInput, imageUrls: [] }, "Uploaded image URLs are required"],
    [{ ...productInput, imageUrls: undefined }, "Uploaded image URLs are required"],
    [{ ...productInput, imageUrls: "not-an-array" }, "Uploaded image URLs are required"]
  ])("rejects invalid independent product copy input", async (input, error) => {
    const generateProductCopy = vi.fn();
    const response = await request(createApp({ generateProductCopy }))
      .post("/api/generate-product-copy")
      .send({ input })
      .expect(400);

    expect(response.body).toEqual({ error });
    expect(generateProductCopy).not.toHaveBeenCalled();
  });

  test("returns independent generated product copy without a wrapper", async () => {
    const generateProductCopy = vi.fn(() => ({
      title: "Premium Cotton Underwear",
      description: "A breathable everyday essential."
    }));
    const generateProductImageRole = vi.fn();
    const response = await request(
      createApp({ generateProductCopy, generateProductImageRole })
    )
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(200);

    expect(response.body).toEqual({
      title: "Premium Cotton Underwear",
      description: "A breathable everyday essential."
    });
    expect(generateProductCopy).toHaveBeenCalledWith(productInput);
    expect(generateProductImageRole).not.toHaveBeenCalled();
  });

  test("returns a safe status when default product copy generation fails", async () => {
    const response = await request(createApp({ env: {} }))
      .post("/api/generate-product-copy")
      .send({ input: productInput })
      .expect(500);

    expect(response.body.error).toContain("PACKY_API_KEY");
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

    expect(JSON.stringify(response.body)).not.toContain(apiKey);
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

  test.each(["MAIN", "unknown", "", "main "])(
    "rejects unknown product image role %j before generation",
    async (role) => {
      const generateProductImageRole = vi.fn();
      const response = await request(createApp({ generateProductImageRole }))
        .post("/api/generate-product-image-role")
        .field("role", role)
        .attach("images", Buffer.from("one"), "one.png")
        .expect(400);

      expect(response.body).toEqual({ error: "Invalid product image role" });
      expect(generateProductImageRole).not.toHaveBeenCalled();
    }
  );

  test.each(PRODUCT_IMAGE_ROLES)(
    "generates the independent %s product image role without invoking copy",
    async (role) => {
      const generateProductCopy = vi.fn();
      const generateProductImageRole = vi.fn((input) => ({
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
        .attach("images", Buffer.from("one"), "one.png")
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
      .attach("images", Buffer.from("one"), "one.png")
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
      .attach("images", Buffer.from("one"), "one.png")
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

  test("uploads multiple source images through injected service", async () => {
    const app = createApp({
      uploadImages: async (files) => ({
        imageUrls: files.map((file) => `https://cdn.example.com/${file.originalname}`)
      })
    });

    const response = await request(app)
      .post("/api/upload-images")
      .attach("images", Buffer.from("one"), "one.png")
      .attach("images", Buffer.from("two"), "two.png")
      .expect(200);

    expect(response.body.imageUrls).toEqual([
      "https://cdn.example.com/one.png",
      "https://cdn.example.com/two.png"
    ]);
  });

  test("generates Dropshipzone fields from uploaded image URLs and selling points", async () => {
    const app = createApp({
      generateProductFields: async (input) => ({
        fields: {
          ...fields,
          images: input.imageUrls,
          review_notes: [input.sellingPoints]
        },
        source: "ai"
      })
    });

    const response = await request(app)
      .post("/api/generate-product-fields")
      .send({ input: productInput })
      .expect(200);

    expect(response.body.result.fields.sku).toBe("Elosung10001");
    expect(response.body.result.fields.categories).toBe("947");
    expect(response.body.result.fields.review_notes).toEqual([
      productInput.sellingPoints
    ]);
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
      .attach("images", Buffer.from("one"), "one.png")
      .attach("images", Buffer.from("two"), "two.png")
      .expect(200);

    expect(response.body.imageUrls).toEqual([
      "https://cdn.example.com/shopify-1.png",
      "https://cdn.example.com/shopify-2.png",
      "https://cdn.example.com/shopify-3.png",
      "https://cdn.example.com/shopify-4.png",
      "https://cdn.example.com/shopify-5.png"
    ]);
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
