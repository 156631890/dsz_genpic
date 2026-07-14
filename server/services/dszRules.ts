import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DszProductFields,
  ProductGenerationResult,
  ProductIdentity,
  ProductInput
} from "../../shared/product.js";
import {
  buildShippingZoneRates,
  type ShippingMeasurements
} from "../../shared/shipping.js";
import { resolveMappedCategory } from "./categoryMatcher.js";
import { generateProductCopyWithPacky } from "./productCopy.js";
import {
  generateProductResearchWithPacky,
  type ProductResearchImage
} from "./productResearch.js";

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
  "<h2>Returns, Refunds and Replacements</h2><p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p ><p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p ><h2>Delivery Timeframe</h2><p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >";

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
    "Use product_name, sku, status, ean_code, stock, weight, length, width, height, cbm, brand_name, colour, enabled, description, vendor_price, rrp and images.",
    "sku must use the Elosung prefix. ean_code must be a 10 digit string. brand_name must be Elosung. status must be 1. stock must be 1000.",
    "images must be HTTPS URL strings and should include at least 5 Shopify product gallery image URLs in this order: main image, side angle, size packaging or detail, lifestyle scene 1, lifestyle scene 2.",
    "weight is in kg. length, width and height are in cm. cbm is length * width * height / 1000000.",
    "vendor_price formula: (MAX(weight, length * width * height / 8000) * 40 + 45 + purchasePriceCny) / 3.05. rrp is vendor_price * 2.",
    "Shipping rates are calculated by the server, not the model: all Australian zones are 0; New Zealand uses max(actual weight, length * width * height / 5000), with AUD 20 below 3 kg and AUD 40 at or above 3 kg."
  ].join("\n"),
  productPrompt: [
    "Generate a pure English ecommerce title and product description for an Australian independent store.",
    "Do not invent unsupported specifications, certifications, links, logos, brand claims, materials or measurements.",
    "The title should be concise, searchable and based on visible product features plus seller selling points.",
    "The description must be single-line HTML.",
    "Allowed HTML tags only: <h2>, <p>, <strong>, <ul>, <li>, <br />.",
    "Include Product Overview, Key Features and Notes sections when useful.",
    "Always include this fixed Returns, Refunds and Replacements and Delivery Timeframe footer:",
    FOOTER
  ].join("\n"),
  categoryMapping: [
    "| Fashion / Women's Fashion / Women's Intimates | 947 |"
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
        truncate(migrateLegacyShippingSections(ruleDocuments.fieldRules), 12000),
        "PRODUCT PROMPT:",
        truncate(ruleDocuments.productPrompt, 30000),
        "CATEGORY MAPPING:",
        truncate(ruleDocuments.categoryMapping, 20000),
        "FULL PRODUCT UPLOAD SOP:",
        truncate(migrateLegacyShippingSections(ruleDocuments.uploadSop), 9000),
        "AU PRODUCT CONTENT RULES:",
        truncate(ruleDocuments.productUploadAu, 6000),
        "INPUT:",
        JSON.stringify(input.input, null, 2),
        "Return JSON with these keys: category, categories, categoryName, product_name, sku, status, ean_code, stock, weight, length, width, height, cbm, brand_name, colour, enabled, description, vendor_price, rrp, images, risk_flags, review_notes.",
        "Copy weight, length, width and height exactly from INPUT; do not estimate or replace them.",
        "product_name and description must follow the DSZ system prompt rules. If the DSZ system prompt says to output only two final lines, use that as content guidance only; return strict JSON for this API call.",
        "For product_name and description, PRODUCT PROMPT is the only writing rule source. Do not add, override, shorten or reinterpret title and HTML description rules outside PRODUCT PROMPT.",
        "When categoryHint is non-empty it is authoritative. Choose a category ID from CATEGORY MAPPING; the server canonicalises its path.",
        "Use internal JSON key product_name for the title and vendor_price for Vendor Price. The uploader maps product_name to DSZ API name and vendor_price to DSZ API price.",
        "Use categories as a string. Use status 1. Use brand_name Elosung. Use stock 1000. Use ean_code as a 10 digit string for the Supplier API. Use images from the input imageUrls. HTML description must be a single line and include the fixed footer.",
        "Shipping rates are calculated by the server, not the model: all Australian zones are 0; New Zealand uses max(actual weight, length * width * height / 5000), with AUD 20 below 3 kg and AUD 40 at or above 3 kg. Do not return shipping rates."
      ].join("\n")
    }
  ];
}

