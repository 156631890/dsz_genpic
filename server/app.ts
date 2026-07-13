import cors from "cors";
import express from "express";
import multer from "multer";
import {
  buildAdminProductPayload,
  resolveAdminConfig,
  uploadProduct,
  validateDszProductFields
} from "./services/adminUploader.js";
import { generateDszFieldsWithPacky } from "./services/dszRules.js";
import { uploadImagesToImgbb } from "./services/imageUploader.js";
import {
  PackyImageTransportError,
  generateShopifyProductImagesWithPacky,
  generateImageWithPacky,
  generateProductImageRoleWithPacky,
  PACKY_PRODUCT_IMAGE_ROLE_QUALITY,
  PACKY_PRODUCT_IMAGE_ROLE_SIZE,
  resolvePackyImageConfig
} from "./services/packyImages.js";
import { generateProductCopyWithPacky } from "./services/productCopy.js";
import type { ProductResearchImage } from "./services/productResearch.js";
import {
  PRODUCT_IMAGE_ROLES,
  type DszProductFields,
  type GeneratedProductCopy,
  type GeneratedProductImage,
  type ProductImageRole,
  type ProductGenerationResult,
  type ProductIdentity,
  type ProductInput
} from "../shared/product.js";

export const MAX_SOURCE_IMAGES = 4;
export const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_SOURCE_IMAGES,
    fileSize: MAX_SOURCE_IMAGE_BYTES,
    fields: 4,
    parts: 8
  }
});
const PRODUCT_INPUT_NUMERIC_KEYS: Array<
  "purchasePriceCny" | "packageWeightKg" | "lengthCm" | "widthCm" | "heightCm"
> = [
  "purchasePriceCny",
  "packageWeightKg",
  "lengthCm",
  "widthCm",
  "heightCm"
];

type ProductInputValidation =
  | { valid: true; input: ProductInput }
  | { valid: false; error: string };

interface SafeGenerationError {
  status: number;
  message: string;
}

export interface AppDependencies {
  env?: Record<string, string | undefined>;
  uploadImages?: (files: Express.Multer.File[]) => Promise<{ imageUrls: string[] }>;
  generateProductFields?: (input: {
    productInput: ProductInput;
    images: Express.Multer.File[];
    identity: ProductIdentity;
  }) => Promise<ProductGenerationResult>;
  generateProductCopy?: (
    input: ProductInput
  ) => Promise<GeneratedProductCopy>;
  generateProductImageRole?: (input: {
    role: ProductImageRole;
    images: Express.Multer.File[];
    productType: string;
    sellingPoints: string;
  }) => Promise<GeneratedProductImage>;
  generateImage?: (input: {
    image: Express.Multer.File;
    productType: string;
    prompt: string;
  }) => Promise<{ imageUrl: string }>;
  generateMainImages?: (input: {
    images: Express.Multer.File[];
    productType: string;
    sellingPoints: string;
    count: number;
  }) => Promise<{ imageUrls: string[] }>;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const env = dependencies.env || process.env;

  app.use(cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }

      if (
        isAllowedLoopbackOrigin(origin) ||
        isConfiguredAppOrigin(origin, env.APP_ORIGIN)
      ) {
        callback(null, true);
        return;
      }

