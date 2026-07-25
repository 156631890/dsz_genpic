import type {
  AmazonMarketAnalysis,
  AmazonMarketAnalysisInput,
  CommerceTraceTaskStatus,
  GeneratedProductCopy,
  GeneratedProductImage,
  ProductImageRole,
  ProductInput,
  DszProductFields,
  NewtonImportedProduct,
  NewtonImportTaskStatus,
  ProductGenerationResult,
  ProductIdentity,
  ProductResearchEvidence,
  ProductSelectionInput,
  ProductSelectionResult,
  ProductSourcingRecommendation,
  ProductSourcingTaskStatus,
  SourcingMatch
} from "../shared/product";
import { AU_ZONE_KEYS } from "../shared/shipping";

const DSZ_ZONE_KEYS = [...AU_ZONE_KEYS, "nz"] as const;
const NEWTON_IMPORT_POLL_INTERVAL_MS = 3_000;
const NEWTON_IMPORT_MAX_POLLS = 120;
const NEWTON_SOURCING_MAX_POLLS = 120;
const MAX_IMPORTED_SOURCE_BYTES = 4_000_000;

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

export async function requestProductSelection(
  input: ProductSelectionInput,
  signal?: AbortSignal
): Promise<ProductSelectionResult> {
  const data = await requestJson("/api/select-products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal
  }, "选品查询失败");
  if (!isRecord(data) || !isProductSelectionResult(data.result)) {
    throw new Error("选品查询失败");
  }
  return data.result;
}

