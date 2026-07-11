import { describe, expect, test, vi } from "vitest";
import {
  buildProductImageRolePrompt,
  generateImageWithPacky,
  generateProductImageRoleWithPacky,
  generateShopifyProductImagesWithPacky
} from "../../server/services/packyImages";
import type { ProductImageRole } from "../../shared/product";

const images = [
  {
    buffer: Buffer.from("front"),
    mimetype: "image/png",
    originalname: "front.png"
  },
  {
    buffer: Buffer.from("side"),
    mimetype: "image/jpeg",
    originalname: "side.jpg"
  }
] as Express.Multer.File[];

const roles: ProductImageRole[] = [
  "main",
  "side",
  "detail",
  "lifestyle_1",
  "lifestyle_2"
];

function readFileBytes(file: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

describe("Packy fixed-role product images", () => {
  test("builds five distinct role prompts with shared single-image safety rules", () => {
    const prompts = roles.map((role) =>
      buildProductImageRolePrompt(role, "soft cotton and breathable stretch")
    );

    expect(new Set(prompts)).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).toContain("exactly one square");
      expect(prompt).toMatch(/no collage|do not create a collage/i);
      expect(prompt).toMatch(/grid/i);
      expect(prompt).toMatch(/split/i);
      expect(prompt).toMatch(/contact sheet/i);
      expect(prompt).toMatch(/no watermark/i);
      expect(prompt).toMatch(/no logo/i);
      expect(prompt).toMatch(/no badge/i);
      expect(prompt).toMatch(/unsupported text/i);
      expect(prompt).toMatch(/accurate/i);
      expect(prompt).toMatch(/recognizable/i);
      expect(prompt).toContain(
        "Selling points for visual emphasis only: soft cotton and breathable stretch"
      );
    }

    expect(prompts[0]).toMatch(/feature main image/i);
    expect(prompts[0]).toMatch(/no plain white|do not use .*plain white/i);
    expect(prompts[1]).toMatch(/side profile|alternate view/i);
    expect(prompts[2]).toMatch(/do not invent measurements or text/i);
    expect(prompts[3]).toMatch(/wider environmental/i);
    expect(prompts[3]).toMatch(/primary-use/i);
    expect(prompts[3]).toMatch(/supported by.*product facts/i);
    expect(prompts[4]).toMatch(/tighter in-use|secondary-context|alternate-perspective/i);
    expect(prompts[4]).toMatch(/do not repeat.*wide/i);
    expect(prompts[4]).toMatch(/only one verified context.*close in-use detail/i);
    expect(prompts[4]).toMatch(/rather than invent/i);
  });

  test("uses configured model, size, and normalized quality overrides", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("custom-image-model");
      expect(form.get("size")).toBe("1536x1024");
      expect(form.get("quality")).toBe("medium");
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.example.com/side.png" }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await generateProductImageRoleWithPacky({
      images,
      productType: "Cotton underwear",
      sellingPoints: "soft cotton",
      role: "side",
      env: {
        PACKY_API_KEY: "role-key",
        PACKY_IMAGE_MODEL: "custom-image-model",
        PACKY_IMAGE_SIZE: "1536x1024",
        PACKY_IMAGE_QUALITY: "medium"
      },
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("sends every source image in one fixed GPT-Image-2 multipart request", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe("https://www.packyapi.com/v1/images/edits");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Authorization: "Bearer role-key" });
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("gpt-image-2");
      expect(form.get("n")).toBe("1");
      expect(form.get("size")).toBe("1024x1024");
      expect(form.get("quality")).toBe("high");
      expect(form.getAll("image")).toHaveLength(2);
      expect(String(form.get("prompt"))).toMatch(/feature main image/i);
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.example.com/main.png" }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "main",
        env: { PACKY_API_KEY: "role-key" },
        fetchImpl
      })
    ).resolves.toEqual({
      role: "main",
      imageUrl: "https://cdn.example.com/main.png"
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("requires source images and PACKY_API_KEY without accepting the legacy image key", async () => {
    await expect(
      generateProductImageRoleWithPacky({
        images: [],
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "side",
        env: { PACKY_API_KEY: "role-key" }
      })
    ).rejects.toThrow("At least one source product image is required");

    const fetchImpl = vi.fn();
    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "side",
        env: { PACKY_IMAGE_API_KEY: "legacy-key" },
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow("Missing PACKY_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ["provider 503", () => new Response("unavailable", { status: 503 })],
    ["non-JSON response", () => new Response("not json", { status: 200 })],
    ["empty response", () => new Response("", { status: 200 })],
    ["no image", () => new Response(JSON.stringify({ data: [] }), { status: 200 })],
    ["wrong data type", () => new Response(JSON.stringify({ data: {} }), { status: 200 })],
    ["invalid entry", () => new Response(JSON.stringify({ data: [null] }), { status: 200 })]
  ])("rejects %s after retries without source-image fallback", async (_name, response) => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe("https://www.packyapi.com/v1/images/edits");
      return response();
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "detail",
        env: {
          PACKY_API_KEY: "role-key",
          IMGBB_API_KEY: "must-not-be-used"
        },
        fetchImpl
      })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(fetchImpl).mock.calls.every(([url]) =>
        String(url).endsWith("/v1/images/edits")
      )
    ).toBe(true);
  });

  test.each([
    ["relative", "/generated/product.png"],
    ["malformed", "not a url"],
    ["data", "data:image/png;base64,AAAA"],
    ["file", "file:///tmp/product.png"],
    ["javascript", "javascript:alert(1)"],
    ["ftp", "ftp://cdn.example.com/product.png"]
  ])("rejects %s provider URLs as malformed after bounded role retries", async (_name, url) => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ data: [{ url }] }),
      { status: 200 }
    )) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "main",
        env: { PACKY_API_KEY: "role-key" },
        fetchImpl
      })
    ).rejects.toThrow("Packy Shopify product image API returned malformed response");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test.each([
    "http://cdn.example.com/generated.png",
    "https://cdn.example.com/generated.png"
  ])("accepts and returns an absolute web provider URL: %s", async (url) => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ data: [{ url }] }),
      { status: 200 }
    )) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "side",
        env: { PACKY_API_KEY: "role-key" },
        fetchImpl
      })
    ).resolves.toEqual({ role: "side", imageUrl: url });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test.each([
    ["429", () => new Response("rate limited", { status: 429 })],
    ["network TypeError", () => new TypeError("fetch failed")]
  ])("retries transient %s and returns the later image", async (_name, firstFailure) => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        const failure = firstFailure();
        if (failure instanceof Error) throw failure;
        return failure;
      }
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.example.com/recovered.png" }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "detail",
        env: { PACKY_API_KEY: "role-key" },
        fetchImpl
      })
    ).resolves.toEqual({
      role: "detail",
      imageUrl: "https://cdn.example.com/recovered.png"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("does not retry a provider 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "main",
        env: { PACKY_API_KEY: "bad-key" },
        fetchImpl
      })
    ).rejects.toThrow("Packy Shopify product image API failed: 401");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("converts b64_json through ImgBB and preserves the requested role", async () => {
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/v1/images/edits")) {
        return new Response(
          JSON.stringify({ data: [{ b64_json: `data:image/png;base64,${tinyPng}` }] }),
          { status: 200 }
        );
      }

      expect(url).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      const blob = (init?.body as FormData).get("image") as File;
      expect(blob.type).toBe("image/png");
      expect(blob.name).toBe("packy-generated-1.png");
      expect(await readFileBytes(blob)).toEqual(Buffer.from(tinyPng, "base64"));
      return new Response(
        JSON.stringify({ data: { display_url: "https://i.ibb.co/lifestyle.png" } }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "lifestyle_2",
        env: { PACKY_API_KEY: "role-key", IMGBB_API_KEY: "imgbb-key" },
        fetchImpl
      })
    ).resolves.toEqual({
      role: "lifestyle_2",
      imageUrl: "https://i.ibb.co/lifestyle.png"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("rejects malformed base64 with a stable provider error after retries", async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe("https://www.packyapi.com/v1/images/edits");
      return new Response(
        JSON.stringify({ data: [{ b64_json: "data:image/png;base64,%%%not-base64%%%" }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "lifestyle_1",
        env: {
          PACKY_API_KEY: "role-key",
          IMGBB_API_KEY: "must-not-be-used"
        },
        fetchImpl
      })
    ).rejects.toThrow("Packy Shopify product image API returned malformed base64 image");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("does not regenerate when ImgBB delivery throws a TypeError", async () => {
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    let packyCalls = 0;
    let imgbbCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/images/edits")) {
        packyCalls += 1;
        return new Response(
          JSON.stringify({ data: [{ b64_json: `data:image/png;base64,${tinyPng}` }] }),
          { status: 200 }
        );
      }

      imgbbCalls += 1;
      throw new TypeError("delivery connection failed");
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        role: "detail",
        env: { PACKY_API_KEY: "role-key", IMGBB_API_KEY: "imgbb-key" },
        fetchImpl
      })
    ).rejects.toThrow("Packy generated image delivery failed: delivery connection failed");
    expect(packyCalls).toBe(1);
    expect(imgbbCalls).toBe(1);
  });

  test.each([
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"]
  ])("uses the %s MIME type and matching filename extension", async (mimetype, extension) => {
    const bytes = Buffer.from("valid-base64-fixture").toString("base64");
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/v1/images/edits")) {
        return new Response(
          JSON.stringify({ data: [{ b64_json: `data:${mimetype};base64,${bytes}` }] }),
          { status: 200 }
        );
      }

      const file = (init?.body as FormData).get("image") as File;
      expect(file.type).toBe(mimetype);
      expect(file.name).toBe(`packy-generated-1.${extension}`);
      return new Response(
        JSON.stringify({ data: { display_url: "https://i.ibb.co/generated-image" } }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await generateProductImageRoleWithPacky({
      images,
      productType: "Cotton underwear",
      sellingPoints: "soft cotton",
      role: "detail",
      env: { PACKY_API_KEY: "role-key", IMGBB_API_KEY: "imgbb-key" },
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("legacy aggregate retry isolation", () => {
  test.each([
    ["429", () => new Response("rate limited", { status: 429 })],
    ["malformed shape", () => new Response(JSON.stringify({ data: {} }), { status: 200 })]
  ])("does not retry or fall back for legacy %s failures", async (_name, failureFactory) => {
    const fetchImpl = vi.fn(async () => {
      const failure = failureFactory();
      if (failure instanceof Error) throw failure;
      return failure;
    }) as unknown as typeof fetch;

    await expect(
      generateShopifyProductImagesWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        env: {
          PACKY_IMAGE_API_KEY: "legacy-key",
          IMGBB_API_KEY: "must-not-be-used"
        },
        fetchImpl
      })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("preserves original TypeError instances for aggregate and standalone legacy APIs", async () => {
    const aggregateError = new TypeError("aggregate transport failed");
    const aggregateFetch = vi.fn(async () => {
      throw aggregateError;
    }) as unknown as typeof fetch;

    await expect(
      generateShopifyProductImagesWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        env: { PACKY_IMAGE_API_KEY: "legacy-key" },
        fetchImpl: aggregateFetch
      })
    ).rejects.toBe(aggregateError);
    expect(aggregateFetch).toHaveBeenCalledOnce();

    const standaloneError = new TypeError("standalone transport failed");
    const standaloneFetch = vi.fn(async () => {
      throw standaloneError;
    }) as unknown as typeof fetch;

    await expect(
      generateImageWithPacky({
        image: images[0],
        productType: "Cotton underwear",
        prompt: "clean product image",
        env: { PACKY_IMAGE_API_KEY: "legacy-key" },
        fetchImpl: standaloneFetch
      })
    ).rejects.toBe(standaloneError);
    expect(standaloneFetch).toHaveBeenCalledOnce();
  });

  test("keeps the legacy permissive base64 upload behavior without retry or fallback", async () => {
    let packyCall = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/images/edits")) {
        packyCall += 1;
        return new Response(
          JSON.stringify({
            data: packyCall === 1
              ? [{ b64_json: "%%%legacy-invalid-base64%%%" }]
              : [{ url: `https://cdn.example.com/legacy-${packyCall}.png` }]
          }),
          { status: 200 }
        );
      }

      expect(url).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      return new Response(
        JSON.stringify({ data: { display_url: "https://i.ibb.co/legacy-upload.png" } }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateShopifyProductImagesWithPacky({
        images,
        productType: "Cotton underwear",
        sellingPoints: "soft cotton",
        env: {
          PACKY_IMAGE_API_KEY: "legacy-key",
          IMGBB_API_KEY: "imgbb-key"
        },
        fetchImpl
      })
    ).resolves.toEqual({
      imageUrls: [
        "https://i.ibb.co/legacy-upload.png",
        "https://cdn.example.com/legacy-2.png",
        "https://cdn.example.com/legacy-3.png",
        "https://cdn.example.com/legacy-4.png",
        "https://cdn.example.com/legacy-5.png"
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
