import type {
  ProductInput,
  ProductResearchEvidence,
  ProductResearchSource
} from "../../shared/product.js";
import { readPackyResponses } from "./packyResponses.js";

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
  package: ResearchPackage & {
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

function parseResearchDocument(value: unknown): ResearchDocument {
  if (
    !isRecord(value) ||
    !isRecord(value.identity) ||
    !isRecord(value.category) ||
    !isRecord(value.package) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.riskFlags) ||
    !Array.isArray(value.reviewNotes)
  ) {
    throw new Error("Packy product research API returned invalid content.");
  }

  const confidence = value.package.confidence;
  const sources = value.sources.filter(isResearchSource);
  if (
    !isNonemptyString(value.identity.productType) ||
    !isNonemptyString(value.identity.variant) ||
    !isNonemptyString(value.identity.matchSummary) ||
    typeof value.category.id !== "number" ||
    !Number.isInteger(value.category.id) ||
    !isNonemptyString(value.category.name) ||
    !isNonemptyString(value.colour) ||
    !["high", "medium", "low"].includes(String(confidence)) ||
    positiveNumber(value.package.weightKg) === undefined ||
    positiveNumber(value.package.lengthCm) === undefined ||
    positiveNumber(value.package.widthCm) === undefined ||
    positiveNumber(value.package.heightCm) === undefined ||
    sources.length !== value.sources.length ||
    !value.riskFlags.every(isNonemptyString) ||
    !value.reviewNotes.every(isNonemptyString)
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
      weightKg: value.package.weightKg as number,
      lengthCm: value.package.lengthCm as number,
      widthCm: value.package.widthCm as number,
      heightCm: value.package.heightCm as number,
      confidence: confidence as ResearchDocument["package"]["confidence"]
    },
    sources,
    riskFlags: value.riskFlags,
    reviewNotes: value.reviewNotes
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
  const content = [
    ...options.images.map((image) => ({
      type: "input_image" as const,
      image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`
    })),
    {
      type: "input_text" as const,
      text: [
        "Identify this exact product and return strict JSON only.",
        "Search the web for the same product and variant before returning package measurements.",
        "Prefer manufacturer or supplier pages, then the exact 1688 listing, then an exact marketplace listing.",
        "Similar-product estimates are forbidden.",
        "DSZ FIELD RULES:",
        options.fieldRules,
        "CATEGORY MAPPING:",
        options.categoryMapping,
        "FULL UPLOAD SOP:",
        options.uploadSop,
        "AU PRODUCT RULES:",
        options.productUploadAu,
        "PRODUCT INPUT:",
        JSON.stringify(options.input),
        "Return identity, category, colour, package, sources, riskFlags and reviewNotes.",
        "Each source must include url, title, matchedVariant, evidence, exactProductMatch,",
        "and its own package object with weightKg, lengthCm, widthCm and heightCm,",
        "or package null when that source does not explicitly publish every measurement.",
        "Every source URL in the JSON must be emitted with a web-search URL citation annotation.",
        "Set exactProductMatch false for similar products. Never infer a missing source value.",
        "Do not harmonise conflicting sources."
      ].join("\n")
    }
  ];

  return {
    model: options.model,
    instructions:
      "Research Dropshipzone product facts. Use web search and return strict JSON without hidden reasoning.",
    input: [{ role: "user" as const, content }],
    tools: [{ type: "web_search" as const }],
    store: false,
    stream: true
  };
}

export function parseCategoryMapping(value: string): Map<number, string> {
  const result = new Map<number, string>();
  for (const line of value.split(/\r?\n/)) {
    const match = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
    if (match) result.set(Number(match[2]), match[1].trim());
  }
  return result;
}

export function validateProductResearch(options: {
  raw: unknown;
  annotatedUrls: string[];
  categoryMapping: string;
  input: ProductInput;
}): AcceptedProductResearch {
  const document = parseResearchDocument(options.raw);
  const mapping = parseCategoryMapping(options.categoryMapping);
  const mappedName = mapping.get(document.category.id);
  const generatedCategoryValid = mappedName === document.category.name;
  const manualCategoryName = positiveNumber(options.input.categoryId)
    ? mapping.get(options.input.categoryId as number)
    : undefined;
  const manualCategoryValid =
    manualCategoryName !== undefined &&
    (!options.input.categoryName || options.input.categoryName === manualCategoryName);
  const manualCategoryProvided =
    options.input.categoryId !== undefined || Boolean(options.input.categoryName);
  const category = manualCategoryValid
    ? { id: options.input.categoryId as number, name: manualCategoryName }
    : generatedCategoryValid
      ? document.category
      : { id: 0, name: "" };

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
  const aggregateMatchesSources = sourceSignatures.has(
    packageSignature(document.package)
  );
  const evidenceValid =
    document.package.confidence === "high" &&
    measuredExactSources.length > 0 &&
    !sourcesConflict &&
    aggregateMatchesSources;
  const issues: string[] = [];

  if (manualCategoryProvided && !manualCategoryValid) {
    issues.push("The manual category ID/path is not in the current mapping.");
  }
  if (category.id === 0) {
    issues.push("Category needs review because no valid ID and path match was found.");
  }
  if (sourcesConflict) {
    issues.push("Package sources conflict and need review.");
  }

  const requestedColour = options.input.colour || document.colour;
  const colourParts = requestedColour.split(" / ");
  const colourValid =
    requestedColour === "N/A" ||
    requestedColour === "Multicolor" ||
    (colourParts.length >= 1 &&
      colourParts.length <= 3 &&
      new Set(colourParts).size === colourParts.length &&
      colourParts.every((part) => ALLOWED_COLOUR_WORDS.has(part)));
  const colour = colourValid ? requestedColour : "N/A";
  if (colour === "N/A" && requestedColour !== "N/A") {
    issues.push("Colour needs review.");
  }

  const researched = evidenceValid
    ? {
        weightKg: positiveNumber(document.package.weightKg),
        lengthCm: positiveNumber(document.package.lengthCm),
        widthCm: positiveNumber(document.package.widthCm),
        heightCm: positiveNumber(document.package.heightCm)
      }
    : {};
  const packageFacts = {
    weightKg: positiveNumber(options.input.packageWeightKg) ?? researched.weightKg,
    lengthCm: positiveNumber(options.input.lengthCm) ?? researched.lengthCm,
    widthCm: positiveNumber(options.input.widthCm) ?? researched.widthCm,
    heightCm: positiveNumber(options.input.heightCm) ?? researched.heightCm
  };
  const completePackage = Object.values(packageFacts).every(
    (value) => value !== undefined
  );
  if (!completePackage) {
    issues.push("Package weight and dimensions need verified same-product evidence.");
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
  const response = await (options.fetchImpl || fetch)(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildProductResearchRequest({
      input: options.input,
      images: options.images,
      fieldRules: options.fieldRules,
      categoryMapping: options.categoryMapping,
      uploadSop: options.uploadSop,
      productUploadAu: options.productUploadAu,
      model: env.PACKY_TEXT_MODEL || "gpt-5.6-sol"
    }))
  });

  if (!response.ok) {
    throw new Error(`Packy product research API failed: ${response.status}`);
  }

  const output = await readPackyResponses(response);
  if (!output.text.trim()) {
    throw new Error("Packy product research API returned empty content.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(
      output.text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")
    );
  } catch {
    throw new Error("Packy product research API returned invalid content.");
  }

  return validateProductResearch({
    raw,
    annotatedUrls: output.annotatedUrls,
    categoryMapping: options.categoryMapping,
    input: options.input
  });
}
