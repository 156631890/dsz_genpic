# Full Product Field Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the one-button workflow use GPT-5.6 SOL image input and web search to fill evidence-backed product fields and validated copy while keeping GPT-Image-2 independent.

**Architecture:** Add a focused Packy Responses stream parser and a product-research adapter, then replace the unused legacy full-field Chat Completions path with a two-stage GPT-5.6 SOL research-and-copy orchestrator. The browser sends source files and a browser-persistent product identity to the multipart full-field route, applies validated fields without overwriting operator-owned values, and renders research evidence separately from the Supplier API payload.

**Tech Stack:** TypeScript, React 19, Express 5, Multer, Packy OpenAI-compatible Responses API, Vitest, Testing Library, Vite, Vercel.

**Production constraint:** Vercel Functions cap request bodies at 4.5 MB, so every
one-button source-image batch must stay at or below 4,000,000 bytes, leaving room for
multipart metadata. Configure the sequential research/copy function for a 300-second
maximum duration. See the official
[Vercel Functions limits](https://vercel.com/docs/functions/limitations).

---

## File Structure

- Create `server/services/packyResponses.ts`: parse Packy streaming Responses text and URL annotations without knowing product semantics.
- Create `server/services/productResearch.ts`: build GPT-5.6 SOL image-plus-web-search requests and validate exact-product research evidence.
- Create `src/productIdentity.ts`: reserve browser-persistent SKU and 10-digit EAN values for the single-operator scope.
- Create `tests/services/packy-responses.test.ts`: stream parser contract.
- Create `tests/services/product-research.test.ts`: research request, category, and evidence contract.
- Create `tests/product-identity.test.ts`: local counter and duplicate prevention.
- Modify `shared/product.ts`: shared research, identity, and generation-result types.
- Modify `server/services/productCopy.ts`: use the shared stream parser, accept verified research facts and source images, and enable web search.
- Modify `server/services/dszRules.ts`: orchestrate research, copy, deterministic fields, prices, and shipping without estimated package data.
- Modify `server/app.ts`: accept validated multipart full-field requests and map safe field-generation errors.
- Modify `src/productWorkflow.ts`: call the full-field route and validate its public response.
- Modify `src/App.tsx`: replace the copy-only task with complete-field state, merge field-by-field, and show evidence.
- Modify `src/styles.css`: style GPT-assisted markers and the evidence panel within the existing design language.
- Modify `vercel.json`: allow the sequential GPT-5.6 research/copy request up to 300 seconds.
- Modify `tests/services/product-copy.test.ts`, `tests/services/product-workflow.test.ts`, `tests/server/api.test.ts`, and `tests/App.test.tsx`: protect all changed contracts and independent workflow behaviour.

---

### Task 1: Extract a reusable Packy Responses stream parser

**Files:**
- Create: `server/services/packyResponses.ts`
- Create: `tests/services/packy-responses.test.ts`
- Modify: `server/services/productCopy.ts:225`
- Modify: `server/services/productCopy.ts:467`
- Test: `tests/services/product-copy.test.ts`

- [ ] **Step 1: Write the failing stream-parser tests**

```ts
import { describe, expect, test } from "vitest";
import { readPackyResponses } from "../../server/services/packyResponses";

function sse(events: unknown[]): Response {
  return new Response([
    ...events.map((event) => `data: ${JSON.stringify(event)}`),
    "data: [DONE]",
    ""
  ].join("\n\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

describe("Packy Responses stream parser", () => {
  test("joins text deltas and collects HTTPS URL annotations", async () => {
    const result = await readPackyResponses(sse([
      { type: "response.output_text.delta", delta: "first " },
      {
        type: "response.output_text.annotation.added",
        annotation: {
          type: "url_citation",
          url: "https://supplier.example.com/item"
        }
      },
      { type: "response.output_text.delta", delta: "second" }
    ]));

    expect(result).toEqual({
      text: "first second",
      annotatedUrls: ["https://supplier.example.com/item"]
    });
  });

  test("rejects malformed SSE JSON without exposing the line", async () => {
    const response = new Response("data: {private-invalid-json}\n\n", {
      headers: { "content-type": "text/event-stream" }
    });

    await expect(readPackyResponses(response)).rejects.toThrow(
      "Packy Responses API returned an invalid response."
    );
  });
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `npm test -- tests/services/packy-responses.test.ts`

Expected: FAIL because `server/services/packyResponses.ts` does not exist.

- [ ] **Step 3: Implement the reusable parser**

```ts
export interface PackyResponsesOutput {
  text: string;
  annotatedUrls: string[];
}

export async function readPackyResponses(
  response: Response
): Promise<PackyResponsesOutput> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await readJson(response);
    return { text: extractJsonText(data), annotatedUrls: [] };
  }

  const deltas: string[] = [];
  const annotatedUrls = new Set<string>();

  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line.slice(6)) as Record<string, unknown>;
    } catch {
      throw new Error("Packy Responses API returned an invalid response.");
    }

    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      deltas.push(event.delta);
    }

    if (event.type === "response.output_text.annotation.added") {
      const annotation = event.annotation;
      if (
        isRecord(annotation) &&
        typeof annotation.url === "string" &&
        isHttpsUrl(annotation.url)
      ) {
        annotatedUrls.add(annotation.url);
      }
    }
  }

  return { text: deltas.join(""), annotatedUrls: [...annotatedUrls] };
}
```

Move the existing JSON fallback helpers from `productCopy.ts` into the new file, keeping support for `output_text` and nested `output[].content[]`.

- [ ] **Step 4: Replace the private copy parser and verify GREEN**

In `productCopy.ts`, import `readPackyResponses` and replace:

```ts
const content = await readResponsesText(response);
```

with:

```ts
const { text: content } = await readPackyResponses(response);
```

Delete only the now-unused private response-reading helpers from `productCopy.ts`.

Run: `npm test -- tests/services/packy-responses.test.ts tests/services/product-copy.test.ts`

Expected: both test files PASS.

- [ ] **Step 5: Commit the parser extraction**

```bash
git add server/services/packyResponses.ts server/services/productCopy.ts tests/services/packy-responses.test.ts tests/services/product-copy.test.ts
git commit -m "refactor: share Packy Responses stream parsing"
```

---

### Task 2: Define shared product research and identity contracts

**Files:**
- Modify: `shared/product.ts`
- Create: `tests/services/product-research.test.ts`
- Create: `server/services/productResearch.ts`

- [ ] **Step 1: Write failing type-level and request-contract tests**

```ts
import { describe, expect, test } from "vitest";
import {
  buildProductResearchRequest,
  type ProductResearchImage
} from "../../server/services/productResearch";

const png: ProductResearchImage = {
  mimeType: "image/png",
  buffer: Buffer.from("89504e470d0a1a0a", "hex")
};

test("sends source images and the web search tool to GPT-5.6 SOL", async () => {
  const body = buildProductResearchRequest({
    input: { sellingPoints: "Multicolour stone and pearl necklace", images: [], imageUrls: [] },
    images: [png],
    fieldRules: "Current DSZ field rules.",
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    uploadSop: "Current full upload SOP.",
    productUploadAu: "Current Australian upload rules.",
    model: "gpt-5.6-sol"
  });

  expect(body).toMatchObject({ model: "gpt-5.6-sol", stream: true, tools: [{ type: "web_search" }] });
  expect(body.input[0].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "input_image" }),
    expect.objectContaining({ type: "input_text" })
  ]));
  expect(JSON.stringify(body)).toContain("Current DSZ field rules.");
  expect(JSON.stringify(body)).toContain("Current full upload SOP.");
});
```

- [ ] **Step 2: Run the research test and verify RED**

Run: `npm test -- tests/services/product-research.test.ts`

Expected: FAIL because the research module and shared types do not exist.

- [ ] **Step 3: Add shared public types**

Extend `ProductInput` with the optional manual field facts used by the precedence rule:

```ts
categoryId?: number;
categoryName?: string;
colour?: string;
```

Then append these public types to `shared/product.ts`:

```ts
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

