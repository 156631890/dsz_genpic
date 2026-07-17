import type {
  AmazonMarketAnalysis,
  AmazonMarketAnalysisInput,
  GeneratedProductCopy,
  GeneratedProductImage,
  ProductImageRole,
  ProductInput,
  DszProductFields,
  ProductGenerationResult,
  ProductIdentity,
  ProductResearchEvidence
} from "../shared/product";
import { AU_ZONE_KEYS } from "../shared/shipping";

const DSZ_ZONE_KEYS = [...AU_ZONE_KEYS, "nz"] as const;

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

export async function requestAmazonMarketAnalysis(
  input: AmazonMarketAnalysisInput,
  signal?: AbortSignal
): Promise<AmazonMarketAnalysis> {
  const data = await requestJson("/api/analyze-amazon-market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal
  }, "Amazon Australia market analysis failed");
  if (!isRecord(data) || !isAmazonMarketAnalysis(data.analysis)) {
    throw new Error("Amazon Australia market analysis failed");
  }
  return data.analysis;
}

export async function requestProductFields(input: {
  input: ProductInput;
  files: File[];
  identity: ProductIdentity;
}, signal?: AbortSignal): Promise<ProductGenerationResult> {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("input", JSON.stringify(input.input));
  form.append("identity", JSON.stringify(input.identity));

  const data = await requestJson("/api/generate-product-fields", {
    method: "POST",
    body: form,
    signal
  }, "完整商品资料生成失败");

  if (!isRecord(data) || !isProductGenerationResult(data.result)) {
    throw new Error("完整商品资料生成失败");
  }
  return toPublicGenerationResult(data.result);
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductGenerationResult(
  value: unknown
): value is ProductGenerationResult {
  if (
    !isRecord(value) ||
    !isDszProductFields(value.fields) ||
    value.source !== "ai"
  ) {
    return false;
  }
  if (
    value.issues !== undefined &&
    (!Array.isArray(value.issues) || !value.issues.every(isNonemptyString))
  ) {
    return false;
  }
  return value.evidence === undefined || isResearchEvidence(value.evidence);
}

function isDszProductFields(value: unknown): value is DszProductFields {
  if (!isRecord(value) || !isRecord(value.zone_rates)) return false;

  const zoneRates = value.zone_rates;
  const strings = [
    "categories",
    "categoryName",
    "product_name",
    "sku",
    "ean_code",
    "brand_name",
    "colour",
    "description"
  ];
  const numbers = [
    "category",
    "status",
    "stock",
    "weight",
    "length",
    "width",
    "height",
    "cbm",
    "vendor_price",
    "rrp"
  ];

  return (
    strings.every((key) => typeof value[key] === "string") &&
    numbers.every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        Number(value[key]) >= 0
    ) &&
    Number.isInteger(Number(value.category)) &&
    value.status === 1 &&
    value.stock === 1000 &&
    (value.category === 0
      ? value.categories === "" && value.categoryName === ""
      : value.categories === String(value.category) &&
        isNonemptyString(value.categoryName)) &&
    /^Elosung1\d{4}$/.test(value.sku as string) &&
    /^\d{10}$/.test(value.ean_code as string) &&
    value.brand_name === "Elosung" &&
    value.enabled === true &&
    DSZ_ZONE_KEYS.every(
      (key) =>
        typeof zoneRates[key] === "number" &&
        Number.isFinite(zoneRates[key])
    ) &&
    Array.isArray(value.images) &&
    value.images.every((url) => typeof url === "string") &&
    Array.isArray(value.risk_flags) &&
    value.risk_flags.every(isNonemptyString) &&
    Array.isArray(value.review_notes) &&
    value.review_notes.every(isNonemptyString)
  );
}

function isResearchEvidence(value: unknown): value is ProductResearchEvidence {
  return (
    isRecord(value) &&
    typeof value.productType === "string" &&
    typeof value.variant === "string" &&
    typeof value.matchSummary === "string" &&
    ["high", "medium", "low"].includes(String(value.confidence)) &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        isRecord(source) &&
        isHttpsUrl(String(source.url)) &&
        [source.title, source.matchedVariant, source.evidence].every(
          (item) => typeof item === "string"
        )
    )
  );
}

