import type {
  GeneratedProductCopy,
  GeneratedProductImage,
  ProductImageRole,
  ProductInput
} from "../shared/product";

export async function uploadSourceImages(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  const data = await requestJson("/api/upload-images", {
    method: "POST",
    body: form
  }, "图片上传失败");
  return (data as { imageUrls: string[] }).imageUrls;
}

export async function requestProductCopy(
  input: ProductInput
): Promise<GeneratedProductCopy> {
  return await requestJson("/api/generate-product-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  }, "商品文案生成失败") as GeneratedProductCopy;
}

export async function requestProductImageRole(input: {
  role: ProductImageRole;
  files: File[];
  productType: string;
  sellingPoints: string;
}): Promise<GeneratedProductImage> {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("role", input.role);
  form.append("productType", input.productType);
  form.append("sellingPoints", input.sellingPoints);

  return await requestJson("/api/generate-product-image-role", {
    method: "POST",
    body: form
  }, "商品图片生成失败") as GeneratedProductImage;
}

async function requestJson(
  url: string,
  init: RequestInit,
  fallbackError: string
): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    const error = isRecord(data) && typeof data.error === "string"
      ? data.error
      : fallbackError;
    throw new Error(error);
  }

  if (data === undefined) throw new Error(fallbackError);
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