      callback(new CorsOriginError());
    }
  }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    const adminConfig = resolveAdminConfig(env);
    const imageConfig = resolvePackyImageConfig(env);
    const sharedPackyConfigured = Boolean(env.PACKY_API_KEY);

    res.json({
      ok: true,
      packyConfigured: Boolean(
        env.PACKY_API_KEY ||
        env.PACKY_FIELD_API_KEY ||
        env.PACKY_TEXT_API_KEY ||
        env.PACKY_IMAGE_API_KEY
      ),
      sharedPackyConfigured,
      textConfigured: Boolean(env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY),
      imageConfigured: Boolean(env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY),
      legacyTextConfigured: Boolean(
        env.PACKY_FIELD_API_KEY || env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY
      ),
      legacyImageConfigured: Boolean(
        env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY
      ),
      textModel: env.PACKY_TEXT_MODEL || "gpt-5.6-sol",
      imageModel: imageConfig.model,
      imageSize: PACKY_PRODUCT_IMAGE_ROLE_SIZE,
      imageQuality: PACKY_PRODUCT_IMAGE_ROLE_QUALITY,
      imageUploadConfigured: Boolean(env.IMGBB_API_KEY),
      githubImageStorageConfigured: Boolean(
        env.GITHUB_IMAGE_TOKEN &&
        env.GITHUB_IMAGE_REPOSITORY &&
        env.GITHUB_IMAGE_BRANCH
      ),
      adminBaseUrl: adminConfig.baseUrl,
      adminMockMode: adminConfig.mockMode
    });
  });

  app.post("/api/generate-product-copy", async (req, res) => {
    try {
      const requestBody: unknown = req.body;
      const validation = parseProductInput(
        isRecord(requestBody) ? requestBody.input : undefined
      );

      if ("error" in validation) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const productInput = validation.input;
      const result = dependencies.generateProductCopy
        ? await dependencies.generateProductCopy(productInput)
        : await generateProductCopyWithPacky({ input: productInput, env });
      const { title, description } = validateGeneratedProductCopy(result);

      res.json({ title, description });
    } catch (error) {
      sendGenerationError(res, error, "copy");
    }
  });

  app.post(
    "/api/generate-product-image-role",
    upload.array("images"),
    async (req, res) => {
      try {
        const files = (req.files || []) as Express.Multer.File[];

        if (files.length === 0) {
          res.status(400).json({
            error: "At least one source image file is required"
          });
          return;
        }

        const role = String(req.body.role || "");

        if (!isProductImageRole(role)) {
          res.status(400).json({ error: "Invalid product image role" });
          return;
        }

        if (files.some((file) => !isSupportedImage(file))) {
          res.status(400).json({ error: "Invalid source image file" });
          return;
        }

        const rawProductType = req.body.productType;

        if (rawProductType !== undefined && typeof rawProductType !== "string") {
          res.status(400).json({ error: "Product type is invalid" });
          return;
        }

        const productType = typeof rawProductType === "string"
          ? rawProductType.trim() || "Product"
          : "Product";

        if (productType.length > 500) {
          res.status(400).json({ error: "Product type is invalid" });
          return;
        }

        const rawSellingPoints = req.body.sellingPoints;

        if (typeof rawSellingPoints !== "string" || !rawSellingPoints.trim()) {
          res.status(400).json({ error: "Selling points are required" });
          return;
        }

        const sellingPoints = rawSellingPoints.trim();

        if (sellingPoints.length > 10000) {
          res.status(400).json({ error: "Selling points are invalid" });
          return;
        }

        const input = {
          role,
          images: files,
          productType,
          sellingPoints
        };
        const result = dependencies.generateProductImageRole
          ? await dependencies.generateProductImageRole(input)
          : await generateProductImageRoleWithPacky({ ...input, env });
        const { role: generatedRole, imageUrl } = validateGeneratedProductImage(
          result,
          role
        );

        res.json({ role: generatedRole, imageUrl });
      } catch (error) {
        sendGenerationError(res, error, "image");
      }
    }
  );

  app.post("/api/upload-images", upload.array("images"), async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];

      if (files.length === 0) {
        res.status(400).json({ error: "At least one image file is required" });
        return;
      }

      if (files.some((file) => !isSupportedImage(file))) {
        res.status(400).json({ error: "Invalid source image file" });
        return;
      }

      const result = dependencies.uploadImages
        ? await dependencies.uploadImages(files)
        : await uploadImagesToImgbb({ files, env });

      res.json(result);
    } catch {
      sendSafeError(res);
    }
  });

  app.post(
    "/api/generate-product-fields",
    upload.array("images", MAX_SOURCE_IMAGES),
    async (req, res) => {
      try {
        const files = (req.files || []) as Express.Multer.File[];
        const productInput = parseMultipartProductInput(req.body.input);
        const identity = parseProductIdentity(req.body.identity);

        if (files.length === 0) {
          res.status(400).json({
            error: "At least one source image file is required"
          });
          return;
        }

        if (files.some((file) => !isSupportedImage(file))) {
          res.status(400).json({ error: "Invalid source image file" });
          return;
        }

        if (files.reduce((total, file) => total + file.size, 0) > 4_000_000) {
          res.status(400).json({ error: "Source image batch is too large" });
          return;
        }

        const result = dependencies.generateProductFields
          ? await dependencies.generateProductFields({
              productInput,
              images: files,
              identity
            })
          : await generateDszFieldsWithPacky({
              productInput,
              images: files.map(toResearchImage),
              identity,
              env
            });

        res.json({ result });
      } catch (error) {
        sendGenerationError(res, error, "fields");
      }
    }
  );

  app.post("/api/generate-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Source image file is required" });
        return;
      }

      if (!isSupportedImage(req.file)) {
        res.status(400).json({ error: "Invalid source image file" });
        return;
      }

      const productType = String(req.body.productType || "");
      const prompt = String(req.body.prompt || "");
      const result = dependencies.generateImage
        ? await dependencies.generateImage({
            image: req.file,
            productType,
            prompt
          })
        : await generateImageWithPacky({
            image: req.file,
            productType,
            prompt,
            env
          });

      res.json(result);
    } catch {
      sendSafeError(res);
    }
  });

  app.post("/api/generate-main-images", upload.array("images"), async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];

      if (files.length === 0) {
        res.status(400).json({ error: "At least one source image file is required" });
        return;
      }

      if (files.some((file) => !isSupportedImage(file))) {
        res.status(400).json({ error: "Invalid source image file" });
        return;
      }

      const productType = String(req.body.productType || "");
      const sellingPoints = String(req.body.sellingPoints || "");
      const count = 5;
      const result = dependencies.generateMainImages
        ? await dependencies.generateMainImages({
            images: files,
            productType,
            sellingPoints,
            count
          })
        : await generateShopifyProductImagesWithPacky({
            images: files,
            productType,
            sellingPoints,
            count,
            env
          });

      res.json(result);
    } catch {
      sendSafeError(res);
    }
  });

  app.post("/api/upload-product", async (req, res) => {
    try {
      const fields = req.body.fields as DszProductFields;
      const payload = buildAdminProductPayload(fields);
      const validation = validateDszProductFields(payload);

      if (!validation.valid) {
        res.status(400).json({ errors: validation.errors });
        return;
      }

      const result = await uploadProduct({ payload, env });

      res.json(result);
    } catch {
      sendSafeError(res);
    }
  });

  app.use((
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    void _next;

    if (error instanceof CorsOriginError) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }

    if (isRecord(error) && error.type === "entity.too.large") {
      res.status(413).json({ error: "JSON body exceeds 2 MiB limit" });
      return;
    }

    if (
      isRecord(error) &&
      (error.type === "entity.parse.failed" ||
        (error instanceof SyntaxError && error.status === 400))
    ) {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Image file exceeds 5 MiB limit" });
        return;
      }

      if (
        error.code === "LIMIT_FILE_COUNT" ||
        error.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        res.status(400).json({ error: "At most 4 source images are allowed" });
        return;
      }

      res.status(400).json({ error: "Invalid multipart upload" });
      return;
    }

    if (req.is("multipart/form-data")) {
      res.status(400).json({ error: "Invalid multipart upload" });
      return;
    }

    if (isRecord(error)) {
      const status = error.status;

      if (typeof status === "number" && status >= 400 && status <= 499) {
        const message = status === 415
          ? "Unsupported request encoding"
          : "Invalid request body";
        res.status(status).json({ error: message });
        return;
      }
    }

    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function sendSafeError(res: express.Response) {
  res.status(500).json({ error: "Internal server error" });
}

