import type {
  AdminProductPayload,
  DszProductFields,
  ValidationResult
} from "../../shared/product.js";

const DEFAULT_ADMIN_BASE_URL =
  "https://services.dropshipzone.com.au/admin/api/supplier/v1";

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
  fields: DszProductFields
): ValidationResult {
  const errors: string[] = [];

  if (!fields.product_name.trim()) errors.push("Product name is required");
  if (!fields.sku.trim()) errors.push("SKU is required");
  if (!fields.categories.trim()) errors.push("Categories must be a string");
  if (!fields.description.trim()) errors.push("Description is required");
  if (fields.images.length < 4) errors.push("Images must contain at least 4 URLs");
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
    ...fields,
    category: Number(fields.category),
    categories: String(fields.categories),
    ean_code: String(fields.ean_code),
    sku: fields.sku.replace(/[^A-Za-z0-9]/g, ""),
    brand_name: fields.brand_name || "Elosung",
    rrp: Number(fields.rrp),
    weight: Number(fields.weight),
    length: Number(fields.length),
    width: Number(fields.width),
    height: Number(fields.height),
    stock: Number(fields.stock),
    status: Number(fields.status || 1)
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
  let response = await postProducts({
    config,
    fetcher,
    requestBody,
    token
  });

  if (response.status === 401 && config.authCredentials) {
    const refreshedToken = await authenticateWithCredentials(config, fetcher);
    response = await postProducts({
      config,
      fetcher,
      requestBody,
      token: refreshedToken
    });
  }

  const responseBody = await readJsonSafely(response);

  if (!response.ok) {
    throw new Error(`Dropshipzone upload failed: ${response.status}`);
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
    throw new Error(`Dropshipzone auth failed: ${response.status}`);
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

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
