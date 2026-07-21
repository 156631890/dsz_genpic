import type {
  ProductInput,
  ProductResearchEvidence,
  ProductResearchSource
} from "../../shared/product.js";
import {
  formatCategoryCandidates,
  resolveMappedCategory
} from "./categoryMatcher.js";
import { readPackyResponses } from "./packyResponses.js";

const PACKY_PRODUCT_RESEARCH_MAX_ATTEMPTS = 3;

export interface ProductResearchImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  buffer: Buffer;
}

interface ProductResearchRequestOptions {
  input: ProductInput;
  images: ProductResearchImage[];
  fieldRules: string;
  categoryMapping: string;
  uploadSop: string;
  productUploadAu: string;
  model: string;
}

export interface AcceptedProductResearch {
  category: { id: number; name: string };
  colour: string;
  package: Partial<{
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  }>;
  evidence: ProductResearchEvidence;
  riskFlags: string[];
  reviewNotes: string[];
  issues: string[];
}

type ResearchPackage = {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

type ResearchSourceDocument = ProductResearchSource & {
  exactProductMatch: boolean;
  package: ResearchPackage | null;
};

interface ResearchDocument {
  identity: {
    productType: string;
    variant: string;
    matchSummary: string;
  };
  category: { id: number; name: string };
  colour: string;
  package: Partial<ResearchPackage> & {
    confidence: "high" | "medium" | "low";
  };
  sources: ResearchSourceDocument[];
  riskFlags: string[];
  reviewNotes: string[];
}

const ALLOWED_COLOUR_WORDS = new Set([
  "Black",
  "White",
  "Red",
  "Blue",
  "Green",
  "Pink",
  "Purple",
  "Orange",
  "Yellow",
  "Grey",
  "Brown",
  "Beige",
  "Navy",
  "Silver",
  "Gold"
]);
const COLOUR_ALIASES = new Map<string, string>([
  ...Array.from(ALLOWED_COLOUR_WORDS, (colour) => [colour.toLowerCase(), colour] as const),
  ["gray", "Grey"],
  ["navy blue", "Navy"],
  ["golden", "Gold"]
]);

function parseResearchDocument(value: unknown): ResearchDocument {
  if (
    !isRecord(value) ||
    !isRecord(value.identity) ||
    !isRecord(value.category) ||
    !isRecord(value.package) ||
    !Array.isArray(value.sources)
  ) {
    throw new Error("Packy product research API returned invalid content.");
  }

  const confidence = value.package.confidence;
  const sources = value.sources.filter(isResearchSource);
  const riskFlags = normalizeStringList(value.riskFlags);
  const reviewNotes = normalizeStringList(value.reviewNotes);
  if (
    !isNonemptyString(value.identity.productType) ||
    !isNonemptyString(value.identity.variant) ||
    !isNonemptyString(value.identity.matchSummary) ||
    typeof value.category.id !== "number" ||
    !Number.isInteger(value.category.id) ||
    !isNonemptyString(value.category.name) ||
    !isNonemptyString(value.colour) ||
    !["high", "medium", "low"].includes(String(confidence)) ||
    sources.length !== value.sources.length ||
    riskFlags === undefined ||
    reviewNotes === undefined
  ) {
    throw new Error("Packy product research API returned invalid content.");
  }

  return {
    identity: {
      productType: value.identity.productType,
      variant: value.identity.variant,
      matchSummary: value.identity.matchSummary
    },
    category: {
      id: value.category.id,
      name: value.category.name
    },
    colour: value.colour,
    package: {
      ...optionalPackageFacts(value.package),
      confidence: confidence as ResearchDocument["package"]["confidence"]
    },
    sources,
    riskFlags,
    reviewNotes
  };
}

function isResearchSource(value: unknown): value is ResearchSourceDocument {
  return (
    isRecord(value) &&
    isNonemptyString(value.url) &&
    isNonemptyString(value.title) &&
    isNonemptyString(value.matchedVariant) &&
    isNonemptyString(value.evidence) &&
    typeof value.exactProductMatch === "boolean" &&
    (value.package === null ||
      (isRecord(value.package) &&
        positiveNumber(value.package.weightKg) !== undefined &&
        positiveNumber(value.package.lengthCm) !== undefined &&
        positiveNumber(value.package.widthCm) !== undefined &&
        positiveNumber(value.package.heightCm) !== undefined))
  );
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function packageSignature(value: ResearchPackage): string {
  return [value.weightKg, value.lengthCm, value.widthCm, value.heightCm].join("|");
}

export function buildProductResearchRequest(
  options: ProductResearchRequestOptions
) {
  const categoryCandidates = formatCategoryCandidates(
    options.categoryMapping,
    options.input.categoryHint,
    options.input.sellingPoints
  );

  return {
    model: options.model,
    instructions:
      "Generate complete DSZ product research JSON using the product input, source images and supplied category mapping. Return strict JSON only.",
    input: [{
      role: "user" as const,
      content: [
        ...options.images.map((image) => ({
          type: "input_image" as const,
          image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`
        })),
        {
          type: "input_text" as const,
          text: [
            "Identify the most likely product and variant from the input and source images.",
            "When categoryHint is non-empty, treat it as authoritative. Use images and selling points only to break ties. When categoryHint is empty, infer the category from the visible product and choose from the complete mapping.",
            "Choose exactly one category ID from CATEGORY CANDIDATES.",
            "Copy PRODUCT INPUT packageWeightKg to package.weightKg exactly, and use lengthCm, widthCm, and heightCm exactly; do not estimate, change, or replace them.",
            "Identify colour from the product itself in the source images, not from the background, packaging, props, text, lighting cast, or accessories that are not part of the product.",
            "Use the DSZ colour Multicolor for a product with more than three material colours; otherwise use N/A only when colour genuinely does not apply, or one to three allowed colour names separated by ' / '.",
            "Return keys identity, category, colour, package, sources, riskFlags and reviewNotes.",
            "identity requires productType, variant and matchSummary strings.",
            "category requires an integer id from CATEGORY CANDIDATES and a non-empty name.",
            "package requires the exact positive weightKg, lengthCm, widthCm, heightCm from PRODUCT INPUT and confidence high, medium or low.",
            "Set sources to [] because no web evidence is supplied. riskFlags and reviewNotes must be string arrays.",
            "Return strict JSON only, without Markdown or commentary.",
            "CATEGORY CANDIDATES:",
            categoryCandidates,
            "PRODUCT INPUT:",
            JSON.stringify(options.input)
          ].join("\n")
        }
      ]
    }],
    store: false,
    stream: true
  };
}

function optionalPackageFacts(value: Record<string, unknown>): Partial<ResearchPackage> {
  return Object.fromEntries(
    ["weightKg", "lengthCm", "widthCm", "heightCm"]
      .map((key) => [key, positiveNumber(value[key])] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
  );
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (isNonemptyString(value)) return [value];
  return Array.isArray(value) && value.every(isNonemptyString)
    ? value
    : undefined;
}

export function validateProductResearch(options: {
  raw: unknown;
  annotatedUrls: string[];
  categoryMapping: string;
  input: ProductInput;
}): AcceptedProductResearch {
  const document = parseResearchDocument(options.raw);
  const categoryResolution = resolveMappedCategory({
    categoryMapping: options.categoryMapping,
    categoryHint: options.input.categoryHint,
    fallbackText: options.input.sellingPoints,
    manualCategoryId: options.input.categoryId,
    generatedCategoryId: document.category.id
  });
  const category = categoryResolution.category;

  const annotated = new Set(options.annotatedUrls);
  const exactSources = document.sources.filter(
    (source) =>
      source.exactProductMatch &&
      isHttpsUrl(source.url) &&
      annotated.has(source.url)
  );
  const measuredExactSources = exactSources.filter(
    (source): source is ResearchSourceDocument & { package: ResearchPackage } =>
      source.package !== null
  );
  const sourceSignatures = new Set(
    measuredExactSources.map((source) => packageSignature(source.package))
  );
  const sourcesConflict = sourceSignatures.size > 1;
  const issues: string[] = [];

  if (categoryResolution.invalidManualCategory) {
    issues.push("The manual category ID is not in the current mapping.");
  }
  if (categoryResolution.defaulted) {
    issues.push(
      "Category defaulted to General Goods because no closer mapping match was found."
    );
  }
  if (sourcesConflict) {
    issues.push("Package sources conflict and need review.");
  }

  const requestedColour = options.input.colour ||
    (/\bmulticolou?r(?:ed)?\b/i.test(options.input.sellingPoints)
      ? "Multicolor"
      : document.colour);
  const colour = normalizeDszColour(requestedColour);
  if (colour === "N/A" && requestedColour !== "N/A") {
    issues.push("Colour needs review.");
  }

  const packageFacts = {
    weightKg: positiveNumber(options.input.packageWeightKg),
    lengthCm: positiveNumber(options.input.lengthCm),
    widthCm: positiveNumber(options.input.widthCm),
    heightCm: positiveNumber(options.input.heightCm)
  };
  const completePackage = Object.values(packageFacts).every(
    (value) => value !== undefined
  );
  if (!completePackage) {
    issues.push("Required operator package measurements are unavailable.");
  }

  return {
    category,
    colour,
    package: Object.fromEntries(
      Object.entries(packageFacts).filter((entry) => entry[1] !== undefined)
    ),
    evidence: {
      productType: document.identity.productType,
      variant: document.identity.variant,
      matchSummary: document.identity.matchSummary,
      confidence: document.package.confidence,
      sources: exactSources.map(({ url, title, matchedVariant, evidence }) => ({
        url,
        title,
        matchedVariant,
        evidence
      }))
    },
    riskFlags: document.riskFlags,
    reviewNotes: document.reviewNotes,
    issues
  };
}

export function normalizeDszColour(value: string): string {
  const trimmed = value.trim();
  if (/^(?:n\/?a|not applicable)$/i.test(trimmed)) return "N/A";
  if (/^multi[ -]?colou?red?$/i.test(trimmed) || /^multi[ -]?colou?r$/i.test(trimmed)) {
    return "Multicolor";
  }

  const rawParts = trimmed
    .split(/\s*(?:\/|,|&|\+|\band\b)\s*/i)
    .filter(Boolean);
  const parts = rawParts.map((part) => COLOUR_ALIASES.get(part.toLowerCase()));

  if (parts.some((part) => !part)) return "N/A";
  const unique = Array.from(new Set(parts as string[]));
  if (unique.length > 3) return "Multicolor";
  return unique.length > 0 ? unique.join(" / ") : "N/A";
}

export async function generateProductResearchWithPacky(options: {
  input: ProductInput;
  images: ProductResearchImage[];
  fieldRules: string;
  categoryMapping: string;
  uploadSop: string;
  productUploadAu: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<AcceptedProductResearch> {
  const env = options.env || process.env;
  const apiKey = env.PACKY_TEXT_API_KEY || env.PACKY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing PACKY_TEXT_API_KEY or PACKY_API_KEY.");
  }

  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(
    /\/+$/,
    ""
  );
  const requestOptions = {
    input: options.input,
    images: options.images,
    fieldRules: options.fieldRules,
    categoryMapping: options.categoryMapping,
    uploadSop: options.uploadSop,
    productUploadAu: options.productUploadAu,
    model: env.PACKY_TEXT_MODEL || "gpt-5.6-sol"
  };
  const requestHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  const fetcher = options.fetchImpl || fetch;
  const response = await requestPackyResearchResponse({
    url: `${baseUrl}/v1/responses`,
    request: {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildProductResearchRequest(requestOptions))
    },
    fetcher
  });
  const structured = await readPackyResponses(response);

  if (!structured.text.trim()) {
    throw new Error("Packy product research API returned empty content.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(
      structured.text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")
    );
  } catch {
    throw new Error("Packy product research API returned invalid content.");
  }

  return validateProductResearch({
    raw,
    annotatedUrls: structured.annotatedUrls,
    categoryMapping: options.categoryMapping,
    input: options.input
  });
}

async function requestPackyResearchResponse(input: {
  url: string;
  request: RequestInit;
  fetcher: typeof fetch;
}): Promise<Response> {
  let transportError: TypeError | undefined;

  for (
    let attempt = 1;
    attempt <= PACKY_PRODUCT_RESEARCH_MAX_ATTEMPTS;
    attempt += 1
  ) {
    let response: Response;

    try {
      response = await input.fetcher(input.url, input.request);
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        attempt === PACKY_PRODUCT_RESEARCH_MAX_ATTEMPTS
      ) {
        throw error;
      }
      transportError = error;
      continue;
    }

    if (response.ok) return response;

    const transient =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    if (!transient || attempt === PACKY_PRODUCT_RESEARCH_MAX_ATTEMPTS) {
      throw new Error(`Packy product research API failed: ${response.status}`);
    }
  }

  if (transportError) throw transportError;
  throw new Error("Packy product research API failed: 503");
}