class ProductFieldRequestError extends Error {}

function parseMultipartProductInput(value: unknown): ProductInput {
  if (typeof value !== "string") {
    throw new ProductFieldRequestError("Product input is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ProductFieldRequestError("Product input is invalid");
  }

  const validation = parseProductInput(parsed);
  if ("error" in validation) {
    throw new ProductFieldRequestError(validation.error);
  }
  return validation.input;
}

function parseProductIdentity(value: unknown): ProductIdentity {
  if (typeof value !== "string") {
    throw new ProductFieldRequestError("Product identity is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ProductFieldRequestError("Product identity is invalid");
  }

  const skuMatch =
    isRecord(parsed) && typeof parsed.sku === "string"
      ? /^Elosung(\d{5})$/.exec(parsed.sku)
      : null;
  const skuNumber = skuMatch ? Number(skuMatch[1]) : 0;
  if (
    !isRecord(parsed) ||
    typeof parsed.sku !== "string" ||
    typeof parsed.eanCode !== "string" ||
    skuNumber < 10000 ||
    skuNumber > 19999 ||
    !/^\d{10}$/.test(parsed.eanCode)
  ) {
    throw new ProductFieldRequestError("Product identity is invalid");
  }

  return { sku: parsed.sku, eanCode: parsed.eanCode };
}

function toResearchImage(file: Express.Multer.File): ProductResearchImage {
  return {
    mimeType: file.mimetype as ProductResearchImage["mimeType"],
    buffer: file.buffer
  };
}

function parseProductInput(value: unknown): ProductInputValidation {
  if (!isRecord(value)) {
    return { valid: false, error: "Selling points are required" };
  }

  if (typeof value.sellingPoints !== "string" || !value.sellingPoints.trim()) {
    return { valid: false, error: "Selling points are required" };
  }

  const sellingPoints = value.sellingPoints.trim();

  if (sellingPoints.length > 10000) {
    return { valid: false, error: "Selling points are invalid" };
  }

  if (!Array.isArray(value.imageUrls)) {
    return { valid: false, error: "Uploaded image URLs are required" };
  }

  if (
    value.imageUrls.length > 10 ||
    !value.imageUrls.every(isAbsoluteHttpsUrl)
  ) {
    return { valid: false, error: "Uploaded image URLs are invalid" };
  }

  if (
    value.images !== undefined &&
    (!Array.isArray(value.images) ||
      !value.images.every((image) => typeof image === "string"))
  ) {
    return { valid: false, error: "Images are invalid" };
  }

  if (
    value.categoryHint !== undefined &&
    (typeof value.categoryHint !== "string" || value.categoryHint.length > 500)
  ) {
    return { valid: false, error: "Category hint is invalid" };
  }

  if (
    value.categoryId !== undefined &&
    (!Number.isInteger(value.categoryId) || Number(value.categoryId) <= 0)
  ) {
    return { valid: false, error: "Category ID is invalid" };
  }

  if (
    value.categoryName !== undefined &&
    (typeof value.categoryName !== "string" || value.categoryName.length > 500)
  ) {
    return { valid: false, error: "Category name is invalid" };
  }

  if (
    value.colour !== undefined &&
    (typeof value.colour !== "string" || value.colour.length > 100)
  ) {
    return { valid: false, error: "Colour is invalid" };
  }

  const input: ProductInput = {
    sellingPoints,
    imageUrls: value.imageUrls,
    images: Array.isArray(value.images) ? value.images : []
  };

  if (value.categoryHint !== undefined) {
    input.categoryHint = value.categoryHint as string;
  }

  if (value.categoryId !== undefined) {
    input.categoryId = Number(value.categoryId);
  }
  if (value.categoryName !== undefined) {
    input.categoryName = value.categoryName as string;
  }
  if (value.colour !== undefined) {
    input.colour = value.colour as string;
  }

  for (const key of PRODUCT_INPUT_NUMERIC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    const numericValue = value[key];

    if (
      typeof numericValue !== "number" ||
      !Number.isFinite(numericValue) ||
      numericValue < 0
    ) {
      return { valid: false, error: "Product numeric facts are invalid" };
    }

    input[key] = numericValue;
  }

  return { valid: true, input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsoluteHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isConfiguredAppOrigin(
  origin: string,
  configuredOrigin: string | undefined
): boolean {
  if (!configuredOrigin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}

class CorsOriginError extends Error {
  constructor() {
    super("CORS origin denied");
    this.name = "CorsOriginError";
  }
}

function validateGeneratedProductCopy(value: unknown): GeneratedProductCopy {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim()
  ) {
    throw new Error("Invalid copy generation response");
  }

  return { title: value.title, description: value.description };
}

function validateGeneratedProductImage(
  value: unknown,
  requestedRole: ProductImageRole
): GeneratedProductImage {
  if (
    !isRecord(value) ||
    value.role !== requestedRole ||
    !isAbsoluteHttpsUrl(value.imageUrl)
  ) {
    throw new Error("Invalid image generation response");
  }

  return { role: requestedRole, imageUrl: value.imageUrl };
}

function isSupportedImage(file: Express.Multer.File): boolean {
  const buffer = file.buffer;

  if (file.mimetype === "image/png") {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }

  if (file.mimetype === "image/jpeg") {
    return buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (file.mimetype === "image/webp") {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return false;
}

function sendGenerationError(
  res: express.Response,
  error: unknown,
  kind: "copy" | "fields" | "image"
) {
  const safeError = mapGenerationError(error, kind);
  res.status(safeError.status).json({ error: safeError.message });
}

function mapGenerationError(
  error: unknown,
  kind: "copy" | "fields" | "image"
): SafeGenerationError {
  const fallback = { status: 500, message: "Internal server error" };

  if (!(error instanceof Error)) {
    return fallback;
  }

  if (kind === "fields" && error instanceof ProductFieldRequestError) {
    return { status: 400, message: error.message };
  }

  if (kind === "fields" && error instanceof TypeError) {
    return {
      status: 503,
      message: "Packy product field generation unavailable"
    };
  }

  if (
    kind === "fields" &&
    (/^Packy product (research|copy) API /i.test(error.message) ||
      /^Product copy response /i.test(error.message))
  ) {
    const statusMatch = error.message.match(/failed:\s*(\d{3})/);
    const providerStatus = statusMatch ? Number(statusMatch[1]) : 502;
    return {
      status:
        providerStatus === 429
          ? 429
          : providerStatus >= 500
            ? 503
            : 502,
      message: "Packy product field generation failed"
    };
  }

  if (
    error.message === "Invalid copy generation response" ||
    error.message === "Invalid image generation response"
  ) {
    return { status: 502, message: error.message };
  }

  if (kind === "image" && error instanceof PackyImageTransportError) {
    return {
      status: 503,
      message: "Packy image generation unavailable"
    };
  }

  if (kind === "copy" && error instanceof TypeError) {
    return {
      status: 503,
      message: "Packy copy generation unavailable"
    };
  }

  const providerMessage = kind === "copy"
    ? "Packy copy generation failed"
    : kind === "fields"
      ? "Packy product field generation failed"
      : "Packy image generation failed";
  const statusMatch = error.message.match(/Packy .*API failed:\s*(\d{3})/i);

  if (statusMatch) {
    const providerStatus = Number(statusMatch[1]);

    if (providerStatus === 429) {
      return { status: 429, message: providerMessage };
    }

    return {
      status: providerStatus >= 500 ? 503 : 502,
      message: providerMessage
    };
  }

  if (/^Packy image transport failed:/i.test(error.message)) {
    return { status: 503, message: providerMessage };
  }

  if (
    (kind === "copy" &&
      (/^Packy product copy API returned/i.test(error.message) ||
        /^Product copy response /i.test(error.message))) ||
    (kind === "image" &&
      /^Packy .* (returned|delivery failed)/i.test(error.message))
  ) {
    return { status: 502, message: providerMessage };
  }

  return fallback;
}

function isProductImageRole(value: string): value is ProductImageRole {
  return PRODUCT_IMAGE_ROLES.some((role) => role === value);
}
