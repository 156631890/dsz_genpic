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

export function buildPackyEditRequest(input: PackyEditInput): PackyEditRequest {
  const baseUrl = trimTrailingSlash(input.baseUrl || "https://www.packyapi.com");
  const prompt = [
    `产品类型：${input.productType}`,
    input.prompt,
    "生成适合独立站商品详情页使用的电商图片，主体清晰，卖点明确，不要出现水印。"
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
    throw new Error("缺少 PACKY_IMAGE_API_KEY 或 PACKY_API_KEY，无法生成图片");
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

  const imageBytes = new Uint8Array(input.image.buffer);

  form.append(
    "image",
    new Blob([imageBytes], {
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
    throw new Error(`Packy 图生图接口失败：${response.status}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const firstImage = data.data?.[0];

  if (firstImage?.url) {
    return { imageUrl: firstImage.url };
  }

  if (firstImage?.b64_json) {
    return { imageUrl: `data:image/png;base64,${firstImage.b64_json}` };
  }

  throw new Error("Packy 图生图接口没有返回图片");
}

export async function generateAmazonMainImagesWithPacky(input: {
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
  count?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrls: string[] }> {
  if (input.images.length === 0) {
    throw new Error("请至少上传一张原始产品图片");
  }

  const env = input.env || process.env;
  const apiKey = env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 PACKY_IMAGE_API_KEY 或 PACKY_API_KEY，无法生成图片");
  }

  const count = clampAmazonImageCount(input.count);
  const request = buildPackyEditRequest({
    baseUrl: env.PACKY_BASE_URL,
    model: env.PACKY_IMAGE_MODEL,
    productType: input.productType,
    prompt: buildAmazonMainImagePrompt(input.sellingPoints),
    count,
    size: env.PACKY_IMAGE_SIZE || "1024x1024",
    quality: normalizeQuality(env.PACKY_IMAGE_QUALITY)
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

  const fetcher = input.fetchImpl || fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Packy 亚马逊主图接口失败：${response.status}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const imageUrls = (data.data || [])
    .map((image) => image.url || imageDataUrl(image.b64_json))
    .filter((url): url is string => Boolean(url));

  if (imageUrls.length === 0) {
    throw new Error("Packy 亚马逊主图接口没有返回图片");
  }

  return { imageUrls };
}

function buildAmazonMainImagePrompt(sellingPoints: string): string {
  return [
    "Generate Amazon main image gallery assets from the uploaded product photos.",
    "Create clean marketplace-ready product images on a pure white background.",
    "Keep the actual product accurate, centered, sharp, fully visible, and occupying most of the frame.",
    "Generate varied main-image angles or compositions suitable for an Amazon product gallery.",
    "Do not add text, logos, watermarks, badges, lifestyle scenes, extra props, mannequins, or unsupported claims.",
    `Selling points for visual emphasis only: ${sellingPoints}`
  ].join("\n");
}

function clampAmazonImageCount(count = 6): number {
  if (!Number.isFinite(count)) return 6;
  return Math.min(6, Math.max(4, Math.round(count)));
}

function imageDataUrl(base64?: string): string | undefined {
  return base64 ? `data:image/png;base64,${base64}` : undefined;
}

function normalizeQuality(value?: string): "low" | "medium" | "high" | "auto" {
  if (value === "low" || value === "medium" || value === "high" || value === "auto") {
    return value;
  }

  return "high";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