export interface ProductGenerationResult {
  fields: DszProductFields;
  source: "ai";
  evidence?: ProductResearchEvidence;
  issues?: string[];
}
```

Replace the existing duplicate `ProductGenerationResult` declaration rather than declaring it twice.

- [ ] **Step 4: Implement the complete research request builder**

Create `server/services/productResearch.ts` with these exported boundaries:

```ts
import type { ProductInput, ProductResearchEvidence } from "../../shared/product.js";

export interface ProductResearchImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  buffer: Buffer;
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

export function buildProductResearchRequest(options: {
  input: ProductInput;
  images: ProductResearchImage[];
  fieldRules: string;
  categoryMapping: string;
  uploadSop: string;
  productUploadAu: string;
  model: string;
}) {
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
    input: [{ role: "user", content }],
    tools: [{ type: "web_search" as const }],
    store: false,
    stream: true
  };
}
```

Credential resolution and response parsing are added with the evidence gate in Task 3 so this task stays green after request construction.

- [ ] **Step 5: Verify the request contract passes**

Run: `npm test -- tests/services/product-research.test.ts -t "sends source images"`

Expected: PASS.

- [ ] **Step 6: Commit shared contracts and request construction**

```bash
git add shared/product.ts server/services/productResearch.ts tests/services/product-research.test.ts
git commit -m "feat: add GPT product research contract"
```

---

### Task 3: Enforce exact-product evidence and category mapping

**Files:**
- Modify: `server/services/productResearch.ts`
- Modify: `tests/services/product-research.test.ts`

- [ ] **Step 1: Add failing evidence-gate tests**

Add table-driven tests covering:

```ts
function researchFixture(options: {
  sourceUrl?: string;
  confidence?: "high" | "medium" | "low";
  exactProductMatch?: boolean;
  sourcePackageAvailable?: boolean;
  secondSourcePackage?: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number };
} = {}) {
  const sourceUrl = options.sourceUrl || "https://supplier.example.com/item";
  const packageFacts = { weightKg: 0.12, lengthCm: 12, widthCm: 8, heightCm: 3 };
  const sources = [{
    url: sourceUrl,
    title: "Supplier necklace listing",
    matchedVariant: "Multicolour",
    evidence: "The listing identifies the multicolour necklace and its retail package.",
    exactProductMatch: options.exactProductMatch ?? true,
    package: options.sourcePackageAvailable === false ? null : packageFacts
  }];
  if (options.secondSourcePackage) {
    sources.push({
      url: "https://manufacturer.example.com/item",
      title: "Manufacturer necklace listing",
      matchedVariant: "Multicolour",
      evidence: "The manufacturer page identifies the same multicolour necklace.",
      exactProductMatch: true,
      package: options.secondSourcePackage
    });
  }
  return {
    identity: {
      productType: "Tourmaline style stone and pearl necklace",
      variant: "Multicolour",
      matchSummary: "Source image and listing show the same necklace and colourway."
    },
    category: { id: 950, name: "Fashion / Women's Fashion / Women's Jewellery" },
    colour: "Multicolor",
    package: { ...packageFacts, confidence: options.confidence || "high" },
    sources,
    riskFlags: [],
    reviewNotes: []
  };
}

test.each([
  {
    name: "unannotated source",
    annotatedUrls: [] as string[],
    sourceUrl: "https://supplier.example.com/item",
    exactProductMatch: true,
    confidence: "high" as const,
    sourcePackageAvailable: true
  },
  {
    name: "non-HTTPS source",
    annotatedUrls: ["https://supplier.example.com/item"],
    sourceUrl: "http://supplier.example.com/item",
    exactProductMatch: true,
    confidence: "high" as const,
    sourcePackageAvailable: true
  },
  {
    name: "medium confidence",
    annotatedUrls: ["https://supplier.example.com/item"],
    sourceUrl: "https://supplier.example.com/item",
    exactProductMatch: true,
    confidence: "medium" as const,
    sourcePackageAvailable: true
  },
  {
    name: "similar product",
    annotatedUrls: ["https://supplier.example.com/item"],
    sourceUrl: "https://supplier.example.com/item",
    exactProductMatch: false,
    confidence: "high" as const,
    sourcePackageAvailable: true
  },
  {
    name: "source without published package facts",
    annotatedUrls: ["https://supplier.example.com/item"],
    sourceUrl: "https://supplier.example.com/item",
    exactProductMatch: true,
    confidence: "high" as const,
    sourcePackageAvailable: false
  }
])("does not accept package measurements from $name", ({
  annotatedUrls,
  sourceUrl,
  exactProductMatch,
  confidence,
  sourcePackageAvailable
}) => {
  const result = validateProductResearch({
    raw: researchFixture({
      sourceUrl,
      exactProductMatch,
      confidence,
      sourcePackageAvailable
    }),
    annotatedUrls,
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    input: { sellingPoints: "necklace", images: [], imageUrls: [] }
  });

  expect(result.package).toEqual({});
  expect(result.issues).toContain("Package weight and dimensions need verified same-product evidence.");
});

test("rejects conflicting exact-product package facts", () => {
  const result = validateProductResearch({
    raw: researchFixture({
      secondSourcePackage: { weightKg: 0.2, lengthCm: 14, widthCm: 9, heightCm: 4 }
    }),
    annotatedUrls: [
      "https://supplier.example.com/item",
      "https://manufacturer.example.com/item"
    ],
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    input: { sellingPoints: "necklace", images: [], imageUrls: [] }
  });

  expect(result.package).toEqual({});
  expect(result.issues).toContain("Package sources conflict and need review.");
});

