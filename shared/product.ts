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
  categoryId?: number;
  categoryName?: string;
  colour?: string;
  images: string[];
  imageUrls: string[];
  purchasePriceCny?: number;
  packageWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface NewtonImportedProduct {
  offerId: string;
  sourceUrl: string;
  title: string;
  categoryHint: string;
  sellingPoints: string;
  purchasePriceCny?: number;
  colour?: string;
  packageWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  imageUrls: string[];
}

export type NewtonImportTaskStatus =
  | { status: "pending" }
  | { status: "complete"; product: NewtonImportedProduct }
  | { status: "failed"; error: string };

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
  evidence?: ProductResearchEvidence;
  issues?: string[];
}

export interface ProductIdentity {
  sku: string;
  eanCode: string;
}

export interface ProductResearchSource {
  url: string;
  title: string;
  matchedVariant: string;
  evidence: string;
}

export interface ProductResearchEvidence {
  productType: string;
  variant: string;
  matchSummary: string;
  confidence: "high" | "medium" | "low";
  sources: ProductResearchSource[];
}

export type MarketAnalysisConfidence = "high" | "medium" | "low";

export type MarketPricePosition =
  | "strong_advantage"
  | "moderate_advantage"
  | "market_aligned"
  | "above_market"
  | "unavailable";

export interface AmazonMarketCompetitor {
  asin: string;
  title: string;
  url: string;
  imageUrl: string;
  brand: string;
  priceAud: number;
  rating: number | null;
  reviews: number | null;
  monthlySales: number | null;
  categoryName: string;
}

export interface AmazonMarketPriceBand {
  label: string;
  productCount: number;
  monthlySales: number;
  revenueAud: number;
  salesShare: number;
}

export interface AmazonMarketAnalysis {
  source: "proboost-amazon-au";
  marketplace: "Amazon Australia";
  query: string;
  analyzedAt: string;
  snapshotDate: string | null;
  confidence: MarketAnalysisConfidence;
  categoryName: string;
  categoryPath: string;
  currentRrpAud: number;
  competitorCount: number;
  priceMinimumAud: number | null;
  priceMedianAud: number | null;
  priceMaximumAud: number | null;
  priceAdvantagePercent: number | null;
  pricePosition: MarketPricePosition;
  suggestedRrpMinimumAud: number | null;
  suggestedRrpMaximumAud: number | null;
  sampledMonthlySales: number;
  competitors: AmazonMarketCompetitor[];
  priceBands: AmazonMarketPriceBand[];
  notes: string[];
}

export interface AmazonMarketAnalysisInput {
  productName: string;
  categoryName?: string;
  categoryHint?: string;
  sellingPoints?: string;
  currentRrpAud: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