function isAmazonMarketAnalysis(value: unknown): value is AmazonMarketAnalysis {
  if (!isRecord(value) || value.source !== "proboost-amazon-au" ||
    value.marketplace !== "Amazon Australia" ||
    !["high", "medium", "low"].includes(String(value.confidence)) ||
    ![
      "strong_advantage",
      "moderate_advantage",
      "market_aligned",
      "above_market",
      "unavailable"
    ].includes(String(value.pricePosition))) {
    return false;
  }
  const strings = ["query", "analyzedAt", "categoryName", "categoryPath"];
  const numbers = ["currentRrpAud", "competitorCount", "sampledMonthlySales"];
  const nullableNumbers = [
    "priceMinimumAud",
    "priceMedianAud",
    "priceMaximumAud",
    "priceAdvantagePercent",
    "suggestedRrpMinimumAud",
    "suggestedRrpMaximumAud"
  ];
  return strings.every((key) => typeof value[key] === "string") &&
    numbers.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
    nullableNumbers.every((key) => value[key] === null ||
      (typeof value[key] === "number" && Number.isFinite(value[key]))) &&
    (value.snapshotDate === null || typeof value.snapshotDate === "string") &&
    Array.isArray(value.notes) && value.notes.every((note) => typeof note === "string") &&
    Array.isArray(value.competitors) && value.competitors.every((competitor) =>
      isRecord(competitor) &&
      ["asin", "title", "url", "imageUrl", "brand", "categoryName"].every(
        (key) => typeof competitor[key] === "string"
      ) &&
      isHttpsUrl(String(competitor.url)) &&
      (competitor.imageUrl === "" || isHttpsUrl(String(competitor.imageUrl))) &&
      typeof competitor.priceAud === "number" && Number.isFinite(competitor.priceAud) &&
      ["rating", "reviews", "monthlySales"].every((key) =>
        competitor[key] === null ||
        (typeof competitor[key] === "number" && Number.isFinite(competitor[key]))
      )
    ) &&
    Array.isArray(value.priceBands) && value.priceBands.every((band) =>
      isRecord(band) && typeof band.label === "string" &&
      ["productCount", "monthlySales", "revenueAud", "salesShare"].every(
        (key) => typeof band[key] === "number" && Number.isFinite(band[key])
      )
    );
}

function toPublicGenerationResult(
  value: ProductGenerationResult
): ProductGenerationResult {
  const sourceFields = value.fields;
  const fields: DszProductFields = {
    category: sourceFields.category,
    categories: sourceFields.categories,
    categoryName: sourceFields.categoryName,
    product_name: sourceFields.product_name,
    sku: sourceFields.sku,
    status: sourceFields.status,
    ean_code: sourceFields.ean_code,
    stock: sourceFields.stock,
    weight: sourceFields.weight,
    length: sourceFields.length,
    width: sourceFields.width,
    height: sourceFields.height,
    cbm: sourceFields.cbm,
    brand_name: sourceFields.brand_name,
    colour: sourceFields.colour,
    enabled: sourceFields.enabled,
    description: sourceFields.description,
    vendor_price: sourceFields.vendor_price,
    rrp: sourceFields.rrp,
    zone_rates: Object.fromEntries(
      DSZ_ZONE_KEYS.map((key) => [key, sourceFields.zone_rates[key]])
    ),
    images: [...sourceFields.images],
    risk_flags: [...sourceFields.risk_flags],
    review_notes: [...sourceFields.review_notes]
  };

  return {
    fields,
    source: "ai",
    ...(value.evidence ? {
      evidence: {
        productType: value.evidence.productType,
        variant: value.evidence.variant,
        matchSummary: value.evidence.matchSummary,
        confidence: value.evidence.confidence,
        sources: value.evidence.sources.map((source) => ({
          url: source.url,
          title: source.title,
          matchedVariant: source.matchedVariant,
          evidence: source.evidence
        }))
      }
    } : {}),
    ...(value.issues ? { issues: [...value.issues] } : {})
  };
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
