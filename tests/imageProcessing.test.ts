import { describe, expect, test, vi } from "vitest";
import {
  prepareSourceImage,
  SOURCE_IMAGE_MAX_DIMENSION,
  SOURCE_IMAGE_WEBP_QUALITY
} from "../src/imageProcessing";

describe("source image preprocessing", () => {
  test("keeps the original file when browser image decoding is unavailable", async () => {
    const file = new File(["source"], "source.png", { type: "image/png" });

    await expect(prepareSourceImage(file, {
      createImageBitmap: undefined,
      createCanvas: undefined
    })).resolves.toBe(file);
  });

  test("downscales a large image once and encodes a smaller WebP upload", async () => {
    const file = new File([new Uint8Array(1_200_000)], "product.png", {
      type: "image/png",
      lastModified: 123
    });
    const drawImage = vi.fn();
    const close = vi.fn();
    const optimizedBlob = new Blob(["optimized"], { type: "image/webp" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
        expect(type).toBe("image/webp");
        expect(quality).toBe(SOURCE_IMAGE_WEBP_QUALITY);
        callback(optimizedBlob);
      })
    };

    const result = await prepareSourceImage(file, {
      createImageBitmap: vi.fn(async () => ({
        width: 3200,
        height: 1600,
        close
      })),
      createCanvas: () => canvas
    });

    expect(canvas.width).toBe(SOURCE_IMAGE_MAX_DIMENSION);
    expect(canvas.height).toBe(SOURCE_IMAGE_MAX_DIMENSION / 2);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(result).not.toBe(file);
    expect(result.name).toBe("product.webp");
    expect(result.type).toBe("image/webp");
    expect(result.size).toBe(optimizedBlob.size);
    expect(result.lastModified).toBe(123);
  });
});
