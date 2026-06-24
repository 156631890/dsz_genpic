import request from "supertest";
import { describe, expect, test } from "vitest";
import { createApp } from "../../server/app";
import { standardZoneRates } from "../../server/services/dszRules";
import type { DszProductFields, ProductInput } from "../../shared/product";

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
    const app = createApp({
      env: {
        PACKY_FIELD_API_KEY: "field-key",
        PACKY_IMAGE_API_KEY: "image-key",
        IMGBB_API_KEY: "imgbb-key",
        ADMIN_API_BASE_URL:
          "https://services.dropshipzone.com.au/admin/api/supplier/v1"
      }
    });

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({
      ok: true,
      packyConfigured: true,
      imageUploadConfigured: true,
      adminBaseUrl: "https://services.dropshipzone.com.au/admin/api/supplier/v1",
      adminMockMode: true
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

  test("generates Amazon main images through injected Packy image service", async () => {
    const app = createApp({
      generateMainImages: async (input) => ({
        imageUrls: input.images.map(
          (_file, index) => `https://cdn.example.com/main-${index + 1}.png`
        )
      })
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
      "https://cdn.example.com/main-1.png",
      "https://cdn.example.com/main-2.png"
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
