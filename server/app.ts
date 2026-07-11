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
  generateShopifyProductImagesWithPacky,
  generateImageWithPacky,
  generateProductImageRoleWithPacky,
  resolvePackyImageConfig
} from "./services/packyImages.js";
import { generateProductCopyWithPacky } from "./services/productCopy.js";
import {
  PRODUCT_IMAGE_ROLES,
  type DszProductFields,
  type GeneratedProductCopy,
  type GeneratedProductImage,
  type ProductImageRole,
  type ProductGenerationResult,
  type ProductInput
} from "../shared/product.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 8 * 1024 * 1024,
    fields: 10,
    parts: 20
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
  generateProductFields?: (
    input: ProductInput
  ) => Promise<ProductGenerationResult>;
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

  app.use(cors());
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
      textConfigured: sharedPackyConfigured,
      imageConfigured: sharedPackyConfigured,
      legacyTextConfigured: Boolean(
        env.PACKY_FIELD_API_KEY || env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY
      ),
      legacyImageConfigured: Boolean(
        env.PACKY_IMAGE_API_KEY || env.PACKY_API_KEY
      ),
      textModel: env.PACKY_TEXT_MODEL || "gpt-5.6-sol",
      imageModel: imageConfig.model,
      imageSize: imageConfig.size,
      imageQuality: imageConfig.quality,
      imageUploadConfigured: Boolean(env.IMGBB_API_KEY),
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

      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const productInput = validation.input;
      const result = dependencies.generateProductCopy
        ? await dependencies.generateProductCopy(productInput)
        : await generateProductCopyWithPacky({ ...productInput, env });

      res.json(result);
    } catch (error) {
      sendGenerationError(res, error, "copy");
    }
  });

  app.post(
    "/api/generate-product-image-role",
    upload.array("images", 10),
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

        res.json(result);
      } catch (error) {
        sendGenerationError(res, error, "image");
      }
    }
  );

  app.post("/api/upload-images", upload.array("images", 10), async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];

      if (files.length === 0) {
        res.status(400).json({ error: "At least one image file is required" });
        return;
      }

      const result = dependencies.uploadImages
        ? await dependencies.uploadImages(files)
        : await uploadImagesToImgbb({ files, env });

      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/generate-product-fields", async (req, res) => {
    try {
      const productInput = req.body.input as ProductInput;

      if (!productInput?.sellingPoints?.trim()) {
        res.status(400).json({ error: "Selling points are required" });
        return;
      }

      if (
        !Array.isArray(productInput.imageUrls) ||
        productInput.imageUrls.length === 0
      ) {
        res.status(400).json({ error: "Uploaded image URLs are required" });
        return;
      }

      const result = dependencies.generateProductFields
        ? await dependencies.generateProductFields(productInput)
        : await generateDszFieldsWithPacky({ productInput, env });

      res.json({ result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/generate-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Source image file is required" });
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
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/generate-main-images", upload.array("images", 10), async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];

      if (files.length === 0) {
        res.status(400).json({ error: "At least one source image file is required" });
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
    } catch (error) {
      sendError(res, error);
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
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use((
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
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

    if (!(error instanceof multer.MulterError)) {
      next(error);
      return;
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Image file exceeds 8 MiB limit" });
      return;
    }

    res.status(400).json({ error: "Invalid multipart upload" });
  });

  return app;
}

function sendError(res: express.Response, error: unknown, secret?: string) {
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = secret
    ? rawMessage.split(secret).join("[REDACTED]")
    : rawMessage;
  res.status(500).json({ error: message });
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

  if (!Array.isArray(value.imageUrls) || value.imageUrls.length === 0) {
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

  const input: ProductInput = {
    sellingPoints,
    imageUrls: value.imageUrls,
    images: value.images || []
  };

  if (value.categoryHint !== undefined) {
    input.categoryHint = value.categoryHint as string;
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
  kind: "copy" | "image"
) {
  const safeError = mapGenerationError(error, kind);
  res.status(safeError.status).json({ error: safeError.message });
}

function mapGenerationError(
  error: unknown,
  kind: "copy" | "image"
): SafeGenerationError {
  const fallback = { status: 500, message: "Internal server error" };

  if (!(error instanceof Error)) {
    return fallback;
  }

  const providerMessage = kind === "copy"
    ? "Packy copy generation failed"
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
