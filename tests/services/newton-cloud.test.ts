// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import {
  NewtonCloudError,
  createNewtonImportTask,
  downloadNewtonImage,
  getNewtonImportTask,
  newAlibaba1688Signature,
  normalize1688ProductUrl,
  parseNewtonImportedProduct,
  validateNewtonImageUrl
} from "../../server/services/newtonCloud";

const env = {
  NEWTON_APP_KEY: "1000000",
  NEWTON_APP_SECRET: "test123",
  NEWTON_ACCESS_TOKEN: "access-token"
};
const sourceUrl = "https://detail.1688.com/offer/972942337202.html";
const importedProduct = {
  offerId: "972942337202",
  sourceUrl,
  title: "秋冬防风眼镜针织毛线帽",
  categoryHint: "Goggle beanie",
  sellingPoints: "罗纹针织\n带圆形护目镜\n多色可选",
  purchasePriceCny: 9,
  colour: "Black / Red",
  packageWeightKg: 0.2,
  lengthCm: 24,
  widthCm: 20,
  heightCm: 5,
  imageUrls: ["https://cbu01.alicdn.com/img/ibank/example.jpg"]
};

describe("Newton cloud integration", () => {
  test("matches the 1688 HMAC-SHA1 signature reference", () => {
    expect(newAlibaba1688Signature(
      "param2/1/system/currentTime/1000000",
      { b: "2", a: "1" },
      "test123"
    )).toBe("33E54F4F7B989E3E0E912D3FBD2F1A03CA7CCE88");
  });

  test("normalizes supported product URLs and rejects non-product URLs", () => {
    expect(normalize1688ProductUrl(
      "https://m.1688.com/offer/972942337202.html?spm=private"
    )).toEqual({
      offerId: "972942337202",
      sourceUrl
    });

    expect(() => normalize1688ProductUrl("https://example.com/offer/972942337202.html"))
      .toThrowError(NewtonCloudError);
    expect(() => normalize1688ProductUrl("https://detail.1688.com/"))
      .toThrow("链接中未找到 1688 商品 ID");
  });

  test("creates a signed asynchronous import task without exposing credentials", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("access_token")).toBe(env.NEWTON_ACCESS_TOKEN);
      expect(body.get("message")).toContain(sourceUrl);
      expect(body.get("auto")).toBe("true");
      expect(body.get("_aop_signature")).toMatch(/^[A-F0-9]{40}$/);
      return jsonResponse({ success: true, taskId: "task_123" });
    }) as unknown as typeof fetch;

    await expect(createNewtonImportTask({ sourceUrl, env, fetchImpl }))
      .resolves.toEqual({ taskId: "task_123" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gw.open.1688.com/openapi/param2/1/com.alibaba.agent/newtoncloud.task.create/1000000",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("maps running, completed, and stopped tasks to the public contract", async () => {
    const pendingFetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "RUNNING"
    })) as unknown as typeof fetch;
    await expect(getNewtonImportTask({
      taskId: "task_123",
      env,
      fetchImpl: pendingFetch
    })).resolves.toEqual({ status: "pending" });

    const completeFetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "END",
      content: `最终结果：\n\`\`\`json\n${JSON.stringify(importedProduct)}\n\`\`\``
    })) as unknown as typeof fetch;
    await expect(getNewtonImportTask({
      taskId: "task_123",
      env,
      fetchImpl: completeFetch
    })).resolves.toEqual({
      status: "complete",
      product: importedProduct
    });

    const stoppedFetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "WAIT_USER"
    })) as unknown as typeof fetch;
    await expect(getNewtonImportTask({
      taskId: "task_123",
      env,
      fetchImpl: stoppedFetch
    })).resolves.toEqual({
      status: "failed",
      error: "牛顿任务需要额外输入，请重新导入"
    });
  });

  test("rejects fabricated or malformed structured product data", () => {
    expect(() => parseNewtonImportedProduct(JSON.stringify({
      ...importedProduct,
      offerId: "111111111111"
    }))).toThrow("牛顿返回的商品资料无效");
    expect(() => parseNewtonImportedProduct(JSON.stringify({
      ...importedProduct,
      imageUrls: ["https://attacker.example/private"]
    }))).toThrow("牛顿返回的商品资料无效");
    expect(() => parseNewtonImportedProduct("not json"))
      .toThrow("牛顿返回的商品资料无效");
  });

  test("downloads only verified Alibaba-hosted image bytes", async () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length)
      }
    })) as unknown as typeof fetch;

    await expect(downloadNewtonImage({
      imageUrl: "https://cbu01.alicdn.com/img/ibank/example.png",
      fetchImpl
    })).resolves.toEqual({
      buffer: png,
      contentType: "image/png"
    });

    expect(() => validateNewtonImageUrl("https://127.0.0.1/private.png"))
      .toThrow("牛顿商品图片链接无效");
  });

  test("rejects image MIME spoofing and redirects outside the allowlist", async () => {
    const spoofedFetch = vi.fn().mockResolvedValue(new Response("not an image", {
      status: 200,
      headers: { "Content-Type": "image/png" }
    })) as unknown as typeof fetch;
    await expect(downloadNewtonImage({
      imageUrl: "https://cbu01.alicdn.com/img/ibank/example.png",
      fetchImpl: spoofedFetch
    })).rejects.toThrow("牛顿商品图片格式无效");

    const redirectFetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example/private.png" }
    })) as unknown as typeof fetch;
    await expect(downloadNewtonImage({
      imageUrl: "https://cbu01.alicdn.com/img/ibank/example.png",
      fetchImpl: redirectFetch
    })).rejects.toThrow("牛顿商品图片链接无效");
  });

  test("fails safely when server credentials are missing", async () => {
    await expect(createNewtonImportTask({
      sourceUrl,
      env: {},
      fetchImpl: vi.fn() as unknown as typeof fetch
    })).rejects.toMatchObject({
      status: 503,
      safeMessage: "牛顿云端尚未配置"
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
