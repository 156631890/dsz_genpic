import type {
  GeneratedProductCopy,
  GeneratedProductImage,
  ProductImageRole,
  ProductInput,
  DszProductFields
} from "../shared/product";

export interface ServiceHealth {
  textConfigured: boolean;
  imageConfigured: boolean;
  textModel: string;
  imageModel: string;
}

export async function requestServiceHealth(signal?: AbortSignal): Promise<ServiceHealth> {
  const data = await requestJson("/api/health", { method: "GET", signal }, "服务状态不可用");
  if (!isRecord(data) || typeof data.textConfigured !== "boolean" ||
    typeof data.imageConfigured !== "boolean" || !isNonemptyString(data.textModel) ||
    !isNonemptyString(data.imageModel)) {
    throw new Error("服务状态不可用");
  }
  return {
    textConfigured: data.textConfigured,
    imageConfigured: data.imageConfigured,
    textModel: data.textModel,
    imageModel: data.imageModel
  };
}

export async function uploadSourceImages(files: File[], signal?: AbortSignal): Promise<string[]> {
  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  const data = await requestJson("/api/upload-images", {
    method: "POST",
    body: form,
    signal
  }, "图片上传失败");
  const imageUrls = isRecord(data) ? data.imageUrls : undefined;
  if (!Array.isArray(imageUrls) || imageUrls.length === 0 ||
    !imageUrls.every((url) => typeof url === "string" && isHttpsUrl(url))) {
    throw new Error("图片上传失败");
  }
  return imageUrls;
}

export async function requestProductCopy(
  input: ProductInput,
  signal?: AbortSignal
): Promise<GeneratedProductCopy> {
  const data = await requestJson("/api/generate-product-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal
  }, "商品文案生成失败");
  if (!isRecord(data) || !isNonemptyString(data.title) || !isNonemptyString(data.description)) {
    throw new Error("商品文案生成失败");
  }
  return { title: data.title, description: data.description };
}

export async function requestProductImageRole(input: {
  role: ProductImageRole;
  files: File[];
  productType: string;
  sellingPoints: string;
}, signal?: AbortSignal): Promise<GeneratedProductImage> {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("role", input.role);
  form.append("productType", input.productType);
  form.append("sellingPoints", input.sellingPoints);

  const data = await requestJson("/api/generate-product-image-role", {
    method: "POST",
    body: form,
    signal
  }, "商品图片生成失败");
  if (!isRecord(data) || data.role !== input.role ||
    typeof data.imageUrl !== "string" || !isHttpsUrl(data.imageUrl)) {
    throw new Error("商品图片生成失败");
  }
  return { role: input.role, imageUrl: data.imageUrl };
}

export async function uploadProductFields(
  fields: DszProductFields,
  signal?: AbortSignal
): Promise<unknown> {
  return requestJson("/api/upload-product", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
    signal
  }, "上传失败");
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
    throw new Error(responseError(data, fallbackError));
  }

  if (data === undefined) throw new Error(fallbackError);
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function responseError(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback;
  if (isNonemptyString(data.error)) return data.error;
  if (Array.isArray(data.errors)) {
    const errors = data.errors.filter(isNonemptyString);
    if (errors.length > 0) return errors.join("；");
  }
  return fallback;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
