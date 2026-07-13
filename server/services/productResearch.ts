import type {
  ProductInput,
  ProductResearchEvidence,
  ProductResearchSource
} from "../../shared/product.js";
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
  const categoryCandidates = selectCategoryCandidates(
    options.categoryMapping,
    options.input.categoryHint
  );

  return {
    model: options.model,
    instructions:
      "Research exact-product facts with web search. Return a concise cited plain-text evidence report. Do not return JSON.",
    input: [{
      role: "user" as const,
      content: [{
        type: "input_text" as const,
        text: [
          "Research the exact product and variant described below.",
          "Prefer exact manufacturer or supplier pages, then 1688, then exact marketplace listings.",
          "Similar products are not evidence. Clearly label them as non-matches.",
          "Report product type, variant, colour and the best category candidate.",
          "For every source report URL, title, matched variant and why it is or is not exact.",
          "Report package weight and L x W x H only when one exact-product source explicitly publishes all four values.",
          "Cite every source URL with the web-search citation mechanism.",
          "Do not return JSON. Keep the report under 900 words.",
          "CATEGORY CANDIDATES:",
          categoryCandidates || "No matching category candidate was found.",
          "PRODUCT INPUT:",
          JSON.stringify(options.input)
        ].join("\n")
      }]
    }],
    tools: [{ type: "web_search" as const }],
    store: false,
    stream: true
  };
}

function selectCategoryCandidates(
  categoryMapping: string,
  categoryHint: string | undefined
): string {
  const keywords = (categoryHint?.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((keyword) => keyword.length >= 4);

  if (keywords.length === 0) return "";

  return categoryMapping
    .split(/\r?\n/)
    .filter((line) => /^\|\s*.+?\s*\|\s*\d+\s*\|$/.test(line))
    .map((line) => ({
      line,
      score: keywords.filter((keyword) => line.toLowerCase().includes(keyword))
        .length
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 50)
    .map((candidate) => candidate.line)
    .join("\n");
}

function buildProductResearchStructuringRequest(
  options: ProductResearchRequestOptions,
  report: string,
  annotatedUrls: string[]
) {
  const categoryCandidates = selectCategoryCandidates(
    options.categoryMapping,
    options.input.categoryHint
  );

  return {
    model: options.model,
    instructions:
      "Convert the supplied evidence report into strict JSON only. Do not add facts, URLs, measurements or reasoning.",
    input: [{
      role: "user" as const,
      content: [{
        type: "input_text" as const,
        text: [
          "EVIDENCE REPORT:",
          report,
          "CITED HTTPS URLS ALLOWED IN sources:",
          annotatedUrls.join("\n") || "None",
          "CATEGORY CANDIDATES:",
          categoryCandidates || "None. Use id 0 and name Needs review.",
          "PRODUCT INPUT:",
          JSON.stringify(options.input),
          "Return keys identity, category, colour, package, sources, riskFlags and reviewNotes.",
          "identity requires productType, variant and matchSummary strings.",
          "category requires integer id and name from CATEGORY CANDIDATES.",
          "package requires positive weightKg, lengthCm, widthCm, heightCm and confidence high, medium or low.",
          "Each source requires url, title, matchedVariant, evidence, exactProductMatch and package.",
          "Use source.package null unless that exact cited source explicitly contains all four package values.",
          "Use only cited URLs. Preserve conflicts. Similar products must have exactProductMatch false."
        ].join("\n")
      }]
    }],
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
  const reportResponse = await requestPackyResearchResponse({
    url: `${baseUrl}/v1/responses`,
    request: {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildProductResearchRequest(requestOptions))
    },
    fetcher
  });
  const report = await readPackyResponses(reportResponse);

  if (!report.text.trim()) {
    throw new Error("Packy product research API returned empty content.");
  }

  const structureResponse = await requestPackyResearchResponse({
    url: `${baseUrl}/v1/responses`,
    request: {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildProductResearchStructuringRequest(
        requestOptions,
        report.text.trim(),
        report.annotatedUrls
      ))
    },
    fetcher
  });
  const structured = await readPackyResponses(structureResponse);

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
    annotatedUrls: report.annotatedUrls,
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
