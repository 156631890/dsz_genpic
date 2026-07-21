import type {
  AdminProductPayload,
  DszProductFields,
  ValidationResult
} from "../../shared/product.js";
import { hasInvalidDescriptionLineBreak } from "../../shared/description.js";
import {
  AU_ZONE_KEYS,
  buildShippingZoneRates
} from "../../shared/shipping.js";

const DEFAULT_ADMIN_BASE_URL =
  "https://services.dropshipzone.com.au/admin/api/supplier/v1";
const MINIMUM_IMAGE_COUNT = 5;
const DEFAULT_UPLOAD_MAX_ATTEMPTS = 3;
const DEFAULT_UPLOAD_RETRY_DELAY_MS = 500;
const LEGACY_CATEGORY_ID_MAP: Record<string, string> = {
  "7000": "916",
  "7001": "917",
  "7002": "918",
  "7003": "919",
  "7004": "920",
  "7005": "921",
  "7006": "922",
  "7007": "923",
  "7008": "924",
  "7009": "925",
  "7010": "926",
  "7011": "927",
  "7012": "928",
  "7013": "929",
  "7014": "930",
  "7015": "931",
  "7016": "932",
  "7017": "933",
  "7018": "934",
  "7019": "935",
  "7020": "936",
  "7021": "937",
  "7022": "961",
  "7023": "938",
  "7024": "939",
  "7025": "940",
  "7026": "941",
  "7027": "942",
  "7028": "943",
  "7029": "944",
  "7030": "945",
  "7031": "946",
  "7032": "947",
  "7033": "948",
  "7034": "949",
  "7035": "950",
  "7036": "951",
  "7037": "952",
  "7038": "953",
  "7039": "954",
  "7040": "955",
  "7041": "956",
  "7042": "957",
  "7043": "958",
  "7044": "959",
  "7045": "960"
};
export interface AdminConfig {
  baseUrl: string;
  authUrl: string;
  productUploadUrl: string;
  headers: Record<string, string>;
  authScheme: string;
  mockMode: boolean;
  token?: string;
  authCredentials?: {
    email: string;
    password: string;
  };
}

interface UploadRetryOptions {
  maxAttempts: number;
  delayMs: number;
}

export function resolveAdminConfig(
  env: Record<string, string | undefined>
): AdminConfig {
  const baseUrl = trimTrailingSlash(
    env.ADMIN_API_BASE_URL || DEFAULT_ADMIN_BASE_URL
  );
  const productPath = env.ADMIN_PRODUCT_UPLOAD_PATH || "/products";
  const authPath = env.ADMIN_AUTH_PATH || "/auth";
  const token =
    env.ADMIN_API_TOKEN || env.DROPSHIPZONE_API_TOKEN || env.DSZ_API_TOKEN;
  const email =
    env.ADMIN_API_EMAIL || env.DROPSHIPZONE_API_EMAIL || env.DSZ_API_EMAIL;
  const password =
    env.ADMIN_API_PASSWORD ||
    env.DROPSHIPZONE_API_PASSWORD ||
    env.DSZ_API_PASSWORD;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `${env.ADMIN_AUTH_SCHEME || "jwt"} ${token}`;
  }

  if (env.ADMIN_API_KEY) {
    headers[env.ADMIN_API_KEY_HEADER || "X-API-Key"] = env.ADMIN_API_KEY;
  }

  return {
    baseUrl,
    authUrl: joinUrl(baseUrl, authPath),
    productUploadUrl: joinUrl(baseUrl, productPath),
    headers,
    authScheme: env.ADMIN_AUTH_SCHEME || "jwt",
    mockMode: !token && !(email && password),
    token,
    authCredentials:
      email && password
        ? {
            email,
            password
          }
        : undefined
  };
}

