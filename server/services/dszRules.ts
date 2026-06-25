import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DszProductFields,
  ProductGenerationResult,
  ProductInput
} from "../../shared/product.js";

export interface RuleDocuments {
  fieldRules: string;
  productPrompt: string;
  categoryMapping: string;
  uploadSop: string;
  productUploadAu: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const DEFAULT_CATEGORY = {
  id: 1,
  name: "General Goods"
};
const CATEGORY_HINTS = [
  {
    id: 947,
    name: "Fashion / Women's Fashion / Women's Intimates",
    keywords: [
      "women's intimates",
      "womens intimates",
      "intimate",
      "thong",
      "women underwear",
      "women's underwear",
      "女士内衣",
      "女士内裤",
      "女士丁字裤",
      "丁字裤"
    ]
  },
  {
    id: 952,
    name: "Fashion / Women's Fashion / Women's Lingerie",
    keywords: [
      "women's lingerie",
      "womens lingerie",
      "lingerie",
      "bra",
      "女士文胸",
      "文胸",
      "女士内衣套装",
      "女性内衣"
    ]
  },
  {
    id: 953,
    name: "Fashion / Women's Fashion / Women's Sleepwear",
    keywords: [
      "women's sleepwear",
      "womens sleepwear",
      "sleepwear",
      "pyjama",
      "pajama",
      "nightwear",
      "女士睡衣",
      "女式睡衣",
      "睡衣"
    ]
  },
  {
    id: 956,
    name: "Fashion / Women's Fashion / Women's Swimwear",
    keywords: [
      "women's swimwear",
      "womens swimwear",
      "women swimwear",
      "swimwear",
      "swimsuit",
      "bikini",
      "女士泳装",
      "女士泳衣",
      "女式泳装",
      "泳装",
      "泳衣",
      "比基尼"
    ]
  },
  {
    id: 936,
    name: "Fashion / Men's Fashion / Men's Underwear & Socks",
    keywords: [
      "men's underwear",
      "mens underwear",
      "men underwear",
      "men's socks",
      "mens socks",
      "男士内裤",
      "男士袜子",
      "男式内裤",
      "男内裤"
    ]
  },
  {
    id: 929,
    name: "Fashion / Men's Fashion / Men's Sleepwear",
    keywords: [
      "men's sleepwear",
      "mens sleepwear",
      "men sleepwear",
      "men's pyjama",
      "mens pajama",
      "男士睡衣",
      "男式睡衣"
    ]
  },
  {
    id: 961,
    name: "Fashion / Men's Fashion / Men's Swimwear",
    keywords: [
      "men's swimwear",
      "mens swimwear",
      "men swimwear",
      "men's swimsuit",
      "mens swimsuit",
      "男士泳装",
      "男士泳衣",
      "男式泳装"
    ]
  }
] as const;
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

const FOOTER =
  "<p><strong>Returns, Refunds and Replacements </strong><br />Products that are received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with the Australian Consumer Law (ACL). We are committed to ensuring all products meet the standards of quality and reliability expected by our customers. However, please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p><p><strong>Delivery Timeframe</strong></p><p>Please note that we cannot guarantee the exact date of arrival, and the delivery timeframes excluding weekends and public holidays are as follows:</p><ul><li>For customers in Victoria, approximately 7-10 working days;</li><li>For customers in NSW, SA, ACT, and QLD, approximately 9-12 working days;</li><li>For customers in WA, NT, and TAS, approximately 9-12 working days.</li></ul>";

const REQUIRED_DESCRIPTION_SECTIONS = [
  "Product Overview",
  "Key Features",
  "Why It Stands Out",
  "Notes"
];

const RULE_FILE_NAMES = {
  fieldRules: "Dropshipzone_Field_Rules.md",
  productPrompt: "DSZ系统prompt 4月20版本.txt",
  categoryMapping: "Category_Mapping.md"
} as const;

const BUILT_IN_RULE_DOCUMENTS: RuleDocuments = {
  fieldRules: [
    "Dropshipzone supplier product field rules for POST /products.",
    "Return one product object that can be wrapped as { products: [product] }.",
    "Use category as an internal integer mirror of categories. The DSZ upload API sends categories only.",
    "Use product_name, sku, status, ean_code, stock, weight, length, width, height, cbm, brand_name, colour, enabled, description, vendor_price, rrp, zone_rates and images.",
    "sku must use the Elosung prefix. ean_code must be a 10 digit string. brand_name must be Elosung. status must be 1. stock must be 1000.",
    "images must be HTTPS URL strings and should include at least 5 Shopify product gallery image URLs in this order: main image, side angle, size packaging or detail, lifestyle scene 1, lifestyle scene 2.",
    "weight is in kg. length, width and height are in cm. cbm is length * width * height / 1000000.",
    "vendor_price formula: (MAX(weight, length * width * height / 8000) * 40 + 45 + purchasePriceCny) / 3.05. rrp is vendor_price * 2.",
    "zone_rates must include Australian regions at 0 and nz at 10."
  ].join("\n"),
  productPrompt: [
    "Generate a pure English ecommerce title and product description for an Australian independent store.",
    "Do not invent unsupported specifications, certifications, links, logos, brand claims, materials or measurements.",
    "The title should be concise, searchable and based on visible product features plus seller selling points.",
    "The description must be single-line HTML.",
    "Allowed HTML tags only: <p>, <strong>, <ul>, <li>, <br />.",
    "Include Product Overview, Key Features and Notes sections when useful.",
    "Always include this fixed ACL and Delivery Timeframe footer:",
    FOOTER
  ].join("\n"),
  categoryMapping: [
    "Women's Intimates | 947",
    "Default | 1 | General Goods"
  ].join("\n"),
  uploadSop: [
    "Full product upload SOP.",
    "Dropshipzone has Details, Price, Shipping and Images tabs.",
    "Vendor Price and Vendor RRP must be calculated from chargeable weight and purchase price.",
    "Manual review should check SKU, EAN, category, price, shipping and images before submission."
  ].join("\n"),
  productUploadAu: [
    "Australian independent store content rules.",
    "Title and HTML description must be pure English, professional, compliant and suitable for ecommerce upload.",
    "Do not include links, unsupported claims, unauthorized brands, Chinese punctuation or unsupported HTML tags."
  ].join("\n")
};

export function buildDszGenerationMessages(input: {
  input: ProductInput;
  ruleDocuments: RuleDocuments;
}): ChatMessage[] {
  const { ruleDocuments } = input;

  return [
    {
      role: "system",
      content:
        "You generate Dropshipzone supplier product fields. Return only strict JSON. Never invent unverifiable specifications."
    },
    {
      role: "user",
      content: [
        "Generate a complete Dropshipzone product JSON object from the uploaded image URLs and seller selling points.",
        "Follow these rule documents exactly.",
        "FIELD RULES:",
        truncate(ruleDocuments.fieldRules, 12000),
        "PRODUCT PROMPT:",
        truncate(ruleDocuments.productPrompt, 30000),
        "CATEGORY MAPPING:",
        truncate(ruleDocuments.categoryMapping, 20000),
        "FULL PRODUCT UPLOAD SOP:",
        truncate(ruleDocuments.uploadSop, 9000),
        "AU PRODUCT CONTENT RULES:",
        truncate(ruleDocuments.productUploadAu, 6000),
        "INPUT:",
        JSON.stringify(input.input, null, 2),
        "Return JSON with these keys: category, categories, categoryName, product_name, sku, status, ean_code, stock, weight, length, width, height, cbm, brand_name, colour, enabled, description, vendor_price, rrp, zone_rates, images, risk_flags, review_notes.",
        "product_name and description must follow the DSZ system prompt rules. If the DSZ system prompt says to output only two final lines, use that as content guidance only; return strict JSON for this API call.",
        "For product_name and description, PRODUCT PROMPT is the only writing rule source. Do not add, override, shorten or reinterpret title and HTML description rules outside PRODUCT PROMPT.",
        "Choose exactly one best matching Category_Mapping ID from the category mapping. Prefer the most specific sub-subcategory that matches categoryHint, selling points, product type and image context. Do not default every product to Women's Intimates.",
        "Use internal JSON key product_name for the title and vendor_price for Vendor Price. The uploader maps product_name to DSZ API name and vendor_price to DSZ API price.",
        "Use categories as a string. Use status 1. Use brand_name Elosung. Use stock 1000. Use ean_code as a 10 digit string for the Supplier API. Use images from the input imageUrls. HTML description must be a single line and include the fixed footer.",
        "Use zone_rates with AU zones at 0 and nz at 10."
      ].join("\n")
    }
  ];
}

export function parseGeneratedFields(rawContent: string): DszProductFields {
  const trimmed = rawContent.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(withoutFence) as DszProductFields;

  return normalizeGeneratedFields(parsed);
}

export async function generateDszFieldsWithPacky(input: {
  productInput: ProductInput;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  ruleDocuments?: RuleDocuments;
}): Promise<ProductGenerationResult> {
  const env = input.env || process.env;
  const apiKey =
    env.PACKY_FIELD_API_KEY || env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY;
  const identity = createDefaultIdentity();
  const ruleDocuments = input.ruleDocuments || (await loadRuleDocuments(env));

  if (!apiKey) {
    return {
      fields: buildFallbackFields(input.productInput, identity),
      source: "fallback"
    };
  }

  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(
    /\/+$/,
    ""
  );
  const fetcher = input.fetchImpl || fetch;
  const response = await fetcher(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.PACKY_TEXT_MODEL || "gpt-5-mini",
      messages: buildDszGenerationMessages({
        input: input.productInput,
        ruleDocuments
      }),
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    if (response.status >= 500) {
      return {
        fields: buildFallbackFields(
          input.productInput,
          identity,
          `Packy field generation failed with ${response.status}. Local fallback fields were generated.`
        ),
        source: "fallback"
      };
    }

    throw new Error(`Packy field generation failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Packy field generation returned empty content");
  }

  return {
    fields: completeGeneratedFields(parseGeneratedFields(content), input.productInput, identity),
    source: "ai"
  };
}

export function calculateCbm(lengthCm: number, widthCm: number, heightCm: number): number {
  return round((lengthCm * widthCm * heightCm) / 1_000_000, 6);
}

export function calculateVendorPrice(input: {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  purchasePriceCny: number;
}): number {
  const volumetricWeight = (input.lengthCm * input.widthCm * input.heightCm) / 8000;
  const chargeableWeight = Math.max(input.weightKg, volumetricWeight);
  return round((chargeableWeight * 40 + 45 + input.purchasePriceCny) / 3.05, 2);
}

export function formatSku(value: number): string {
  return `Elosung${value}`;
}

export function standardZoneRates(): Record<string, number> {
  return {
    act: 0,
    nsw_m: 0,
    nsw_r: 0,
    nt_m: 0,
    nt_r: 0,
    qld_m: 0,
    qld_r: 0,
    remote: 0,
    sa_m: 0,
    sa_r: 0,
    tas_m: 0,
    tas_r: 0,
    vic_m: 0,
    vic_r: 0,
    wa_m: 0,
    wa_r: 0,
    nz: 10
  };
}

export async function loadRuleDocuments(
  env: Record<string, string | undefined> = process.env
): Promise<RuleDocuments> {
  for (const rulesDir of getRuleDirectories(env)) {
    const documents = await tryLoadRuleDocuments(rulesDir);

    if (documents) {
      return documents;
    }
  }

  return BUILT_IN_RULE_DOCUMENTS;
}

function buildFallbackFields(
  input: ProductInput,
  identity: ProductIdentity,
  reason?: string
): DszProductFields {
  const weight = input.packageWeightKg || 0.1;
  const length = input.lengthCm || 15;
  const width = input.widthCm || 17;
  const height = input.heightCm || 3;
  const vendorPrice = calculateVendorPrice({
    weightKg: weight,
    lengthCm: length,
    widthCm: width,
    heightCm: height,
    purchasePriceCny: input.purchasePriceCny || 0
  });
  const category = resolveCategoryHint(input.categoryHint) || guessCategory(input);
  const productName = buildFallbackTitle(input);

  return {
    category: category.id,
    categories: String(category.id),
    categoryName: category.name,
    product_name: productName,
    sku: identity.sku,
    status: 1,
    ean_code: identity.eanCode,
    stock: 1000,
    weight,
    length,
    width,
    height,
    cbm: calculateCbm(length, width, height),
    brand_name: "Elosung",
    colour: "Multicolor",
    enabled: true,
    description: buildFallbackDescription(input),
    vendor_price: vendorPrice,
    rrp: round(vendorPrice * 2, 2),
    zone_rates: standardZoneRates(),
    images: input.imageUrls,
    risk_flags: [],
    review_notes: [
      ...(reason ? [reason] : []),
      "AI field generation fallback used. Review title, category, colour, weight, dimensions and price before live upload."
    ]
  };
}

function completeGeneratedFields(
  fields: DszProductFields,
  input: ProductInput,
  identity: ProductIdentity
): DszProductFields {
  const fallback = buildFallbackFields(input, identity);
  const merged = normalizeGeneratedFields({
    ...fallback,
    ...fields,
    sku: fields.sku || fallback.sku,
    ean_code: fields.ean_code || fallback.ean_code,
    images: fields.images?.length ? fields.images : input.imageUrls,
    zone_rates: fields.zone_rates || standardZoneRates()
  });
  const hintedCategory = resolveCategoryHint(input.categoryHint);

  merged.description = normalizeDescriptionHtml(merged.description);
  if (!followsDszDescriptionPrompt(merged.description)) {
    merged.description = buildFallbackDescription(input);
  } else if (!merged.description.includes("Returns, Refunds and Replacements")) {
    merged.description = `${merged.description}${FOOTER}`;
  }
  merged.description = normalizeDescriptionHtml(merged.description);
  if (hintedCategory) {
    merged.category = hintedCategory.id;
    merged.categories = String(hintedCategory.id);
    merged.categoryName = hintedCategory.name;
  }
  if (!isValidSku(merged.sku)) {
    merged.sku = fallback.sku;
  }
  if (!isValidApiEan(merged.ean_code)) {
    merged.ean_code = fallback.ean_code;
  }
  if (!Number.isFinite(merged.vendor_price) || merged.vendor_price <= 0) {
    merged.vendor_price = fallback.vendor_price;
  }
  if (!Number.isFinite(merged.rrp) || merged.rrp < merged.vendor_price) {
    merged.rrp = round(merged.vendor_price * 2, 2);
  }
  merged.zone_rates = standardZoneRates();

  return merged;
}

function normalizeGeneratedFields(fields: DszProductFields): DszProductFields {
  const categoryId = normalizeCategoryId(fields.categories || fields.category);

  return {
    ...fields,
    categories: categoryId,
    status: Number(fields.status || 1),
    stock: Number(fields.stock || 1000),
    category: Number(categoryId),
    product_name: fields.product_name || "General Product - Everyday Use, Practical Product Listing",
    sku: String(fields.sku || ""),
    ean_code: String(fields.ean_code || ""),
    description: String(fields.description || ""),
    weight: Number(fields.weight || 0),
    length: Number(fields.length || 0),
    width: Number(fields.width || 0),
    height: Number(fields.height || 0),
    cbm: Number(fields.cbm || calculateCbm(fields.length || 0, fields.width || 0, fields.height || 0)),
    vendor_price: Number(fields.vendor_price || 0),
    rrp: Number(fields.rrp || 0),
    brand_name: fields.brand_name || "Elosung",
    colour: fields.colour || "N/A",
    enabled: fields.enabled !== false,
    zone_rates: fields.zone_rates || standardZoneRates(),
    images: fields.images || [],
    risk_flags: fields.risk_flags || [],
    review_notes: fields.review_notes || []
  };
}

function createDefaultIdentity(): ProductIdentity {
  return {
    sku: formatSku(10001),
    eanCode: "4748549810"
  };
}

interface ProductIdentity {
  sku: string;
  eanCode: string;
}

function guessCategory(input: ProductInput) {
  const text = `${input.categoryHint || ""} ${input.sellingPoints}`.toLowerCase();
  const category = resolveCategoryHint(text);

  if (category) {
    return category;
  }

  if (text.includes("intimate") || text.includes("underwear") || text.includes("thong")) {
    return {
      id: 947,
      name: "Fashion / Women's Fashion / Women's Intimates"
    };
  }

  return DEFAULT_CATEGORY;
}

function resolveCategoryHint(value?: string) {
  const normalized = normalizeSearchText(value);

  if (!normalized) {
    return undefined;
  }

  return CATEGORY_HINTS.flatMap((category) =>
    category.keywords.map((keyword) => ({
      category,
      keyword: normalizeSearchText(keyword)
    }))
  )
    .filter((match) => match.keyword && normalized.includes(match.keyword))
    .sort((left, right) => right.keyword.length - left.keyword.length)[0]
    ?.category;
}

function normalizeSearchText(value?: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackTitle(input: ProductInput): string {
  const firstPhrase = input.sellingPoints.split(/[,.]/)[0]?.trim();
  return firstPhrase
    ? `${titleCase(firstPhrase)} - Everyday Use, Practical Product Listing`
    : "General Product - Everyday Use, Practical Product Listing";
}

function buildFallbackDescription(input: ProductInput): string {
  const safeSellingPoints = input.sellingPoints.trim() || "This product is prepared for ecommerce listing.";

  return normalizeDescriptionHtml(
    [
      `<p><strong>Product Overview</strong></p><p>${escapeHtml(safeSellingPoints)}</p>`,
      "<p><strong>Key Features</strong></p><ul><li>Uses the uploaded product images and seller provided selling points for a conservative product listing.</li><li>Highlights practical everyday value without unsupported claims or invented specifications.</li><li>Prepared as single-line HTML for Dropshipzone product upload review.</li></ul>",
      "<p><strong>Why It Stands Out</strong></p><p>The listing focuses on clear product identification, visible features and verified seller information so customers can quickly understand the product and its use case.</p>",
      "<p><strong>Notes</strong></p><p>Please review all generated specifications, pricing, category and images before publishing.</p>",
      FOOTER
    ].join("")
  );
}

function followsDszDescriptionPrompt(description: string): boolean {
  const normalized = description.toLowerCase();

  return REQUIRED_DESCRIPTION_SECTIONS.every((section) =>
    normalized.includes(section.toLowerCase())
  );
}

function normalizeDescriptionHtml(description: string): string {
  return String(description || "")
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getRuleDirectories(env: Record<string, string | undefined>): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.RULES_DIR,
    join(process.cwd(), "rules"),
    join(moduleDir, "..", "..", "rules"),
    env.RULES_DIR ? undefined : join(moduleDir, "..", "..", "..")
  ];

  return Array.from(
    new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))
  );
}

async function tryLoadRuleDocuments(
  rulesDir: string
): Promise<RuleDocuments | undefined> {
  try {
    const [fieldRules, productPrompt, categoryMapping, uploadSop, productUploadAu] =
      await Promise.all([
        readFirstMatchingFile(rulesDir, [RULE_FILE_NAMES.fieldRules]),
        readFirstMatchingFile(rulesDir, [
          "DSZ系统prompt 4月20版本.txt",
          RULE_FILE_NAMES.productPrompt
        ]),
        readFirstMatchingFile(rulesDir, [RULE_FILE_NAMES.categoryMapping]),
        readFirstMatchingFile(rulesDir, ["Full_Product_Upload_SOP.md"]),
        readFirstMatchingFile(rulesDir, ["Product_Upload_AU.md"])
      ]);

    return {
      fieldRules,
      productPrompt,
      categoryMapping,
      uploadSop,
      productUploadAu
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readFirstMatchingFile(
  rulesDir: string,
  fileNames: readonly string[]
): Promise<string> {
  let missingError: unknown;

  for (const fileName of fileNames) {
    try {
      return await readText(join(rulesDir, fileName));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      missingError = error;
    }
  }

  throw missingError;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code !== undefined &&
    ["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))
  );
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeCategoryId(value: string | number): string {
  const id = String(value || DEFAULT_CATEGORY.id).trim();
  return LEGACY_CATEGORY_ID_MAP[id] || id;
}

function isValidSku(value: string): boolean {
  const match = /^Elosung(\d{5})$/.exec(value);
  if (!match) return false;

  const number = Number(match[1]);
  return number >= 10000 && number <= 19999;
}

function isValidApiEan(value: string): boolean {
  return /^\d{10}$/.test(value);
}
