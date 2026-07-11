export interface ProductDraft {
  sku: string;
  productType: string;
  material: string;
  colors: string;
  sizes: string;
  packaging: string;
  weight: string;
  cartonSpec: string;
  sellingPoints: string;
  imageUrls: string[];
  title?: string;
}

export interface GeneratedCopy {
  title: string;
  bullets: string[];
  description: string;
}

export interface ProductInput {
  sellingPoints: string;
  categoryHint?: string;
  images: string[];
  imageUrls: string[];
  purchasePriceCny?: number;
  packageWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface GeneratedProductCopy {
  title: string;
  description: string;
}

export const PRODUCT_IMAGE_ROLES = [
  "main",
  "side",
  "detail",
  "lifestyle_1",
  "lifestyle_2"
] as const;

export type ProductImageRole = (typeof PRODUCT_IMAGE_ROLES)[number];

export interface GeneratedProductImage {
  role: ProductImageRole;
  imageUrl: string;
}

export interface DszProductFields {
  category: number;
  categories: string;
  categoryName: string;
  product_name: string;
  sku: string;
  status: number;
  ean_code: string;
  stock: number;
  weight: number;
  length: number;
  width: number;
  height: number;
  cbm: number;
  brand_name: string;
  colour: string;
  enabled: boolean;
  description: string;
  vendor_price: number;
  rrp: number;
  zone_rates: Record<string, number>;
  images: string[];
  risk_flags: string[];
  review_notes: string[];
}

export interface AdminProductPayload
  extends Pick<
    DszProductFields,
    | "categories"
    | "sku"
    | "status"
    | "ean_code"
    | "stock"
    | "weight"
    | "length"
    | "width"
    | "height"
    | "cbm"
    | "brand_name"
    | "colour"
    | "description"
    | "rrp"
    | "zone_rates"
    | "images"
  > {
  name: string;
  price: number;
}

export interface ProductGenerationResult {
  fields: DszProductFields;
  source: "ai" | "fallback";
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