function migrateLegacyShippingSections(value: string): string {
  const lines = value.split(/\r?\n/);
  const migrated: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^\|[^|]*`?zone_rates`?[^|]*\|/i.test(line)) {
      index += 1;
      continue;
    }

    const isShippingStep = /\bStep\s*5\b.*\bShipping\b/i.test(line);
    const isZoneRatesSection = /^###\s+Zone Rates\b/i.test(line);

    if (!isShippingStep && !isZoneRatesSection) {
      migrated.push(line);
      index += 1;
      continue;
    }

    const sectionEnd = findShippingSectionEnd(
      lines,
      index + 1,
      isZoneRatesSection
    );
    const section = lines.slice(index, sectionEnd);

    if (hasLegacyShippingRate(section)) {
      migrated.push(SERVER_CALCULATED_SHIPPING_RULES);
    } else {
      migrated.push(...section);
    }
    index = sectionEnd;
  }

  return migrated.join("\n");
}

function findShippingSectionEnd(
  lines: string[],
  startIndex: number,
  stopAtAnyHeading: boolean
): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    const startsNextBoldSection =
      !stopAtAnyHeading && /^\*\*.+\*\*/.test(line);

    if (
      /^###\s+/.test(line) ||
      (!stopAtAnyHeading && line.trim() === "---") ||
      startsNextBoldSection
    ) {
      return index;
    }
  }

  return lines.length;
}

function hasLegacyShippingRate(lines: string[]): boolean {
  return lines.some(
    (line) =>
      /\bzone_rates\b/i.test(line) || /\bnz\b[^\r\n]*\b10\b/i.test(line)
  );
}

const SERVER_CALCULATED_SHIPPING_RULES = [
  "**Shipping rates are server-calculated, not AI output:**",
  "- All Australian zones: AUD 0.",
  "- Billable weight (kg): max(actual weight, length * width * height / 5000).",
  "- New Zealand: AUD 20 below 3 kg; AUD 40 at or above 3 kg."
].join("\n");

function buildDszTitleDescriptionRepairMessages(input: {
  input: ProductInput;
  fields: DszProductFields;
  ruleDocuments: RuleDocuments;
}): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You repair only Dropshipzone product_name and description. Return only strict JSON."
    },
    {
      role: "user",
      content: [
        "Regenerate only product_name and description for this product.",
        "PRODUCT PROMPT:",
        truncate(input.ruleDocuments.productPrompt, 30000),
        "INPUT:",
        JSON.stringify(input.input, null, 2),
        "CURRENT PRODUCT JSON:",
        JSON.stringify(input.fields, null, 2),
        "Return JSON with keys: product_name, description.",
        "For product_name and description, PRODUCT PROMPT is the only writing rule source. Do not add, override, shorten or reinterpret title and HTML description rules outside PRODUCT PROMPT.",
        "Do not change category, categories, categoryName, sku, ean_code, price, shipping, images or other upload fields."
      ].join("\n")
    }
  ];
}

export function parseGeneratedFields(rawContent: string): DszProductFields {
  const parsed = parseJsonContent(rawContent) as DszProductFields;

  return normalizeGeneratedFields(parsed);
}

