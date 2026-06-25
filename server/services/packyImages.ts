import { uploadImagesToImgbb } from "./imageUploader.js";

const PACKY_SHOPIFY_PRODUCT_IMAGE_MAX_ATTEMPTS = 3;
const SHOPIFY_PRODUCT_IMAGE_COUNT = 5;

export interface PackyEditInput {
  baseUrl?: string;
  model?: string;
  prompt: string;
  productType: string;
  count?: number;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
}

export interface PackyEditRequest {
  url: string;
  fields: Record<string, string>;
}

interface PackyImageResult {
  url?: string;
  b64_json?: string;
}

export function buildPackyEditRequest(input: PackyEditInput): PackyEditRequest {
  const baseUrl = trimTrailingSlash(input.baseUrl || "https://www.packyapi.com");
  const prompt = [
    `Product type: ${input.productType}`,
    input.prompt,
    "Generate ecommerce product images for an independent store product page. Keep the product clear, accurate, and free of watermarks."
  ].join("\n");

  return {
    url: `${baseUrl}/v1/images/edits`,
    fields: {
      model: input.model || "gpt-image-2",
      prompt,
      n: String(input.count || 1),
      size: input.size || "1024x1024",
      quality: input.quality || "high"
    }
  };
}

export async function generateImageWithPacky(input: {
  image: Express.Multer.File;
  productType: string;
  prompt: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrl: string }> {
  const env = input.env || process.env;
  const apiKey = env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PACKY_IMAGE_API_KEY or PACKY_API_KEY. Cannot generate images.");
  }

  const request = buildPackyEditRequest({
    baseUrl: env.PACKY_BASE_URL,
    model: env.PACKY_IMAGE_MODEL,
    productType: input.productType,
    prompt: input.prompt
  });
  const form = new FormData();

  for (const [key, value] of Object.entries(request.fields)) {
    form.append(key, value);
  }

  form.append(
    "image",
    new Blob([new Uint8Array(input.image.buffer)], {
      type: input.image.mimetype || "application/octet-stream"
    }),
    input.image.originalname || "source.png"
  );

  const fetcher = input.fetchImpl || fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Packy image edit API failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: PackyImageResult[];
  };
  const imageUrls = await resolvePackyImageUrls(data.data || [], env, fetcher);
  const imageUrl = imageUrls[0];

  if (!imageUrl) {
    throw new Error("Packy image edit API returned no image.");
  }

  return { imageUrl };
}

export async function generateShopifyProductImagesWithPacky(input: {
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
  count?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrls: string[] }> {
  if (input.images.length === 0) {
    throw new Error("At least one source product image is required.");
  }

  const env = input.env || process.env;
  const apiKey = env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PACKY_IMAGE_API_KEY or PACKY_API_KEY. Cannot generate images.");
  }

  const count = SHOPIFY_PRODUCT_IMAGE_COUNT;
  const fetcher = input.fetchImpl || fetch;

  try {
    const firstBatch = await requestPackyShopifyProductImageUrls({
      images: input.images,
      productType: input.productType,
      sellingPoints: input.sellingPoints,
      count,
      env,
      fetcher,
      apiKey,
      maxAttempts: PACKY_SHOPIFY_PRODUCT_IMAGE_MAX_ATTEMPTS
    });
    const missingCount = count - firstBatch.length;
    const extraBatches =
      missingCount > 0
        ? await Promise.all(
            Array.from({ length: missingCount }, () =>
              requestPackyShopifyProductImageUrls({
                images: input.images,
                productType: input.productType,
                sellingPoints: input.sellingPoints,
                count: 1,
                env,
                fetcher,
                apiKey,
                maxAttempts: PACKY_SHOPIFY_PRODUCT_IMAGE_MAX_ATTEMPTS
              })
            )
          )
        : [];
    const imageUrls = uniqueList([...firstBatch, ...extraBatches.flat()]).slice(0, count);

    if (imageUrls.length >= SHOPIFY_PRODUCT_IMAGE_COUNT) {
      return { imageUrls };
    }
  } catch (error) {
    if (!isPackyTransientImageError(error)) {
      throw error;
    }
  }

  return {
    imageUrls: await buildSourceImageFallbackUrls({
      images: input.images,
      count,
      env,
      fetcher
    })
  };
}

async function requestPackyShopifyProductImageUrls(input: {
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
  count: number;
  env: Record<string, string | undefined>;
  fetcher: typeof fetch;
  apiKey: string;
  maxAttempts?: number;
}): Promise<string[]> {
  const maxAttempts = input.maxAttempts || 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestPackyShopifyProductImageUrlsOnce(input);
    } catch (error) {
      if (attempt === maxAttempts || !isPackyTransientImageError(error)) {
        throw error;
      }
    }
  }

  return [];
}