export function validateDszProductFields(
  fields: AdminProductPayload
): ValidationResult {
  const errors: string[] = [];

  if (!fields.name.trim()) errors.push("Product name is required");
  if (fields.name.length > 200) errors.push("Product name must be 200 characters or less");
  if (!fields.sku.trim()) errors.push("SKU is required");
  if (!/^Elosung\d{5}$/.test(fields.sku)) errors.push("SKU must use the Elosung numeric format");
  if (
    !/^\d+$/.test(fields.categories.trim()) ||
    Number(fields.categories) <= 0
  ) {
    errors.push("Categories must be one sub-subcategory ID string");
  }
  if (!/^\d{10}$/.test(fields.ean_code)) {
    errors.push("EAN code must be a 10 digit string");
  }
  if (!Number.isInteger(fields.stock) || fields.stock <= 0) {
    errors.push("Stock must be a positive integer");
  }
  if (![0, 1].includes(fields.status)) {
    errors.push("Status must be 0 or 1");
  }
  if (fields.brand_name !== "Elosung") errors.push("Brand name must be Elosung");
  if (!fields.colour.trim()) errors.push("Colour is required");
  if (!fields.description.trim()) errors.push("Description is required");
  if (hasInvalidDescriptionLineBreak(fields.description)) {
    errors.push("Description line breaks must separate top-level HTML blocks");
  }
  if (/https?:\/\//i.test(fields.description)) {
    errors.push("Description must not contain URLs");
  }
  if (
    !fields.description.includes("Returns, Refunds and Replacements") ||
    !fields.description.includes("Delivery Timeframe")
  ) {
    errors.push("Description must include the required ACL and delivery footer");
  }
  if (!Number.isFinite(fields.price) || fields.price <= 0) {
    errors.push("Price must be greater than 0");
  }
  if (!Number.isFinite(fields.rrp) || fields.rrp < fields.price) {
    errors.push("RRP must be greater than or equal to price");
  }
  if (!Number.isFinite(fields.weight) || fields.weight <= 0) {
    errors.push("Weight must be greater than 0");
  }
  if (
    !Number.isFinite(fields.length) ||
    !Number.isFinite(fields.width) ||
    !Number.isFinite(fields.height) ||
    fields.length <= 0 ||
    fields.width <= 0 ||
    fields.height <= 0
  ) {
    errors.push("Length, width and height must be greater than 0");
  }
  if (!Number.isFinite(fields.cbm) || fields.cbm <= 0) {
    errors.push("CBM must be greater than 0");
  }
  if (!hasRequiredZoneRates(fields.zone_rates, fields)) {
    errors.push("zone_rates must include all required shipping zones");
  }
  if (fields.images.length < MINIMUM_IMAGE_COUNT) {
    errors.push(`Images must contain at least ${MINIMUM_IMAGE_COUNT} URLs`);
  }
  if (!fields.images.every((url) => /^https:\/\//.test(url))) {
    errors.push("Images must be HTTPS URLs");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function buildAdminProductPayload(
  fields: DszProductFields
): AdminProductPayload {
  return {
    categories: normalizeCategoryId(fields.categories || fields.category),
    name: fields.product_name,
    ean_code: String(fields.ean_code),
    sku: fields.sku.replace(/[^A-Za-z0-9]/g, ""),
    brand_name: fields.brand_name || "Elosung",
    colour: fields.colour,
    description: fields.description,
    price: Number(fields.vendor_price),
    rrp: Number(fields.rrp),
    zone_rates: expectedZoneRates(fields),
    weight: Number(fields.weight),
    length: Number(fields.length),
    width: Number(fields.width),
    height: Number(fields.height),
    cbm: Number(fields.cbm),
    stock: Number(fields.stock),
    status: Number(fields.status ?? 1),
    images: padImageUrls(fields.images)
  };
}

export function buildAdminRequestBody(payload: AdminProductPayload): {
  products: AdminProductPayload[];
} {
  return {
    products: [payload]
  };
}

export async function uploadProduct(input: {
  payload: AdminProductPayload;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{
  mode: "mock" | "live";
  payload: AdminProductPayload;
  requestBody: { products: AdminProductPayload[] };
  response: unknown;
}> {
  const config = resolveAdminConfig(input.env || process.env);
  const requestBody = buildAdminRequestBody(input.payload);
  const fetcher = input.fetchImpl || fetch;
  const retryOptions = resolveUploadRetryOptions(input.env || process.env);

  if (config.mockMode) {
    return {
      mode: "mock",
      payload: input.payload,
      requestBody,
      response: {
        message: "Admin token is missing. Returning the request body without live upload."
      }
    };
  }

  const token =
    config.token || (await authenticateWithCredentials(config, fetcher));
  let response = await postProductsWithRetry({
    config,
    fetcher,
    requestBody,
    token,
    retryOptions
  });

  if (response.status === 401 && config.authCredentials) {
    const refreshedToken = await authenticateWithCredentials(config, fetcher);
    response = await postProductsWithRetry({
      config,
      fetcher,
      requestBody,
      token: refreshedToken,
      retryOptions
    });
  }

  const responseBody = await readJsonSafely(response);

  if (!response.ok) {
    throw new Error(
      formatAdminApiError("Dropshipzone upload failed", response.status, responseBody)
    );
  }

  return {
    mode: "live",
    payload: input.payload,
    requestBody,
    response: responseBody
  };
}

async function authenticateWithCredentials(
  config: AdminConfig,
  fetcher: typeof fetch
): Promise<string> {
  if (!config.authCredentials) {
    throw new Error("Dropshipzone admin token or auth credentials are required");
  }

  const response = await fetcher(config.authUrl, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(config.authCredentials)
  });
  const responseBody = await readJsonSafely(response);

  if (!response.ok) {
    throw new Error(
      formatAdminApiError("Dropshipzone auth failed", response.status, responseBody)
    );
  }

  const token = extractToken(responseBody);

  if (!token) {
    throw new Error("Dropshipzone auth response did not include a token");
  }

  return token;
}

async function postProducts(input: {
  config: AdminConfig;
  fetcher: typeof fetch;
  requestBody: { products: AdminProductPayload[] };
  token: string;
}): Promise<Response> {
  return input.fetcher(input.config.productUploadUrl, {
    method: "POST",
    headers: {
      ...input.config.headers,
      Authorization: `${input.config.authScheme} ${input.token}`
    },
    body: JSON.stringify(input.requestBody)
  });
}

async function postProductsWithRetry(input: {
  config: AdminConfig;
  fetcher: typeof fetch;
  requestBody: { products: AdminProductPayload[] };
  token: string;
  retryOptions: UploadRetryOptions;
}): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= input.retryOptions.maxAttempts; attempt += 1) {
    try {
      const response = await postProducts(input);

      if (!isTransientUploadStatus(response.status) || attempt === input.retryOptions.maxAttempts) {
        return response;
      }

      lastResponse = response;
    } catch (error) {
      if (attempt === input.retryOptions.maxAttempts) {
        throw error;
      }
    }

    await delay(input.retryOptions.delayMs);
  }

  return lastResponse || postProducts(input);
}

function authHeaders(config: AdminConfig): Record<string, string> {
  const headers = { ...config.headers };
  delete headers.Authorization;
  return headers;
}

function extractToken(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== "object") return undefined;

  const body = responseBody as {
    token?: unknown;
    data?: {
      token?: unknown;
    };
  };

  if (typeof body.token === "string") return body.token;
  if (typeof body.data?.token === "string") return body.data.token;

  return undefined;
}

function resolveUploadRetryOptions(
  env: Record<string, string | undefined>
): UploadRetryOptions {
  return {
    maxAttempts: positiveInteger(
      env.ADMIN_UPLOAD_MAX_ATTEMPTS,
      DEFAULT_UPLOAD_MAX_ATTEMPTS
    ),
    delayMs: nonNegativeInteger(
      env.ADMIN_UPLOAD_RETRY_DELAY_MS,
      DEFAULT_UPLOAD_RETRY_DELAY_MS
    )
  };
}

function isTransientUploadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function expectedZoneRates(
  fields: Pick<DszProductFields, "weight" | "length" | "width" | "height">
): Record<string, number> {
  return buildShippingZoneRates({
    actualWeightKg: Number(fields.weight),
    lengthCm: Number(fields.length),
    widthCm: Number(fields.width),
    heightCm: Number(fields.height)
  });
}

function normalizeCategoryId(value: string | number): string {
  const id = String(value).trim();
  return LEGACY_CATEGORY_ID_MAP[id] || id;
}

function hasRequiredZoneRates(
  zoneRates: Record<string, number>,
  fields: Pick<AdminProductPayload, "weight" | "length" | "width" | "height">
): boolean {
  let expected: Record<string, number>;

  try {
    expected = expectedZoneRates(fields);
  } catch {
    return false;
  }

  return [...AU_ZONE_KEYS, "nz"].every(
    (key) => zoneRates[key] === expected[key]
  );
}

function formatAdminApiError(
  prefix: string,
  status: number,
  responseBody: unknown
): string {
  const details = summarizeResponseBody(responseBody);

  return details ? `${prefix}: ${status} - ${details}` : `${prefix}: ${status}`;
}

function summarizeResponseBody(responseBody: unknown): string {
  if (responseBody === null || responseBody === undefined) return "";
  if (typeof responseBody === "string") return truncate(responseBody.trim());

  if (typeof responseBody === "object") {
    const body = responseBody as {
      message?: unknown;
      error?: unknown;
      errors?: unknown;
    };
    const parts = [body.message, body.error, body.errors]
      .filter((part) => part !== undefined && part !== null)
      .map((part) =>
        typeof part === "string" ? part : safeStringify(part)
      )
      .filter((part) => part.trim().length > 0);

    if (parts.length > 0) return truncate(parts.join(" | "));
  }

  return truncate(safeStringify(responseBody));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, ms);
      })
    : Promise.resolve();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  return `${trimTrailingSlash(baseUrl)}/${trimLeadingSlash(path)}`;
}

function padImageUrls(images: string[]): string[] {
  if (images.length === 0 || images.length >= MINIMUM_IMAGE_COUNT) {
    return images;
  }

  const padded = [...images];

  while (padded.length < MINIMUM_IMAGE_COUNT) {
    padded.push(images[padded.length % images.length]);
  }

  return padded;
}