export async function generateDszFieldsWithPacky(input: {
  productInput: ProductInput;
  images?: ProductResearchImage[];
  identity?: ProductIdentity;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  ruleDocuments?: RuleDocuments;
}): Promise<ProductGenerationResult> {
  requireManualPackageMeasurements(input.productInput);

  if (input.images && input.identity) {
    return generateEvidenceBackedDszFields({
      ...input,
      images: input.images,
      identity: input.identity
    });
  }

  const env = input.env || process.env;
  const apiKey =
    env.PACKY_FIELD_API_KEY || env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY;
  const identity = createDefaultIdentity();
  const ruleDocuments = input.ruleDocuments || (await loadRuleDocuments(env));

  if (!apiKey) {
    return {
      fields: buildFallbackFields(
        input.productInput,
        identity,
        ruleDocuments.categoryMapping
      ),
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
          ruleDocuments.categoryMapping,
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
  const generatedFields = parseGeneratedFields(content);
  const repairedFields = followsDszDescriptionPrompt(
    normalizeDescriptionHtml(generatedFields.description)
  )
    ? generatedFields
    : await repairGeneratedTitleDescription({
        fields: generatedFields,
        productInput: input.productInput,
        ruleDocuments,
        env,
        fetcher,
        apiKey,
        baseUrl
      });

  return {
    fields: completeGeneratedFields(
      repairedFields,
      input.productInput,
      identity,
      ruleDocuments.categoryMapping
    ),
    source: "ai"
  };
}

async function generateEvidenceBackedDszFields(input: {
  productInput: ProductInput;
  images: ProductResearchImage[];
  identity: ProductIdentity;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  ruleDocuments?: RuleDocuments;
}): Promise<ProductGenerationResult> {
  if (
    !/^Elosung1\d{4}$/.test(input.identity.sku) ||
    !/^\d{10}$/.test(input.identity.eanCode)
  ) {
    throw new Error("Product identity is invalid");
  }

  const ruleDocuments =
    input.ruleDocuments || await loadRuleDocuments(input.env);
  const [research, copy] = await Promise.all([
    generateProductResearchWithPacky({
      input: input.productInput,
      images: input.images,
      fieldRules: ruleDocuments.fieldRules,
      categoryMapping: ruleDocuments.categoryMapping,
      uploadSop: ruleDocuments.uploadSop,
      productUploadAu: ruleDocuments.productUploadAu,
      env: input.env,
      fetchImpl: input.fetchImpl
    }),
    generateProductCopyWithPacky({
      input: input.productInput,
      env: input.env,
      fetchImpl: input.fetchImpl
    })
  ]);
  const { weight, length, width, height } = requireManualPackageMeasurements(
    input.productInput
  );
  const purchasePrice = input.productInput.purchasePriceCny;
  const hasPurchasePrice = typeof purchasePrice === "number" && purchasePrice > 0;
  const hasPriceInputs = hasPurchasePrice;
  const vendorPrice = hasPriceInputs
    ? calculateVendorPrice({
        weightKg: weight,
        lengthCm: length,
        widthCm: width,
        heightCm: height,
        purchasePriceCny: purchasePrice
      })
    : 0;
  const issues = [...research.issues];

  if (!hasPurchasePrice) {
    issues.push("Purchase price is required to calculate Vendor Price and RRP.");
  }

  const fields: DszProductFields = {
    category: research.category.id,
    categories: research.category.id > 0 ? String(research.category.id) : "",
    categoryName: research.category.name,
    product_name: copy.title,
    sku: input.identity.sku,
    status: 1,
    ean_code: input.identity.eanCode,
    stock: 1000,
    weight,
    length,
    width,
    height,
    cbm: calculateCbm(length, width, height),
    brand_name: "Elosung",
    colour: research.colour,
    enabled: true,
    description: copy.description,
    vendor_price: hasPriceInputs ? vendorPrice : 0,
    rrp: hasPriceInputs ? round(vendorPrice * 2, 2) : 0,
    zone_rates: standardZoneRates({
      actualWeightKg: weight,
      lengthCm: length,
      widthCm: width,
      heightCm: height
    }),
    images: [],
    risk_flags: research.riskFlags,
    review_notes: [...research.reviewNotes, ...issues]
  };

  return {
    fields,
    source: "ai",
    evidence: research.evidence,
    issues
  };
}

async function repairGeneratedTitleDescription(input: {
  fields: DszProductFields;
  productInput: ProductInput;
  ruleDocuments: RuleDocuments;
  env: Record<string, string | undefined>;
  fetcher: typeof fetch;
  apiKey: string;
  baseUrl: string;
}): Promise<DszProductFields> {
  const response = await input.fetcher(`${input.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.env.PACKY_TEXT_MODEL || "gpt-5-mini",
      messages: buildDszTitleDescriptionRepairMessages({
        input: input.productInput,
        fields: input.fields,
        ruleDocuments: input.ruleDocuments
      }),
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    if (response.status >= 500) {
      return input.fields;
    }

    throw new Error(`Packy field repair failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return input.fields;
  }

  const repaired = parseJsonContent(content) as {
    product_name?: unknown;
    description?: unknown;
  };

  return normalizeGeneratedFields({
    ...input.fields,
    product_name:
      typeof repaired.product_name === "string"
        ? repaired.product_name
        : input.fields.product_name,
    description:
      typeof repaired.description === "string"
        ? repaired.description
        : input.fields.description
  });
}

export function calculateCbm(lengthCm: number, widthCm: number, heightCm: number): number {
  return round((lengthCm * widthCm * heightCm) / 1_000_000, 6);
}

function requireManualPackageMeasurements(input: ProductInput): {
  weight: number;
  length: number;
  width: number;
  height: number;
} {
  const weight = Number(input.packageWeightKg);
  const length = Number(input.lengthCm);
  const width = Number(input.widthCm);
  const height = Number(input.heightCm);

  if (![weight, length, width, height].every(
    (value) => Number.isFinite(value) && value > 0
  )) {
    throw new Error(
      "Package weight, length, width, and height are required."
    );
  }

  return { weight, length, width, height };
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

export function standardZoneRates(
  measurements: ShippingMeasurements = {
    actualWeightKg: 0,
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0
  }
): Record<string, number> {
  return buildShippingZoneRates(measurements);
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
  categoryMapping: string,
  reason?: string
): DszProductFields {
  const { weight, length, width, height } =
    requireManualPackageMeasurements(input);
  const vendorPrice = calculateVendorPrice({
    weightKg: weight,
    lengthCm: length,
    widthCm: width,
    heightCm: height,
    purchasePriceCny: input.purchasePriceCny || 0
  });
  const categoryResolution = resolveMappedCategory({
    categoryMapping,
    categoryHint: input.categoryHint,
    fallbackText: input.sellingPoints,
    manualCategoryId: input.categoryId
  });
  const category = categoryResolution.category;
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
    zone_rates: standardZoneRates({
      actualWeightKg: weight,
      lengthCm: length,
      widthCm: width,
      heightCm: height
    }),
    images: input.imageUrls,
    risk_flags: [],
    review_notes: [
      ...(reason ? [reason] : []),
      "AI field generation fallback used. Review title, category, colour and price before live upload."
    ]
  };
}

function completeGeneratedFields(
  fields: DszProductFields,
  input: ProductInput,
  identity: ProductIdentity,
  categoryMapping: string
): DszProductFields {
  const fallback = buildFallbackFields(input, identity, categoryMapping);
  const categoryResolution = resolveMappedCategory({
    categoryMapping,
    categoryHint: input.categoryHint,
    fallbackText: input.sellingPoints,
    manualCategoryId: input.categoryId,
    generatedCategoryId: Number(fields.categories || fields.category)
  });
  const merged = normalizeGeneratedFields({
    ...fallback,
    ...fields,
    weight: fallback.weight,
    length: fallback.length,
    width: fallback.width,
    height: fallback.height,
    cbm: fallback.cbm,
    category: categoryResolution.category.id,
    categories: String(categoryResolution.category.id),
    categoryName: categoryResolution.category.name,
    sku: fields.sku || fallback.sku,
    ean_code: fields.ean_code || fallback.ean_code,
    images: fields.images?.length ? fields.images : input.imageUrls,
    zone_rates: standardZoneRates({
      actualWeightKg: fallback.weight,
      lengthCm: fallback.length,
      widthCm: fallback.width,
      heightCm: fallback.height
    })
  });
  merged.description = normalizeDescriptionHtml(merged.description);
  if (!followsDszDescriptionPrompt(merged.description)) {
    merged.description = buildFallbackDescription(input);
  } else if (!merged.description.includes("Returns, Refunds and Replacements")) {
    merged.description = `${merged.description}${FOOTER}`;
  }
  merged.description = normalizeDescriptionHtml(merged.description);
  if (!isValidSku(merged.sku)) {
    merged.sku = fallback.sku;
  }
  if (!isValidApiEan(merged.ean_code)) {
    merged.ean_code = fallback.ean_code;
  }
  merged.vendor_price = calculateVendorPrice({
    weightKg: merged.weight,
    lengthCm: merged.length,
    widthCm: merged.width,
    heightCm: merged.height,
    purchasePriceCny: input.purchasePriceCny || 0
  });
  merged.rrp = round(merged.vendor_price * 2, 2);
  merged.zone_rates = standardZoneRates({
    actualWeightKg: merged.weight,
    lengthCm: merged.length,
    widthCm: merged.width,
    heightCm: merged.height
  });

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
    zone_rates: standardZoneRates({
      actualWeightKg: Number(fields.weight || 0),
      lengthCm: Number(fields.length || 0),
      widthCm: Number(fields.width || 0),
      heightCm: Number(fields.height || 0)
    }),
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
      "<p><strong>Key Features</strong></p><ul><li>Uses the uploaded product images and seller provided selling points for a conservative product listing.</li><li>Highlights practical everyday value without unsupported claims or invented specifications.</li><li>Keeps the product page readable with clear feature and benefit wording.</li><li>Prepared as single-line HTML for Dropshipzone product upload review.</li></ul>",
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

function parseJsonContent(rawContent: string): unknown {
  const trimmed = rawContent.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(withoutFence);
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
  const id = String(value || 1).trim();
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
