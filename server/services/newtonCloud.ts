import { createHmac } from "node:crypto";
import type {
  NewtonImportedProduct,
  NewtonImportTaskStatus
} from "../../shared/product.js";

const NEWTON_API_ORIGIN = "https://gw.open.1688.com";
const NEWTON_API_NAMESPACE = "com.alibaba.agent";
const MAX_IMPORTED_IMAGE_BYTES = 4_000_000;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

interface NewtonConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

interface NewtonImage {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

interface NewtonServiceOptions {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export class NewtonCloudError extends Error {
  constructor(
    public readonly status: number,
    public readonly safeMessage: string
  ) {
    super(safeMessage);
    this.name = "NewtonCloudError";
  }
}

export function newAlibaba1688Signature(
  urlPath: string,
  parameters: Record<string, string>,
  appSecret: string
): string {
  const parameterText = Object.keys(parameters)
    .sort()
    .map((key) => `${key}${parameters[key]}`)
    .join("");

  return createHmac("sha1", appSecret)
    .update(urlPath + parameterText, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function normalize1688ProductUrl(value: unknown): {
  offerId: string;
  sourceUrl: string;
} {
  if (typeof value !== "string" || value.length > 2_000) {
    throw new NewtonCloudError(400, "请输入有效的 1688 商品链接");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new NewtonCloudError(400, "请输入有效的 1688 商品链接");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !isAllowed1688Host(parsed.hostname)
  ) {
    throw new NewtonCloudError(400, "请输入有效的 1688 商品链接");
  }

  const pathMatch = parsed.pathname.match(/\/offer\/(\d{5,20})(?:\.html)?(?:\/|$)/i);
  const queryOfferId = parsed.searchParams.get("offerId");
  const offerId = pathMatch?.[1] ||
    (queryOfferId && /^\d{5,20}$/.test(queryOfferId) ? queryOfferId : "");

  if (!offerId) {
    throw new NewtonCloudError(400, "链接中未找到 1688 商品 ID");
  }

  return {
    offerId,
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`
  };
}

export function validateNewtonImageUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) {
    throw new NewtonCloudError(400, "牛顿商品图片链接无效");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new NewtonCloudError(400, "牛顿商品图片链接无效");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !(
      hostname === "alicdn.com" ||
      hostname.endsWith(".alicdn.com") ||
      hostname === "1688.com" ||
      hostname.endsWith(".1688.com")
    )
  ) {
    throw new NewtonCloudError(400, "牛顿商品图片链接无效");
  }

  return parsed.toString();
}

export async function createNewtonImportTask(options: NewtonServiceOptions & {
  sourceUrl: string;
}): Promise<{ taskId: string }> {
  const normalized = normalize1688ProductUrl(options.sourceUrl);
  const response = await invokeNewtonApi({
    ...options,
    apiName: "newtoncloud.task.create",
    parameters: {
      message: buildNewtonImportPrompt(normalized),
      auto: "true"
    }
  });

  if (
    !isRecord(response) ||
    response.success !== true ||
    !isSafeTaskId(response.taskId)
  ) {
    throw new NewtonCloudError(502, "牛顿任务创建失败");
  }

  return { taskId: response.taskId };
}

export async function getNewtonImportTask(options: NewtonServiceOptions & {
  taskId: string;
}): Promise<NewtonImportTaskStatus> {
  if (!isSafeTaskId(options.taskId)) {
    throw new NewtonCloudError(400, "牛顿任务 ID 无效");
  }

  const response = await invokeNewtonApi({
    ...options,
    apiName: "newtoncloud.task.get",
    parameters: {
      taskId: options.taskId,
      fromIndex: "0",
      includeBlocks: "true"
    }
  });

  if (!isRecord(response) || response.success !== true) {
    throw new NewtonCloudError(502, "牛顿任务查询失败");
  }

  const status = String(response.status || "").toUpperCase();
  if (status === "WAIT_USER") {
    return { status: "failed", error: "牛顿任务需要额外输入，请重新导入" };
  }
  if (status === "KILL") {
    return { status: "failed", error: "牛顿任务未能完成" };
  }
  if (status !== "END") {
    return { status: "pending" };
  }
  if (typeof response.content !== "string") {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }

  return {
    status: "complete",
    product: parseNewtonImportedProduct(response.content)
  };
}

export async function downloadNewtonImage(options: {
  imageUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<NewtonImage> {
  const fetchImpl = options.fetchImpl || fetch;
  let currentUrl = validateNewtonImageUrl(options.imageUrl);

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "DSZ-GenPic/1.0" }
      });
    } catch {
      throw new NewtonCloudError(502, "牛顿商品图片下载失败");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) {
        throw new NewtonCloudError(502, "牛顿商品图片下载失败");
      }
      currentUrl = validateNewtonImageUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new NewtonCloudError(502, "牛顿商品图片下载失败");
    }

    const contentType = response.headers.get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType || !SUPPORTED_IMAGE_TYPES.has(contentType)) {
      throw new NewtonCloudError(400, "牛顿商品图片格式无效");
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMPORTED_IMAGE_BYTES) {
      throw new NewtonCloudError(413, "牛顿商品图片超过 4 MB");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (
      buffer.length === 0 ||
      buffer.length > MAX_IMPORTED_IMAGE_BYTES ||
      !hasImageSignature(buffer, contentType)
    ) {
      throw new NewtonCloudError(
        buffer.length > MAX_IMPORTED_IMAGE_BYTES ? 413 : 400,
        buffer.length > MAX_IMPORTED_IMAGE_BYTES
          ? "牛顿商品图片超过 4 MB"
          : "牛顿商品图片格式无效"
      );
    }

    return {
      buffer,
      contentType: contentType as NewtonImage["contentType"]
    };
  }

  throw new NewtonCloudError(502, "牛顿商品图片下载失败");
}

export function parseNewtonImportedProduct(content: string): NewtonImportedProduct {
  const value = parseNewtonJson(content);
  if (!isRecord(value)) {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }

  let normalized: ReturnType<typeof normalize1688ProductUrl>;
  try {
    normalized = normalize1688ProductUrl(value.sourceUrl);
  } catch {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }
  if (
    typeof value.offerId !== "string" ||
    value.offerId !== normalized.offerId ||
    !isBoundedString(value.title, 1_000) ||
    !isBoundedString(value.categoryHint, 500) ||
    !isBoundedString(value.sellingPoints, 10_000) ||
    !Array.isArray(value.imageUrls)
  ) {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }

  let imageUrls: string[];
  try {
    imageUrls = value.imageUrls
      .slice(0, 4)
      .map((imageUrl) => validateNewtonImageUrl(imageUrl));
  } catch {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }
  const product: NewtonImportedProduct = {
    offerId: value.offerId,
    sourceUrl: normalized.sourceUrl,
    title: value.title.trim(),
    categoryHint: value.categoryHint.trim(),
    sellingPoints: value.sellingPoints.trim(),
    imageUrls
  };

  assignOptionalString(product, "colour", value.colour, 100);
  assignOptionalNumber(product, "purchasePriceCny", value.purchasePriceCny, 1_000_000);
  assignOptionalNumber(product, "packageWeightKg", value.packageWeightKg, 10_000);
  assignOptionalNumber(product, "lengthCm", value.lengthCm, 100_000);
  assignOptionalNumber(product, "widthCm", value.widthCm, 100_000);
  assignOptionalNumber(product, "heightCm", value.heightCm, 100_000);

  return product;
}

async function invokeNewtonApi(options: NewtonServiceOptions & {
  apiName: string;
  parameters: Record<string, string>;
}): Promise<unknown> {
  const config = resolveNewtonConfig(options.env);
  const urlPath =
    `param2/1/${NEWTON_API_NAMESPACE}/${options.apiName}/${config.appKey}`;
  const parameters: Record<string, string> = {
    access_token: config.accessToken,
    ...options.parameters
  };
  parameters._aop_signature = newAlibaba1688Signature(
    urlPath,
    parameters,
    config.appSecret
  );

  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(
      `${NEWTON_API_ORIGIN}/openapi/${urlPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: new URLSearchParams(parameters)
      }
    );
  } catch {
    throw new NewtonCloudError(502, "牛顿云端连接失败");
  }

  if (!response.ok) {
    throw new NewtonCloudError(502, "牛顿云端连接失败");
  }

  try {
    return await response.json();
  } catch {
    throw new NewtonCloudError(502, "牛顿云端响应无效");
  }
}

function resolveNewtonConfig(
  env: Record<string, string | undefined>
): NewtonConfig {
  const appKey = env.NEWTON_APP_KEY?.trim();
  const appSecret = env.NEWTON_APP_SECRET?.trim();
  const accessToken = env.NEWTON_ACCESS_TOKEN?.trim();

  if (!appKey || !appSecret || !accessToken) {
    throw new NewtonCloudError(503, "牛顿云端尚未配置");
  }

  return { appKey, appSecret, accessToken };
}

function buildNewtonImportPrompt(input: {
  offerId: string;
  sourceUrl: string;
}): string {
  return [
    "读取下面指定的 1688 商品详情页，提取可核实的商品资料。",
    `商品链接：${input.sourceUrl}`,
    `offerId：${input.offerId}`,
    "",
    "只返回一个 JSON 对象，不要 Markdown、代码围栏、解释或额外文字。字段必须严格如下：",
    "{",
    `  "offerId": "${input.offerId}",`,
    `  "sourceUrl": "${input.sourceUrl}",`,
    '  "title": "页面上的真实商品标题",',
    '  "categoryHint": "简短、适合商品分类的英文品类名称",',
    '  "sellingPoints": "基于页面事实整理的中文商品资料，包含材质、功能、规格、适用场景和可见包装信息；用换行分隔",',
    '  "purchasePriceCny": 采购 100 件适用的单件人民币价格数字或 null,',
    '  "colour": "页面可核实的颜色，多个颜色用 / 分隔，无法确认则 null",',
    '  "packageWeightKg": 包装重量公斤数字或 null,',
    '  "lengthCm": 包装长度厘米数字或 null,',
    '  "widthCm": 包装宽度厘米数字或 null,',
    '  "heightCm": 包装高度厘米数字或 null,',
    '  "imageUrls": ["最多 4 个页面真实商品原图 HTTPS 链接"]',
    "}",
    "",
    "禁止推测、换算缺失的重量尺寸或编造字段；页面无法确认的可选字段必须返回 null，图片无法确认则返回空数组。不要暂停询问。"
  ].join("\n");
}

function parseNewtonJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
      .map((match) => match[1].trim())
      .reverse()
  ];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded candidate.
    }
  }

  throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
}

function assignOptionalString(
  target: NewtonImportedProduct,
  key: "colour",
  value: unknown,
  maxLength: number
) {
  if (value === null || value === undefined || value === "") return;
  if (!isBoundedString(value, maxLength)) {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }
  target[key] = value.trim();
}

function assignOptionalNumber(
  target: NewtonImportedProduct,
  key: "purchasePriceCny" | "packageWeightKg" | "lengthCm" | "widthCm" | "heightCm",
  value: unknown,
  maximum: number
) {
  if (value === null || value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new NewtonCloudError(502, "牛顿返回的商品资料无效");
  }
  target[key] = value;
}

function isAllowed1688Host(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "1688.com" || normalized.endsWith(".1688.com");
}

function isSafeTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasImageSignature(buffer: Buffer, contentType: string): boolean {
  if (contentType === "image/png") {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (contentType === "image/jpeg") {
    return buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  }
  return buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
}
