import { describe, expect, test, vi } from "vitest";
import {
  buildProductImageRolePrompt,
  generateProductImageRoleWithPacky
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
    expect(prompts[3]).toMatch(/realistic.*scene/i);
    expect(prompts[4]).toMatch(/realistic.*scene/i);
    expect(prompts[3]).not.toBe(prompts[4]);
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
    ["no image", () => new Response(JSON.stringify({ data: [] }), { status: 200 })]
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

  test("converts b64_json through ImgBB and preserves the requested role", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/v1/images/edits")) {
        return new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }),
          { status: 200 }
        );
      }

      expect(url).toBe("https://api.imgbb.com/1/upload?key=imgbb-key");
      expect((init?.body as FormData).get("image")).toBeTruthy();
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
});