async function requestPackyShopifyProductImageUrlsOnce(input: {
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
  count: number;
  env: Record<string, string | undefined>;
  fetcher: typeof fetch;
  apiKey: string;
}): Promise<string[]> {
  const request = buildPackyEditRequest({
    baseUrl: input.env.PACKY_BASE_URL,
    model: input.env.PACKY_IMAGE_MODEL,
    productType: input.productType,
    prompt: buildShopifyProductImagePrompt(input.sellingPoints),
    count: input.count,
    size: input.env.PACKY_IMAGE_SIZE || "1024x1024",
    quality: normalizeQuality(input.env.PACKY_IMAGE_QUALITY)
  });
  const form = new FormData();

  for (const [key, value] of Object.entries(request.fields)) {
    form.append(key, value);
  }

  for (const image of input.images) {
    form.append(
      "image",
      new Blob([new Uint8Array(image.buffer)], {
        type: image.mimetype || "application/octet-stream"
      }),
      image.originalname || "source.png"
    );
  }

  const response = await input.fetcher(request.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Packy Shopify product image API failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: PackyImageResult[];
  };
  return resolvePackyImageUrls(data.data || [], input.env, input.fetcher);
}

function buildShopifyProductImagePrompt(sellingPoints: string): string {
  return [
    "Generate a Shopify product gallery from the uploaded product photos.",
    "Return exactly 5 square ecommerce images in this URL order.",
    "Images 1 to 3 are product-only feature images, not lifestyle scenes. Use clean studio presentation, no room setting, no model lifestyle scene, no decorative props.",
    "Images 4 and 5 are scene-only lifestyle images, not white-background feature images. Show the product in a realistic usage context while keeping it recognizable.",
    "Do not mix product-only feature images with lifestyle scene images. Feature images must stay separate from scene images.",
    "Image 1 URL role: feature main image. Clean white or light background, full product visible, centered, sharp, no props, no scene.",
    "Image 2 URL role: side angle. Product-only side profile, angle, shape, contour, or alternate product view on a clean background.",
    "Image 3 URL role: size, packaging, or detail. Product-only confirmed size, packaging, texture, material, stitching, label, closure, or useful close-up detail. Do not invent measurements or text.",
    "Image 4 URL role: lifestyle scene 1. Show one realistic use context relevant to the product and Australian independent store presentation, without turning it into a studio main image.",
    "Image 5 URL role: lifestyle scene 2. Show a second distinct realistic use context relevant to the product, without repeating the main image composition.",
    "Follow Shopify product image conventions: square 1:1 composition, consistent product presentation, high clarity, no watermarks, no logos, no badges, no unsupported text overlays.",
    "Keep the actual product accurate, recognizable, sharp, fully visible where appropriate, and free of unsupported claims.",
    `Selling points for visual emphasis only: ${sellingPoints}`
  ].join("\n");
}

async function resolvePackyImageUrls(
  images: PackyImageResult[],
  env: Record<string, string | undefined>,
  fetcher: typeof fetch
): Promise<string[]> {
  const imageUrls: Array<string | undefined> = [];
  const uploadFiles: Express.Multer.File[] = [];
  const uploadIndexes: number[] = [];

  images.forEach((image, index) => {
    if (image.url) {
      imageUrls[index] = image.url;
      return;
    }

    if (image.b64_json) {
      uploadIndexes.push(index);
      uploadFiles.push(buildGeneratedImageFile(image.b64_json, index));
    }
  });

  if (uploadFiles.length > 0) {
    const uploaded = await uploadImagesToImgbb({
      files: uploadFiles,
      env,
      fetchImpl: fetcher
    });

    uploaded.imageUrls.forEach((url, index) => {
      imageUrls[uploadIndexes[index]] = url;
    });
  }

  return imageUrls.filter((url): url is string => Boolean(url));
}

function buildGeneratedImageFile(
  base64Value: string,
  index: number
): Express.Multer.File {
  const parsed = parseBase64Image(base64Value);

  return {
    buffer: Buffer.from(parsed.base64, "base64"),
    mimetype: parsed.mimetype,
    originalname: `packy-generated-${index + 1}.png`
  } as Express.Multer.File;
}

function parseBase64Image(value: string): { base64: string; mimetype: string } {
  const dataUrlMatch = value.match(/^data:([^;]+);base64,(.*)$/);

  if (dataUrlMatch) {
    return {
      mimetype: dataUrlMatch[1],
      base64: dataUrlMatch[2]
    };
  }

  return {
    mimetype: "image/png",
    base64: value
  };
}

async function buildSourceImageFallbackUrls(input: {
  images: Express.Multer.File[];
  count: number;
  env: Record<string, string | undefined>;
  fetcher: typeof fetch;
}): Promise<string[]> {
  const uploaded = await uploadImagesToImgbb({
    files: input.images,
    env: input.env,
    fetchImpl: input.fetcher
  });

  return padUrlList(uploaded.imageUrls, input.count);
}

function isPackyTransientImageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const match = error.message.match(/^Packy Shopify product image API failed: (\d{3})$/);

  return Boolean(match && Number(match[1]) >= 500);
}

function padUrlList(urls: string[], count: number): string[] {
  if (urls.length === 0) {
    return urls;
  }

  const padded = [...urls];

  while (padded.length < count) {
    padded.push(urls[padded.length % urls.length]);
  }

  return padded.slice(0, count);
}

function normalizeQuality(value?: string): "low" | "medium" | "high" | "auto" {
  if (value === "low" || value === "medium" || value === "high" || value === "auto") {
    return value;
  }

  return "high";
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