test("accepts a category only when ID and path match the mapping", () => {
  expect(parseCategoryMapping("| Fashion / Women's Fashion / Women's Jewellery | 950 |"))
    .toEqual(new Map([[950, "Fashion / Women's Fashion / Women's Jewellery"]]));
});
```

- [ ] **Step 2: Run the evidence tests and verify RED**

Run: `npm test -- tests/services/product-research.test.ts`

Expected: FAIL because `validateProductResearch` and `parseCategoryMapping` are not exported or do not enforce the gate.

- [ ] **Step 3: Implement deterministic evidence validation**

Export these functions from `productResearch.ts`:

```ts
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
  const manualCategoryValid = manualCategoryName !== undefined &&
    (!options.input.categoryName || options.input.categoryName === manualCategoryName);
  const manualCategoryProvided = options.input.categoryId !== undefined ||
    Boolean(options.input.categoryName);
  const category = manualCategoryValid
    ? { id: options.input.categoryId as number, name: manualCategoryName }
    : generatedCategoryValid
      ? document.category
      : { id: 0, name: "" };
  const annotated = new Set(options.annotatedUrls);
  const exactSources = document.sources.filter(
    (source) => source.exactProductMatch && isHttpsUrl(source.url) && annotated.has(source.url)
  );
  const measuredExactSources = exactSources.filter(
    (source): source is ResearchSourceDocument & { package: ResearchPackage } =>
      source.package !== null
  );
  const packageSignature = (value: {
    weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
  }) => [value.weightKg, value.lengthCm, value.widthCm, value.heightCm].join("|");
  const sourceSignatures = new Set(
    measuredExactSources.map((source) => packageSignature(source.package))
  );
  const sourcesConflict = sourceSignatures.size > 1;
  const aggregateMatchesSources = sourceSignatures.has(packageSignature(document.package));
  const evidenceValid = document.package.confidence === "high" &&
    measuredExactSources.length > 0 &&
    !sourcesConflict && aggregateMatchesSources;
  const issues: string[] = [];

  if (manualCategoryProvided && !manualCategoryValid) {
    issues.push("The manual category ID/path is not in the current mapping.");
  }
  if (category.id === 0) issues.push("Category needs review because no valid ID and path match was found.");
  if (sourcesConflict) issues.push("Package sources conflict and need review.");

  const allowedColourWords = new Set([
    "Black", "White", "Red", "Blue", "Green", "Pink", "Purple", "Orange",
    "Yellow", "Grey", "Brown", "Beige", "Navy", "Silver", "Gold"
  ]);
  const requestedColour = options.input.colour || document.colour;
  const colourParts = requestedColour.split(" / ");
  const colourValid = requestedColour === "N/A" || requestedColour === "Multicolor" ||
    (colourParts.length >= 1 && colourParts.length <= 3 &&
      new Set(colourParts).size === colourParts.length &&
      colourParts.every((part) => allowedColourWords.has(part)));
  const colour = colourValid ? requestedColour : "N/A";
  if (colour === "N/A" && requestedColour !== "N/A") issues.push("Colour needs review.");

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
  const completePackage = Object.values(packageFacts).every((value) => value !== undefined);
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
  } as AcceptedProductResearch;
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
  if (!apiKey) throw new Error("Missing PACKY_TEXT_API_KEY or PACKY_API_KEY.");

  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(/\/+$/, "");
  const response = await (options.fetchImpl || fetch)(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  if (!response.ok) throw new Error(`Packy product research API failed: ${response.status}`);

  const output = await readPackyResponses(response);
  if (!output.text.trim()) throw new Error("Packy product research API returned empty content.");

  let raw: unknown;
  try {
    raw = JSON.parse(output.text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
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
```

Add these validation helpers immediately above the exports and import `readPackyResponses` plus the shared research types:

```ts
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
  identity: { productType: string; variant: string; matchSummary: string };
  category: { id: number; name: string };
  colour: string;
  package: {
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    confidence: "high" | "medium" | "low";
  };
  sources: ResearchSourceDocument[];
  riskFlags: string[];
  reviewNotes: string[];
}

function parseResearchDocument(value: unknown): ResearchDocument {
  if (!isRecord(value) || !isRecord(value.identity) || !isRecord(value.category) ||
      !isRecord(value.package) || !Array.isArray(value.sources) ||
      !Array.isArray(value.riskFlags) || !Array.isArray(value.reviewNotes)) {
    throw new Error("Packy product research API returned invalid content.");
  }
  const confidence = value.package.confidence;
  const sources = value.sources.filter(isResearchSource);
  if (
    !isNonemptyString(value.identity.productType) ||
    !isNonemptyString(value.identity.variant) ||
    !isNonemptyString(value.identity.matchSummary) ||
    typeof value.category.id !== "number" ||
    typeof value.category.name !== "string" ||
    typeof value.colour !== "string" ||
    !["high", "medium", "low"].includes(String(confidence)) ||
    sources.length !== value.sources.length ||
    !value.riskFlags.every(isNonemptyString) ||
    !value.reviewNotes.every(isNonemptyString)
  ) {
    throw new Error("Packy product research API returned invalid content.");
  }
  return {
    identity: value.identity as ResearchDocument["identity"],
    category: value.category as ResearchDocument["category"],
    colour: value.colour,
    package: {
      weightKg: Number(value.package.weightKg),
      lengthCm: Number(value.package.lengthCm),
      widthCm: Number(value.package.widthCm),
      heightCm: Number(value.package.heightCm),
      confidence: confidence as ResearchDocument["package"]["confidence"]
    },
    sources,
    riskFlags: value.riskFlags,
    reviewNotes: value.reviewNotes
  };
}

function isResearchSource(value: unknown): value is ResearchSourceDocument {
  return isRecord(value) && isNonemptyString(value.url) &&
    isNonemptyString(value.title) && isNonemptyString(value.matchedVariant) &&
    isNonemptyString(value.evidence) && typeof value.exactProductMatch === "boolean" &&
    (value.package === null ||
      (isRecord(value.package) && positiveNumber(value.package.weightKg) !== undefined &&
        positiveNumber(value.package.lengthCm) !== undefined &&
        positiveNumber(value.package.widthCm) !== undefined &&
        positiveNumber(value.package.heightCm) !== undefined));
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
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
```

Do not add default `0.1 kg` or `15 x 17 x 3 cm` values.

- [ ] **Step 4: Add and pass manual-fact precedence tests**

```ts
test("preserves verified manual measurements over web research", () => {
  const result = validateProductResearch({
    raw: researchFixture(),
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    input: {
      sellingPoints: "necklace",
      images: [],
      imageUrls: [],
      packageWeightKg: 0.2,
      lengthCm: 15,
      widthCm: 10,
      heightCm: 4
    }
  });

  expect(result.package).toEqual({ weightKg: 0.2, lengthCm: 15, widthCm: 10, heightCm: 4 });
});

test("preserves a mapped manual category and valid manual colour", () => {
  const result = validateProductResearch({
    raw: researchFixture(),
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    input: {
      sellingPoints: "necklace",
      images: [],
      imageUrls: [],
      categoryId: 950,
      categoryName: "Fashion / Women's Fashion / Women's Jewellery",
      colour: "Black / White / Beige"
    }
  });

  expect(result.category).toEqual({
    id: 950,
    name: "Fashion / Women's Fashion / Women's Jewellery"
  });
  expect(result.colour).toBe("Black / White / Beige");
});
```

Run: `npm test -- tests/services/product-research.test.ts`

Expected: all product-research tests PASS.

- [ ] **Step 5: Commit evidence validation**

```bash
git add server/services/productResearch.ts tests/services/product-research.test.ts
git commit -m "feat: require same-product research evidence"
```

---

### Task 4: Extend validated copy generation with research facts, images, and web search

**Files:**
- Modify: `server/services/productCopy.ts`
- Modify: `tests/services/product-copy.test.ts`

- [ ] **Step 1: Write a failing enriched-copy request test**

```ts
test("adds verified research facts, source images and web search without changing the system prompt", async () => {
  const fetchImpl = vi.fn(async () => new Response([
    `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: `${validTitle}\n${validDescription}`
    })}`,
    "data: [DONE]",
    ""
  ].join("\n\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  }));

  await generateProductCopyWithPacky({
    input: productInput(),
    verifiedResearchFacts: "Category: Women's Jewellery\nColour: Multicolor\nPackage weight kg: 0.12",
    images: [{ mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") }],
    env: { PACKY_TEXT_API_KEY: "text-key" },
    fetchImpl: fetchImpl as typeof fetch
  });

  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.instructions).toBe(exactSystemPrompt);
  expect(body.tools).toEqual([{ type: "web_search" }]);
  expect(body.input[0].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "input_image" }),
    expect.objectContaining({ type: "input_text", text: expect.stringContaining("Verified research facts") })
  ]));
});
```

- [ ] **Step 2: Run the enriched-copy test and verify RED**

Run: `npm test -- tests/services/product-copy.test.ts -t "adds verified research facts"`

Expected: FAIL because the options and request content are missing.

- [ ] **Step 3: Implement the minimal request extension**

Extend the options type with:

```ts
images?: Array<{ mimeType: "image/png" | "image/jpeg" | "image/webp"; buffer: Buffer }>;
verifiedResearchFacts?: string;
```

Build Responses content in this order:

```ts
const content = [
  ...(options.images || []).map((image) => ({
    type: "input_image" as const,
    image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`
  })),
  {
    type: "input_text" as const,
    text: [
      buildProductCopyInput(input),
      options.verifiedResearchFacts
        ? `Verified research facts:\n${options.verifiedResearchFacts}`
        : ""
    ].filter(Boolean).join("\n")
  }
];
```

Add `tools: [{ type: "web_search" }]` while retaining `stream: true`, the exact prompt, validation, and retry behaviour.

- [ ] **Step 4: Run all copy tests**

Run: `npm test -- tests/services/product-copy.test.ts`

Expected: all copy tests PASS and the exact prompt assertion remains unchanged.

- [ ] **Step 5: Commit enriched copy generation**

```bash
git add server/services/productCopy.ts tests/services/product-copy.test.ts
git commit -m "feat: ground product copy in researched facts"
```

---

### Task 5: Replace legacy full-field generation with the two-stage orchestrator

**Files:**
- Modify: `server/services/dszRules.ts:392-544`
- Modify: `shared/product.ts`
- Modify: `vercel.json`
- Modify: `tests/services/product-workflow.test.ts`

- [ ] **Step 1: Write a failing complete-field orchestration test**

Extend the test imports with `extractCanonicalProductFooter`, `loadProductSystemPrompt`,
and the `RuleDocuments` type. Add these file-level fixtures before the test:

```ts
const workflowPng = Buffer.from("89504e470d0a1a0a", "hex");
const workflowTitle = "Multicolour Tourmaline and Pearl Necklace - Layered Statement Design, Adjustable Everyday Styling, Gift Ready Jewellery";
const workflowFooter = extractCanonicalProductFooter(await loadProductSystemPrompt());
const workflowDescription = `<p><strong>Product Overview</strong></p><p>A multicolour necklace for everyday styling.</p>${workflowFooter}`;
const workflowRules: RuleDocuments = {
  fieldRules: "Current DSZ field rules.",
  productPrompt: await loadProductSystemPrompt(),
  categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
  uploadSop: "Current full product upload SOP.",
  productUploadAu: "Current Australian upload rules."
};

function workflowSse(events: unknown[]): Response {
  return new Response([
    ...events.map((event) => `data: ${JSON.stringify(event)}`),
    "data: [DONE]",
    ""
  ].join("\n\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function researchStream(confidence: "high" | "medium" = "high"): Response {
  const sourceUrl = "https://supplier.example.com/item";
  return workflowSse([
    {
      type: "response.output_text.delta",
      delta: JSON.stringify({
        identity: {
          productType: "Tourmaline style stone and pearl necklace",
          variant: "Multicolour",
          matchSummary: "The image and listing show the same necklace and colourway."
        },
        category: { id: 950, name: "Fashion / Women's Fashion / Women's Jewellery" },
        colour: "Multicolor",
        package: { weightKg: 0.12, lengthCm: 12, widthCm: 8, heightCm: 3, confidence },
        sources: [{
          url: sourceUrl,
          title: "Supplier necklace listing",
          matchedVariant: "Multicolour",
          evidence: "The listing supplies the retail package measurements.",
          exactProductMatch: true,
          package: { weightKg: 0.12, lengthCm: 12, widthCm: 8, heightCm: 3 }
        }],
        riskFlags: [],
        reviewNotes: []
      })
    },
    {
      type: "response.output_text.annotation.added",
      annotation: { type: "url_citation", url: sourceUrl }
    }
  ]);
}

function copyStream(): Response {
  return workflowSse([{
    type: "response.output_text.delta",
    delta: `${workflowTitle}\n${workflowDescription}`
  }]);
}

test("researches, writes copy and calculates deterministic DSZ fields", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(researchStream())
    .mockResolvedValueOnce(copyStream()) as unknown as typeof fetch;

  const result = await generateDszFieldsWithPacky({
    productInput: {
      sellingPoints: "Multicolour tourmaline style stone and pearl necklace",
      categoryHint: "Women's Jewellery",
      purchasePriceCny: 20,
      images: ["source.png"],
      imageUrls: []
    },
    images: [{ mimeType: "image/png", buffer: workflowPng }],
    identity: { sku: "Elosung10000", eanCode: "4748549810" },
    env: { PACKY_TEXT_API_KEY: "text-key" },
    fetchImpl,
    ruleDocuments: workflowRules
  });

  expect(result.fields).toMatchObject({
    category: 950,
    categories: "950",
    categoryName: "Fashion / Women's Fashion / Women's Jewellery",
    product_name: workflowTitle,
    sku: "Elosung10000",
    status: 1,
    ean_code: "4748549810",
    stock: 1000,
    weight: 0.12,
    length: 12,
    width: 8,
    height: 3,
    brand_name: "Elosung",
    colour: "Multicolor",
    enabled: true,
    description: workflowDescription
  });
  expect(result.fields.cbm).toBe(calculateCbm(12, 8, 3));
  expect(result.fields.vendor_price).toBe(calculateVendorPrice({
    weightKg: 0.12,
    lengthCm: 12,
    widthCm: 8,
    heightCm: 3,
    purchasePriceCny: 20
  }));
  expect(result.fields.zone_rates.nz).toBe(20);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the orchestration test and verify RED**

Run: `npm test -- tests/services/product-workflow.test.ts -t "researches, writes copy"`

Expected: FAIL because the old function calls `/v1/chat/completions` and does not accept images or identity.

- [ ] **Step 3: Implement the two-stage orchestration**

Change the public signature to:

```ts
export async function generateDszFieldsWithPacky(input: {
  productInput: ProductInput;
  images: ProductResearchImage[];
  identity: ProductIdentity;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  ruleDocuments?: RuleDocuments;
}): Promise<ProductGenerationResult>
```

The function must:

1. validate `identity.sku` and `identity.eanCode`;
2. call `generateProductResearchWithPacky`;
3. format only accepted research as copy facts;
4. call `generateProductCopyWithPacky` with the exact prompt, images, and verified facts;
5. calculate CBM, vendor price, RRP, and zone rates in code;
6. return empty price values plus an issue when purchase price is absent;
7. return empty unresolved measurements plus an issue when evidence was rejected;
8. never call `buildFallbackFields` for invented package measurements.

After the new path is green, remove the now-unreferenced Chat Completions-only code from
`dszRules.ts`: its local `ChatMessage` contract, legacy field prompt builders/parsers,
description-repair path, fallback field/category heuristics, and `formatSku`. Preserve
`RuleDocuments`, rule loading, price/CBM/shipping calculations, and any helper still
referenced by those boundaries. Confirm removals with `rg` before deleting each export.

Build the returned fields explicitly:

```ts
if (!/^Elosung1\d{4}$/.test(input.identity.sku) ||
    !/^\d{10}$/.test(input.identity.eanCode)) {
  throw new Error("Product identity is invalid");
}
const ruleDocuments = input.ruleDocuments || await loadRuleDocuments(input.env);
const research = await generateProductResearchWithPacky({
  input: input.productInput,
  images: input.images,
  fieldRules: ruleDocuments.fieldRules,
  categoryMapping: ruleDocuments.categoryMapping,
  uploadSop: ruleDocuments.uploadSop,
  productUploadAu: ruleDocuments.productUploadAu,
  env: input.env,
  fetchImpl: input.fetchImpl
});
const weight = research.package.weightKg || 0;
const length = research.package.lengthCm || 0;
const width = research.package.widthCm || 0;
const height = research.package.heightCm || 0;
const hasMeasurements = [weight, length, width, height].every((value) => value > 0);
const purchasePrice = input.productInput.purchasePriceCny;
const hasPriceInputs = hasMeasurements && typeof purchasePrice === "number" && purchasePrice > 0;
const vendorPrice = hasPriceInputs
  ? calculateVendorPrice({
      weightKg: weight,
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      purchasePriceCny: purchasePrice
    })
  : 0;
const verifiedResearchFacts = [
  `Product type: ${research.evidence.productType}`,
  `Variant: ${research.evidence.variant}`,
  research.category.id > 0 ? `Category: ${research.category.name}` : "",
  research.colour !== "N/A" ? `Colour: ${research.colour}` : "",
  hasMeasurements ? `Package weight kg: ${weight}` : "",
  hasMeasurements ? `Package dimensions cm: ${length} x ${width} x ${height}` : ""
].filter(Boolean).join("\n");
const copy = await generateProductCopyWithPacky({
  input: input.productInput,
  images: input.images,
  verifiedResearchFacts,
  env: input.env,
  fetchImpl: input.fetchImpl
});
const issues = [...research.issues];
if (!hasPriceInputs) {
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
  cbm: hasMeasurements ? calculateCbm(length, width, height) : 0,
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
```

- [ ] **Step 4: Replace fallback-expectation tests with no-estimate tests**

```ts
test("does not estimate package measurements when research has no exact evidence", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(researchStream("medium"))
    .mockResolvedValueOnce(copyStream()) as unknown as typeof fetch;
  const result = await generateDszFieldsWithPacky({
    productInput: {
      sellingPoints: "Multicolour tourmaline style stone and pearl necklace",
      categoryHint: "Women's Jewellery",
      purchasePriceCny: 20,
      images: ["source.png"],
      imageUrls: []
    },
    images: [{ mimeType: "image/png", buffer: workflowPng }],
    identity: { sku: "Elosung10000", eanCode: "4748549810" },
    env: { PACKY_TEXT_API_KEY: "text-key" },
    fetchImpl,
    ruleDocuments: workflowRules
  });

  expect(result.fields).toMatchObject({ weight: 0, length: 0, width: 0, height: 0, cbm: 0 });
  expect(result.issues).toContain("Package weight and dimensions need verified same-product evidence.");
});
```

Delete tests that exist only for the removed legacy prompt, description repair, or local
category/fallback heuristics. Migrate their still-valid intent into the new request and
orchestrator tests: bundled rule files are included, explicit manual category facts win,
and both GPT-5.6 requests use `PACKY_TEXT_API_KEY` plus `PACKY_TEXT_MODEL`. Assert neither
request reads or sends `PACKY_IMAGE_API_KEY`.

Run: `npm test -- tests/services/product-workflow.test.ts`

Expected: all workflow service tests PASS.

- [ ] **Step 5: Commit the orchestrator**

Before committing, add `"maxDuration": 300` beside `includeFiles` in the existing
`functions["api/index.ts"]` object and run `npm run build`. This keeps the two sequential
GPT-5.6 calls inside the current Vercel duration contract.

```bash
git add shared/product.ts server/services/dszRules.ts tests/services/product-workflow.test.ts vercel.json
git commit -m "feat: generate complete evidence-backed product fields"
```

---

### Task 6: Convert the full-field API route to validated multipart input

**Files:**
- Modify: `server/app.ts:63-71`
- Modify: `server/app.ts:272-297`
- Modify: `tests/server/api.test.ts`

- [ ] **Step 1: Write failing multipart API tests**

```ts
test("passes validated source images, product facts and identity to full-field generation", async () => {
  const evidence: ProductResearchEvidence = {
    productType: "Cotton thong underwear",
    variant: "Black / White / Beige",
    matchSummary: "The uploaded image matches the cited supplier listing.",
    confidence: "high",
    sources: [{
      url: "https://supplier.example.com/item",
      title: "Supplier product listing",
      matchedVariant: "Black / White / Beige",
      evidence: "The listing supplies the same variant and package facts."
    }]
  };
  const generateProductFields = vi.fn(async () => ({
    fields,
    source: "ai" as const,
    evidence,
    issues: []
  }));

  const response = await request(createApp({ generateProductFields }))
    .post("/api/generate-product-fields")
    .field("input", JSON.stringify(productInput))
    .field("identity", JSON.stringify({ sku: "Elosung10000", eanCode: "4748549810" }))
    .attach("images", pngImage, { filename: "product.png", contentType: "image/png" })
    .expect(200);

  expect(generateProductFields).toHaveBeenCalledWith({
    productInput,
    images: [expect.objectContaining({ mimetype: "image/png" })],
    identity: { sku: "Elosung10000", eanCode: "4748549810" }
  });
  expect(response.body.result.issues).toEqual([]);
});
```

Import `ProductResearchEvidence` from the shared product module. Reuse the existing
file-level `productInput`, `pngImage`, and `fields` fixtures. Add rejection tests for
missing files, invalid image signatures, invalid JSON fields, invalid SKU, invalid
10-digit EAN, an aggregate image payload above 4,000,000 bytes, and truncated multipart bodies.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -- tests/server/api.test.ts -t "full-field generation"`

Expected: FAIL because the route still expects JSON and uploaded URLs.

- [ ] **Step 3: Implement multipart parsing and safe validation**

Change the dependency boundary to:

```ts
generateProductFields?: (input: {
  productInput: ProductInput;
  images: Express.Multer.File[];
  identity: ProductIdentity;
}) => Promise<ProductGenerationResult>;
```

Change the route to:

```ts
app.post(
  "/api/generate-product-fields",
  upload.array("images", 4),
  async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];
      const productInput = parseMultipartProductInput(req.body.input);
      const identity = parseProductIdentity(req.body.identity);

      if (files.length === 0) {
        res.status(400).json({ error: "At least one source image file is required" });
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
        ? await dependencies.generateProductFields({ productInput, images: files, identity })
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
```

Add the parsers used by the route:

```ts
class ProductFieldRequestError extends Error {}

function parseMultipartProductInput(value: unknown): ProductInput {
  if (typeof value !== "string") {
    throw new ProductFieldRequestError("Product input is required");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch {
    throw new ProductFieldRequestError("Product input is invalid");
  }
  const validation = parseProductInput(parsed);
  if (!validation.valid) throw new ProductFieldRequestError(validation.error);
  return validation.input;
}

function parseProductIdentity(value: unknown): ProductIdentity {
  if (typeof value !== "string") {
    throw new ProductFieldRequestError("Product identity is required");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch {
    throw new ProductFieldRequestError("Product identity is invalid");
  }
  const skuMatch = isRecord(parsed) && typeof parsed.sku === "string"
    ? /^Elosung(\d{5})$/.exec(parsed.sku)
    : null;
  const skuNumber = skuMatch ? Number(skuMatch[1]) : 0;
  if (!isRecord(parsed) || typeof parsed.sku !== "string" ||
      typeof parsed.eanCode !== "string" ||
      skuNumber < 10000 || skuNumber > 19999 || !/^\d{10}$/.test(parsed.eanCode)) {
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
```

Extend the existing `parseProductInput` whitelist with these checks, then copy the valid
values into the returned `ProductInput`:

```ts
if (value.categoryId !== undefined &&
    (!Number.isInteger(value.categoryId) || Number(value.categoryId) <= 0)) {
  return { valid: false, error: "Category ID is invalid" };
}
if (value.categoryName !== undefined &&
    (typeof value.categoryName !== "string" || value.categoryName.length > 500)) {
  return { valid: false, error: "Category name is invalid" };
}
if (value.colour !== undefined &&
    (typeof value.colour !== "string" || value.colour.length > 100)) {
  return { valid: false, error: "Colour is invalid" };
}

if (value.categoryId !== undefined) input.categoryId = Number(value.categoryId);
if (value.categoryName !== undefined) input.categoryName = value.categoryName as string;
if (value.colour !== undefined) input.colour = value.colour as string;
```

Place the three validation blocks before the existing `const input` declaration and the
three assignments after it. Add malformed-value API tests so these fields cannot bypass
the research validator.

Use `images: files.map(toResearchImage)` in the default adapter call. Extend the safe error kind to `"copy" | "fields" | "image"` and add this branch near the top of `mapGenerationError`:

```ts
if (kind === "fields" && error instanceof ProductFieldRequestError) {
  return { status: 400, message: error.message };
}
if (kind === "fields" && error instanceof TypeError) {
  return { status: 503, message: "Packy product field generation unavailable" };
}
if (kind === "fields" &&
    (/^Packy product (research|copy) API /i.test(error.message) ||
      /^Product copy response /i.test(error.message))) {
  const statusMatch = error.message.match(/failed:\s*(\d{3})/);
  const providerStatus = statusMatch ? Number(statusMatch[1]) : 502;
  return {
    status: providerStatus === 429 ? 429 : providerStatus >= 500 ? 503 : 502,
    message: "Packy product field generation failed"
  };
}
```

- [ ] **Step 4: Run all server API tests**

Run: `npm test -- tests/server/api.test.ts`

Expected: all API tests PASS; copy and image routes remain independent.

- [ ] **Step 5: Commit the multipart API**

```bash
git add server/app.ts tests/server/api.test.ts
git commit -m "feat: accept source images for full field generation"
```

---

### Task 7: Add browser-persistent SKU and EAN reservation

**Files:**
- Create: `src/productIdentity.ts`
- Create: `tests/product-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { reserveProductIdentity } from "../src/productIdentity";

describe("product identity reservation", () => {
  beforeEach(() => localStorage.clear());

  test("increments Elosung SKU values across reservations", () => {
    const first = reserveProductIdentity(() => 0.123456789);
    const second = reserveProductIdentity(() => 0.987654321);

    expect(first.sku).toBe("Elosung10000");
    expect(second.sku).toBe("Elosung10001");
  });

  test("stores and avoids previously generated 10-digit EAN values", () => {
    localStorage.setItem("dsz.usedEans", JSON.stringify(["1234567890"]));
    const values = [0.123456789, 0.234567891];
    const identity = reserveProductIdentity(() => values.shift() || 0.345678912);

    expect(identity.eanCode).toMatch(/^\d{10}$/);
    expect(identity.eanCode).not.toBe("1234567890");
  });

  test("fails instead of reusing an exhausted SKU range", () => {
    localStorage.setItem("dsz.skuCounter", "20000");
    expect(() => reserveProductIdentity()).toThrow("SKU range is exhausted");
  });
});
```

- [ ] **Step 2: Run identity tests and verify RED**

Run: `npm test -- tests/product-identity.test.ts`

Expected: FAIL because the identity module does not exist.

- [ ] **Step 3: Implement the local single-operator store**

```ts
import type { ProductIdentity } from "../shared/product";

const SKU_KEY = "dsz.skuCounter";
const EAN_KEY = "dsz.usedEans";

export function reserveProductIdentity(random = Math.random): ProductIdentity {
  const counter = readCounter(localStorage.getItem(SKU_KEY));
  if (counter > 19999) throw new Error("SKU range is exhausted");
  const sku = `Elosung${counter}`;
  localStorage.setItem(SKU_KEY, String(counter + 1));

  const used = new Set<string>(readUsedEans(localStorage.getItem(EAN_KEY)));
  let eanCode = "";
  for (let attempt = 0; attempt < 100 && !eanCode; attempt += 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) continue;
    const candidate = String(Math.floor(sample * 10_000_000_000)).padStart(10, "0");
    if (!used.has(candidate)) eanCode = candidate;
  }
  if (!eanCode) throw new Error("Unable to reserve a unique EAN code");
  used.add(eanCode);
  localStorage.setItem(EAN_KEY, JSON.stringify([...used]));

  return { sku, eanCode };
}

function readCounter(value: string | null): number {
  if (value === null) return 10000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10000 || parsed > 20000) {
    throw new Error("Stored SKU counter is invalid");
  }
  return parsed;
}

function readUsedEans(value: string | null): string[] {
  if (value === null) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch {
    throw new Error("Stored EAN reservations are invalid");
  }
  if (!Array.isArray(parsed) || !parsed.every((item) =>
    typeof item === "string" && /^\d{10}$/.test(item))) {
    throw new Error("Stored EAN reservations are invalid");
  }
  return parsed;
}
```

The helpers start a missing counter at `10000`, accept the exhaustion sentinel `20000`,
and reject corrupt state instead of resetting to values that could duplicate earlier
identities. Do not add cross-device storage.

- [ ] **Step 4: Run identity tests**

Run: `npm test -- tests/product-identity.test.ts`

Expected: all identity tests PASS.

- [ ] **Step 5: Commit identity persistence**

```bash
git add src/productIdentity.ts tests/product-identity.test.ts
git commit -m "feat: reserve local product identities"
```

---

### Task 8: Add the full-field client adapter

**Files:**
- Modify: `src/productWorkflow.ts`
- Modify: `tests/services/product-workflow.test.ts`

- [ ] **Step 1: Write a failing client adapter test**

```ts
test("posts source files, facts and identity to the full-field endpoint", async () => {
  const evidence: ProductResearchEvidence = {
    productType: "Cotton thong underwear",
    variant: "Black / White / Beige",
    matchSummary: "The source image matches the cited supplier listing.",
    confidence: "high",
    sources: [{
      url: "https://supplier.example.com/item",
      title: "Supplier product listing",
      matchedVariant: "Black / White / Beige",
      evidence: "The listing supplies the same variant and package facts."
    }]
  };
  const sourceFile = new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ], "product.png", { type: "image/png" });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    result: {
      fields: { ...fields, providerDebug: "discard-me" },
      source: "ai",
      evidence,
      issues: [],
      providerDebug: "discard-me"
    }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await requestProductFields({
    input,
    files: [sourceFile],
    identity: { sku: "Elosung10000", eanCode: "4748549810" }
  });

  expect(fetchMock.mock.calls[0][0]).toBe("/api/generate-product-fields");
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(body.getAll("images")).toHaveLength(1);
  expect(JSON.parse(String(body.get("identity")))).toEqual({
    sku: "Elosung10000",
    eanCode: "4748549810"
  });
  expect(result).not.toHaveProperty("providerDebug");
  expect(result.fields).not.toHaveProperty("providerDebug");
});
```

Extend the imports with `requestProductFields`, `ProductResearchEvidence`, and
`ProductIdentity`, plus `AU_ZONE_KEYS` from `shared/shipping`. Reuse the existing
file-level `input` and `fields` fixtures.

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `npm test -- tests/services/product-workflow.test.ts -t "posts source files"`

Expected: FAIL because `requestProductFields` does not exist.

- [ ] **Step 3: Implement and validate the public response**

```ts
export async function requestProductFields(input: {
  input: ProductInput;
  files: File[];
  identity: ProductIdentity;
}, signal?: AbortSignal): Promise<ProductGenerationResult> {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("input", JSON.stringify(input.input));
  form.append("identity", JSON.stringify(input.identity));

  const data = await requestJson("/api/generate-product-fields", {
    method: "POST",
    body: form,
    signal
  }, "完整商品资料生成失败");

  if (!isRecord(data) || !isProductGenerationResult(data.result)) {
    throw new Error("完整商品资料生成失败");
  }
  return toPublicGenerationResult(data.result);
}
```

Add these response guards in the same file:

```ts
const DSZ_ZONE_KEYS = [...AU_ZONE_KEYS, "nz"] as const;

function isProductGenerationResult(value: unknown): value is ProductGenerationResult {
  if (!isRecord(value) || !isDszProductFields(value.fields) || value.source !== "ai") return false;
  if (value.issues !== undefined &&
      (!Array.isArray(value.issues) || !value.issues.every(isNonemptyString))) return false;
  return value.evidence === undefined || isResearchEvidence(value.evidence);
}

function isDszProductFields(value: unknown): value is DszProductFields {
  if (!isRecord(value) || !isRecord(value.zone_rates)) return false;
  const zoneRates = value.zone_rates;
  const strings = ["categories", "categoryName", "product_name", "sku", "ean_code",
    "brand_name", "colour", "description"];
  const numbers = ["category", "status", "stock", "weight", "length", "width", "height",
    "cbm", "vendor_price", "rrp"];
  return strings.every((key) => typeof value[key] === "string") &&
    numbers.every((key) => typeof value[key] === "number" &&
      Number.isFinite(value[key]) && Number(value[key]) >= 0) &&
    Number.isInteger(Number(value.category)) && value.status === 1 && value.stock === 1000 &&
    (value.category === 0
      ? value.categories === "" && value.categoryName === ""
      : value.categories === String(value.category) && isNonemptyString(value.categoryName)) &&
    /^Elosung1\d{4}$/.test(value.sku as string) && /^\d{10}$/.test(value.ean_code as string) &&
    value.brand_name === "Elosung" && value.enabled === true &&
    DSZ_ZONE_KEYS.every((key) =>
      typeof zoneRates[key] === "number" && Number.isFinite(zoneRates[key])) &&
    Array.isArray(value.images) && value.images.every((url) => typeof url === "string") &&
    Array.isArray(value.risk_flags) && value.risk_flags.every(isNonemptyString) &&
    Array.isArray(value.review_notes) && value.review_notes.every(isNonemptyString);
}

function isResearchEvidence(value: unknown): value is ProductResearchEvidence {
  return isRecord(value) && typeof value.productType === "string" &&
    typeof value.variant === "string" && typeof value.matchSummary === "string" &&
    ["high", "medium", "low"].includes(String(value.confidence)) &&
    Array.isArray(value.sources) && value.sources.every((source) =>
      isRecord(source) && isHttpsUrl(String(source.url)) &&
      [source.title, source.matchedVariant, source.evidence].every((item) => typeof item === "string")
    );
}

function toPublicGenerationResult(value: ProductGenerationResult): ProductGenerationResult {
  const sourceFields = value.fields;
  const fields: DszProductFields = {
    category: sourceFields.category,
    categories: sourceFields.categories,
    categoryName: sourceFields.categoryName,
    product_name: sourceFields.product_name,
    sku: sourceFields.sku,
    status: sourceFields.status,
    ean_code: sourceFields.ean_code,
    stock: sourceFields.stock,
    weight: sourceFields.weight,
    length: sourceFields.length,
    width: sourceFields.width,
    height: sourceFields.height,
    cbm: sourceFields.cbm,
    brand_name: sourceFields.brand_name,
    colour: sourceFields.colour,
    enabled: sourceFields.enabled,
    description: sourceFields.description,
    vendor_price: sourceFields.vendor_price,
    rrp: sourceFields.rrp,
    zone_rates: Object.fromEntries(
      DSZ_ZONE_KEYS.map((key) => [key, sourceFields.zone_rates[key]])
    ),
    images: [...sourceFields.images],
    risk_flags: [...sourceFields.risk_flags],
    review_notes: [...sourceFields.review_notes]
  };
  return {
    fields,
    source: "ai",
    ...(value.evidence ? {
      evidence: {
        productType: value.evidence.productType,
        variant: value.evidence.variant,
        matchSummary: value.evidence.matchSummary,
        confidence: value.evidence.confidence,
        sources: value.evidence.sources.map((source) => ({
          url: source.url,
          title: source.title,
          matchedVariant: source.matchedVariant,
          evidence: source.evidence
        }))
      }
    } : {}),
    ...(value.issues ? { issues: [...value.issues] } : {})
  };
}
```

The explicit constructor drops arbitrary server/debug properties before state or upload code can retain them.

- [ ] **Step 4: Run client workflow tests**

Run: `npm test -- tests/services/product-workflow.test.ts`

Expected: all workflow adapter and existing upload tests PASS.

- [ ] **Step 5: Commit the client adapter**

```bash
git add src/productWorkflow.ts tests/services/product-workflow.test.ts
git commit -m "feat: request complete product field generation"
```

---

### Task 9: Apply complete fields without overwriting manual edits

**Files:**
- Modify: `src/App.tsx:20-75`
- Modify: `src/App.tsx:430-630`
- Modify: `src/App.tsx:700-930`
- Modify: `tests/App.test.tsx`

- [ ] **Step 1: Write failing one-button complete-field tests**

```tsx
const completeFields: DszProductFields = {
  category: 950,
  categories: "950",
  categoryName: "Fashion / Women's Fashion / Women's Jewellery",
  product_name: "Multicolour Stone and Pearl Necklace - Layered Summer Jewellery for Everyday Styling and Gift Ready Outfits",
  sku: "Elosung10000",
  status: 1,
  ean_code: "4748549810",
  stock: 1000,
  weight: 0.12,
  length: 12,
  width: 8,
  height: 3,
  cbm: 0.000288,
  brand_name: "Elosung",
  colour: "Multicolor",
  enabled: true,
  description: "<p><strong>Product Overview</strong></p><p>Necklace.</p>",
  vendor_price: 22.89,
  rrp: 45.78,
  zone_rates: buildShippingZoneRates({ actualWeightKg: 0.12, lengthCm: 12, widthCm: 8, heightCm: 3 }),
  images: [],
  risk_flags: [],
  review_notes: []
};

const evidence: ProductResearchEvidence = {
  productType: "Necklace",
  variant: "Multicolour",
  matchSummary: "Exact supplier variant",
  confidence: "high",
  sources: [{
    url: "https://supplier.example.com/item",
    title: "Supplier necklace",
    matchedVariant: "Multicolour",
    evidence: "Package 12 x 8 x 3 cm, 0.12 kg"
  }]
};

test("one click fills complete DSZ fields while image roles stay independent", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", appFetch(async (url, init) => {
    if (url === "/api/generate-product-fields") {
      return response({ result: { fields: completeFields, source: "ai", evidence, issues: [] } });
    }
    if (url === "/api/generate-product-image-role") {
      const role = roleFromRequest(init);
      return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<App />);
  await fillRequiredInputs(user);
  await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

  expect(await screen.findByDisplayValue(completeFields.product_name)).toBeInTheDocument();
  expect(screen.getByLabelText("Category")).toHaveValue(completeFields.categories);
  expect(screen.getByLabelText("SKU")).toHaveValue(completeFields.sku);
  expect(screen.getByLabelText("EAN Code")).toHaveValue(completeFields.ean_code);
  expect(screen.getByLabelText("Package Weight kg")).toHaveValue(completeFields.weight);
  expect(screen.getByLabelText("Colour")).toHaveValue(completeFields.colour);
  await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
});
```

Add two ownership tests:

1. Enter Category and Colour before generation, then verify both values remain while untouched fields update.
2. Start a deferred full-field request, edit Category and Colour before resolving it, then verify both values remain while untouched fields update.

- [ ] **Step 2: Run focused App tests and verify RED**

Run: `npm test -- tests/App.test.tsx -t "fills complete DSZ fields|manual complete-field edits"`

Expected: FAIL because the app still calls `/api/generate-product-copy` and applies only title/description.

- [ ] **Step 3: Replace the copy task with the complete-field task**

Import `requestProductFields` and `reserveProductIdentity`. Keep the existing independent task state but rename the user-visible copy task to product data and copy.
Change the GPT-5.6 card heading from `Title & description` to
`Complete product data & copy`; the GPT-Image-2 card and its five role states stay separate.

Track manual ownership as well as in-flight edit versions. A manual category owns its ID
fields while the mapped name is accepted only when the returned ID matches. Package
measurements stay manual, while CBM and shipping may apply the server's deterministic
calculation over the final accepted measurement set:

```ts
const fieldEditVersionsRef = useRef<Record<keyof DszProductFields, number>>(
  Object.fromEntries(Object.keys(initialFields).map((key) => [key, 0])) as
    Record<keyof DszProductFields, number>
);
const manualFieldsRef = useRef(new Set<keyof DszProductFields>());

function markManualField(
  field: keyof DszProductFields,
  value: string | number | boolean
) {
  const requiresPositiveNumber = [
    "categories", "weight", "length", "width", "height", "vendor_price", "rrp"
  ].includes(String(field));
  const cleared = typeof value === "string"
    ? value.trim() === "" || (requiresPositiveNumber && !(Number(value) > 0))
    : typeof value === "number" && requiresPositiveNumber
      ? !(value > 0)
      : false;
  if (cleared) manualFieldsRef.current.delete(field);
  else manualFieldsRef.current.add(field);
  if (field === "categories") {
    if (cleared) manualFieldsRef.current.delete("category");
    else manualFieldsRef.current.add("category");
  }
}

function updateField(field: keyof DszProductFields, value: string | number | boolean) {
  markManualField(field, value);
  fieldEditVersionsRef.current[field] += 1;
  // Keep existing invalidation, CBM and shipping recalculation logic.
}

function applyGeneratedFields(
  generated: DszProductFields,
  versionsAtStart: Record<keyof DszProductFields, number>
) {
  setFields((current) => {
    const next = { ...current };
    for (const key of Object.keys(generated) as Array<keyof DszProductFields>) {
      if (key === "categoryName" && manualFieldsRef.current.has("categories")) {
        next.categoryName = generated.categories === current.categories
          ? generated.categoryName
          : "";
        continue;
      }
      if (!manualFieldsRef.current.has(key) &&
          fieldEditVersionsRef.current[key] === versionsAtStart[key]) {
        Object.assign(next, { [key]: generated[key] });
      }
    }
    return next;
  });
}
```

At task start, reuse a valid existing SKU and EAN on retry. If either component is
missing, reserve a new pair and retain any valid manually entered component when building
the request identity; consuming an unused counterpart is acceptable and safer than
reusing it later. Write the chosen SKU/EAN components into field state before the network
call so a failed request and subsequent full-field retry reuse the same identity. Call
`requestProductFields` with source files and that identity.
Apply fields, store evidence, and set `Needs attention` when `issues` is non-empty.
Clear prior evidence/issues when a new full-field operation starts or product/source input
invalidates that operation; image-only retries must not clear them.

Before starting either parallel workflow, reject when the selected files exceed four or
their aggregate `size` exceeds `4_000_000`. Add an App test for the aggregate limit and
use the same batch for both the full-field and image-role requests; this prevents a
one-button request from crossing Vercel's 4.5 MB function-body ceiling.

Also include existing manual field facts when building `ProductInput` so the server and
copy stage use the same accepted values:

```ts
categoryId: fieldSnapshot.category || undefined,
categoryName: fieldSnapshot.categoryName || undefined,
colour: fieldSnapshot.colour || undefined,
packageWeightKg: fieldSnapshot.weight || undefined,
lengthCm: fieldSnapshot.length || undefined,
widthCm: fieldSnapshot.width || undefined,
heightCm: fieldSnapshot.height || undefined
```

- [ ] **Step 4: Preserve independent retry semantics**

Change the text retry label to `重试完整商品资料` and ensure it calls only `/api/generate-product-fields`. Keep all five generated image URLs and role call counts unchanged in the existing retry test.
Assert that the `identity` multipart field is identical on the failed request and retry.

Run: `npm test -- tests/App.test.tsx -t "complete DSZ fields|manual complete-field edits|retry calls fields only"`

Expected: focused tests PASS.

- [ ] **Step 5: Run the complete App test file**

Run: `npm test -- tests/App.test.tsx`

Expected: all App tests PASS after updating old copy-only request expectations to the new full-field route without weakening image independence assertions.

- [ ] **Step 6: Commit complete-field application**

```bash
git add src/App.tsx tests/App.test.tsx
git commit -m "feat: apply generated product fields safely"
```

---

### Task 10: Render research evidence and field ownership clearly

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/App.test.tsx`

- [ ] **Step 1: Write a failing evidence UI test**

```tsx
test("shows safe research evidence and unresolved issues", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", appFetch(async (url, init) => {
    if (url === "/api/generate-product-fields") {
      return response({
        result: {
          fields: { ...completeFields, vendor_price: 0, rrp: 0 },
          source: "ai",
          evidence,
          issues: ["Purchase price is required to calculate Vendor Price and RRP."]
        }
      });
    }
    if (url === "/api/generate-product-image-role") {
      const role = roleFromRequest(init);
      return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<App />);
  await fillRequiredInputs(user);
  await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

  expect(await screen.findByRole("heading", { name: "Research evidence" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Supplier necklace" })).toHaveAttribute(
    "href",
    "https://supplier.example.com/item"
  );
  expect(screen.getByText(/Purchase price is required/)).toBeVisible();
  expect(screen.getByTestId("copy-task-status")).toHaveTextContent("Needs attention");
});
```

- [ ] **Step 2: Run the evidence UI test and verify RED**

Run: `npm test -- tests/App.test.tsx -t "shows safe research evidence"`

Expected: FAIL because the evidence panel is missing.

- [ ] **Step 3: Add the minimal evidence panel and ownership labels**

Render a compact panel below the GPT-5.6 status card:

```tsx
{researchEvidence && (
  <section className="research-evidence" aria-labelledby="research-evidence-heading">
    <h3 id="research-evidence-heading">Research evidence</h3>
    <p>{researchEvidence.matchSummary}</p>
    <span>{researchEvidence.confidence} confidence</span>
    <ul>
      {researchEvidence.sources.filter((source) => isHttpsUrl(source.url)).map((source) => (
        <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
          <small>{source.evidence}</small>
        </li>
      ))}
    </ul>
  </section>
)}
```

Label Category, Product Name, Colour, package measurements, and Description as GPT-assisted. Label CBM, price, RRP, fixed identity fields, and shipping as rule-calculated. Do not include evidence in `fields` or the upload payload.
Add a short SKU/EAN note that uniqueness is browser-local for the current single-operator scope.

- [ ] **Step 4: Style within the existing design system**

Add only scoped classes such as:

```css
.research-evidence {
  border: 1px solid var(--line);
  background: var(--panel-soft);
  padding: 14px;
}

.research-evidence a {
  color: var(--accent);
  overflow-wrap: anywhere;
}

.field-origin {
  color: var(--muted);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
```

Use existing CSS variables; do not restyle unrelated controls.

- [ ] **Step 5: Run UI tests and build**

Run independently:

```bash
npm test -- tests/App.test.tsx
npm run build
```

Expected: App tests PASS and Vite production build exits 0.

- [ ] **Step 6: Commit evidence UI**

```bash
git add src/App.tsx src/styles.css tests/App.test.tsx
git commit -m "feat: show product research evidence"
```

---

### Task 11: Full regression, production verification, and deployment

**Files:**
- Modify only files required by failures directly caused by Tasks 1-10.

- [ ] **Step 1: Run the complete automated verification suite**

Run these commands independently so each exit code is visible:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0, all tests pass, and `git diff --check` prints no errors.

- [ ] **Step 2: Review the final diff and secret boundary**

Run:

```bash
git status --short
git diff --stat HEAD~10..HEAD
git diff HEAD~10..HEAD
```

Verify every changed line maps to the approved specification. Scan staged and committed changes for `sk-` patterns without printing matched credential values. Confirm unrelated untracked `.superpowers/` and user documents remain untouched.

- [ ] **Step 3: Run a real Packy development probe**

Using the configured local text credential without logging it, send one product source image through the full-field service. Verify only a safe summary:

```json
{
  "source": "ai",
  "categoryReady": true,
  "copyReady": true,
  "packageOutcome": "verified-or-needs-attention",
  "sourceCount": 0,
  "issueCount": 1
}
```

The package outcome passes only when either accepted same-product evidence supplies the
measurements, or measurements remain zero and the expected evidence issue is present.
Do not print raw model output, authorization headers, source-image base64, or credentials.

- [ ] **Step 4: Commit any directly required verification fix**

If verification exposed an in-scope defect, follow a fresh RED/GREEN cycle, rerun all commands, then commit only that fix. If no fix was required, do not create an empty commit.

- [ ] **Step 5: Push the feature branch, deploy production, and wait for Vercel Ready**

```bash
git push origin feature/product-ai-workbench
vercel --prod --yes
vercel ls dsz-genpic
vercel inspect https://dsz-genpic.vercel.app
```

Expected: the remote branch equals local HEAD, the new production deployment is `Ready`, and `https://dsz-genpic.vercel.app` aliases that deployment.

- [ ] **Step 6: Verify the production workflow**

Submit a safe representative multipart full-field request whose image batch is below
4,000,000 bytes to `https://dsz-genpic.vercel.app/api/generate-product-fields` and verify:

- HTTP 200;
- title and description are non-empty and validated;
- category ID/path pair is known;
- package measurements are either backed by at least one source or returned unresolved with an issue;
- price and shipping match deterministic formulas;
- response contains no credential, raw reasoning, or authorization data.

Then verify production logs show the full-field request status and the independent image endpoint remains operational.

- [ ] **Step 7: Report evidence, not expectation**

Report the exact commit, deployment ID, test counts, Packy field result summary, and any remaining evidence issue. Tell the operator to refresh the production page before retrying the one-button workflow.
