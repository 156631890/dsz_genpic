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
  generateImageWithPacky
} from "./services/packyImages.js";
import type {
  DszProductFields,
  ProductGenerationResult,
  ProductInput
} from "../shared/product.js";

const upload = multer({ storage: multer.memoryStorage() });

export interface AppDependencies {
  env?: Record<string, string | undefined>;
  uploadImages?: (files: Express.Multer.File[]) => Promise<{ imageUrls: string[] }>;
  generateProductFields?: (
    input: ProductInput
  ) => Promise<ProductGenerationResult>;
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

    res.json({
      ok: true,
      packyConfigured: Boolean(
        env.PACKY_API_KEY || env.PACKY_FIELD_API_KEY || env.PACKY_IMAGE_API_KEY
      ),
      imageUploadConfigured: Boolean(env.IMGBB_API_KEY),
      adminBaseUrl: adminConfig.baseUrl,
      adminMockMode: adminConfig.mockMode
    });
  });

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

  return app;
}

function sendError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
}