export async function requestProductSourcingRecommendations(
  taskId: string,
  signal?: AbortSignal
): Promise<ProductSourcingRecommendation[]> {
  if (!isSafeTaskId(taskId)) throw new Error("牛顿货源推荐失败");
  for (let poll = 0; poll < NEWTON_SOURCING_MAX_POLLS; poll += 1) {
    const data = await requestJson(
      `/api/newton/sourcing-tasks/${encodeURIComponent(taskId)}`,
      { method: "GET", signal },
      "牛顿货源推荐失败"
    );
    const status = parseProductSourcingTaskStatus(data);
    if (status.status === "complete") return status.recommendations;
    if (status.status === "failed") throw new Error(status.error);
    await abortableDelay(NEWTON_IMPORT_POLL_INTERVAL_MS, signal);
  }
  throw new Error("牛顿货源推荐超时，请重新查询");
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

export async function requestNewtonProductImport(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<NewtonImportedProduct> {
  const created = await requestJson("/api/newton/import-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl }),
    signal
  }, "牛顿商品导入失败");

  if (!isRecord(created) || !isSafeTaskId(created.taskId)) {
    throw new Error("牛顿商品导入失败");
  }

  for (let poll = 0; poll < NEWTON_IMPORT_MAX_POLLS; poll += 1) {
    const data = await requestJson(
      `/api/newton/import-tasks/${encodeURIComponent(created.taskId)}`,
      { method: "GET", signal },
      "牛顿商品导入失败"
    );
    const status = parseNewtonImportTaskStatus(data);

    if (status.status === "complete") return status.product;
    if (status.status === "failed") throw new Error(status.error);
    await abortableDelay(NEWTON_IMPORT_POLL_INTERVAL_MS, signal);
  }

  throw new Error("牛顿商品导入超时，请稍后重试");
}

export async function requestNewtonCommerceTrace(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<SourcingMatch[]> {
  const created = await requestJson("/api/newton/trace-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl }),
    signal
  }, "牛顿电商链接溯源失败");
  if (!isRecord(created) || !isSafeTaskId(created.taskId)) {
    throw new Error("牛顿电商链接溯源失败");
  }

  for (let poll = 0; poll < NEWTON_SOURCING_MAX_POLLS; poll += 1) {
    const data = await requestJson(
      `/api/newton/trace-tasks/${encodeURIComponent(created.taskId)}`,
      { method: "GET", signal },
      "牛顿电商链接溯源失败"
    );
    const status = parseCommerceTraceTaskStatus(data);
    if (status.status === "complete") return status.matches;
    if (status.status === "failed") throw new Error(status.error);
    await abortableDelay(NEWTON_IMPORT_POLL_INTERVAL_MS, signal);
  }
  throw new Error("牛顿电商链接溯源超时，请重新提交");
}

export async function downloadNewtonProductImages(
  product: Pick<NewtonImportedProduct, "offerId" | "imageUrls">,
  signal?: AbortSignal
): Promise<File[]> {
  const downloads = await Promise.allSettled(
    product.imageUrls.slice(0, 4).map(async (imageUrl, index) => {
      const response = await fetch("/api/newton/import-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        let data: unknown;
        try {
          data = text ? JSON.parse(text) : undefined;
        } catch {
          data = undefined;
        }
        throw new Error(responseError(data, "牛顿商品图片下载失败"));
      }

      const contentType = response.headers.get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new Error("牛顿商品图片下载失败");
      }

      const blob = await response.blob();
      if (blob.size === 0 || blob.size > MAX_IMPORTED_SOURCE_BYTES) {
        throw new Error("牛顿商品图片下载失败");
      }
      const extension = contentType === "image/jpeg"
        ? "jpg"
        : contentType === "image/png" ? "png" : "webp";
      return new File(
        [blob],
        `1688-${product.offerId}-${index + 1}.${extension}`,
        { type: contentType }
      );
    })
  );

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const files: File[] = [];
  let totalBytes = 0;
  for (const download of downloads) {
    if (download.status !== "fulfilled") continue;
    if (totalBytes + download.value.size > MAX_IMPORTED_SOURCE_BYTES) continue;
    files.push(download.value);
    totalBytes += download.value.size;
  }
  return files;
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

function parseNewtonImportTaskStatus(value: unknown): NewtonImportTaskStatus {
  if (!isRecord(value)) throw new Error("牛顿商品导入失败");
  if (value.status === "pending") return { status: "pending" };
  if (
    value.status === "failed" &&
    isNonemptyString(value.error) &&
    value.error.length <= 500
  ) {
    return { status: "failed", error: value.error };
  }
  if (value.status === "complete" && isNewtonImportedProduct(value.product)) {
    return { status: "complete", product: value.product };
  }
  throw new Error("牛顿商品导入失败");
}

function parseProductSourcingTaskStatus(
  value: unknown
): ProductSourcingTaskStatus {
  if (!isRecord(value)) throw new Error("牛顿货源推荐失败");
  if (value.status === "pending") return { status: "pending" };
  if (
    value.status === "failed" &&
    isNonemptyString(value.error) &&
    value.error.length <= 500
  ) {
    return { status: "failed", error: value.error };
  }
  if (
    value.status === "complete" &&
    Array.isArray(value.recommendations) &&
    value.recommendations.every(isProductSourcingRecommendation)
  ) {
    return {
      status: "complete",
      recommendations: value.recommendations
    };
  }
  throw new Error("牛顿货源推荐失败");
}

function parseCommerceTraceTaskStatus(value: unknown): CommerceTraceTaskStatus {
  if (!isRecord(value)) throw new Error("牛顿电商链接溯源失败");
  if (value.status === "pending") return { status: "pending" };
  if (
    value.status === "failed" &&
    isNonemptyString(value.error) &&
    value.error.length <= 500
  ) {
    return { status: "failed", error: value.error };
  }
  if (
    value.status === "complete" &&
    Array.isArray(value.matches) &&
    value.matches.every(isSourcingMatch)
  ) {
    return { status: "complete", matches: value.matches };
  }
  throw new Error("牛顿电商链接溯源失败");
}

function isProductSelectionResult(value: unknown): value is ProductSelectionResult {
  if (!isRecord(value) ||
    !isNonemptyString(value.category) ||
    !isNonemptyString(value.generatedAt) ||
    value.amazonMarketplace !== "Amazon Australia" ||
    !isNonemptyString(value.tiktokMarketplace) ||
    !["pending", "unavailable", "error"].includes(String(value.sourcingStatus)) ||
    typeof value.sourcingTaskId !== "string" ||
    !Array.isArray(value.notes) ||
    !value.notes.every((note) => typeof note === "string")) {
    return false;
  }
  return Array.isArray(value.amazon) &&
    value.amazon.every(isProductSelectionCandidate) &&
    Array.isArray(value.tiktok) &&
    value.tiktok.every(isProductSelectionCandidate) &&
    (
      value.sourcingStatus !== "pending" ||
      isSafeTaskId(value.sourcingTaskId)
    );
}

function isProductSelectionCandidate(value: unknown): boolean {
  return isRecord(value) &&
    ["amazon", "tiktok"].includes(String(value.source)) &&
    ["id", "sourceId", "title", "url", "imageUrl", "categoryName", "currency"]
      .every((key) => typeof value[key] === "string") &&
    isHttpsUrl(String(value.url)) &&
    (value.imageUrl === "" || isHttpsUrl(String(value.imageUrl))) &&
    ["price", "rank", "recentSales", "rating"].every((key) =>
      value[key] === null ||
      (typeof value[key] === "number" && Number.isFinite(value[key]))
    );
}

function isProductSourcingRecommendation(value: unknown): boolean {
  return isRecord(value) &&
    isNonemptyString(value.candidateId) &&
    Array.isArray(value.matches) &&
    value.matches.every(isSourcingMatch);
}

function isSourcingMatch(match: unknown): match is SourcingMatch {
  return isRecord(match) &&
    isNonemptyString(match.title) &&
    isHttpsUrl(String(match.url)) &&
    typeof match.imageUrl === "string" &&
    (match.imageUrl === "" || isHttpsUrl(match.imageUrl)) &&
    (
      match.priceCny === null ||
      (typeof match.priceCny === "number" && Number.isFinite(match.priceCny))
    ) &&
    ["high", "medium", "low"].includes(String(match.confidence)) &&
    typeof match.reason === "string";
}

function isNewtonImportedProduct(value: unknown): value is NewtonImportedProduct {
  if (!isRecord(value)) return false;
  const optionalNumbers = [
    "purchasePriceCny",
    "packageWeightKg",
    "lengthCm",
    "widthCm",
    "heightCm"
  ];
  return (
    isSafeTaskId(value.offerId) &&
    [value.sourceUrl, value.title, value.categoryHint, value.sellingPoints]
      .every(isNonemptyString) &&
    (value.colour === undefined || isNonemptyString(value.colour)) &&
    optionalNumbers.every((key) =>
      value[key] === undefined ||
      (
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        Number(value[key]) > 0
      )
    ) &&
    Array.isArray(value.imageUrls) &&
    value.imageUrls.length <= 4 &&
    value.imageUrls.every((url) => typeof url === "string" && isHttpsUrl(url))
  );
}

function isSafeTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
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

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
