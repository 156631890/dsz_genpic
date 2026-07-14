# Manual Package Weight and Category Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require operator-entered package weight alongside dimensions and resolve every final category as a canonical ID/path from the supplied category mapping, with category hint taking priority.

**Architecture:** Keep the four package measurements in the existing `DszProductFields` browser state, enforce them again at the Express boundary, and force them through every AI and fallback merge. Add a focused category matcher that parses, normalises, ranks, and canonicalises `Category_Mapping.md`; product research supplies semantic selection when lexical matching is insufficient, while all final IDs and names come from the matcher.

**Tech Stack:** React 18, TypeScript, Vite, Express, Vitest, Testing Library, Supertest

---

## File Map

- Create `server/services/categoryMatcher.ts`: parse the supplied mapping, normalise category text, rank local matches, format AI candidates, and resolve one canonical category.
- Create `tests/services/category-matcher.test.ts`: unit-test parsing, British/American spelling, priority, canonicalisation, invalid model IDs, and General Goods fallback.
- Modify `src/App.tsx`: render required Source weight, block generation until all package measurements are positive, preserve operator package facts, and relabel weight ownership.
- Modify `src/styles.css`: lay out the four Source package measurements in the existing rail.
- Modify `tests/App.test.tsx`: cover required weight, exact request data, response overwrite protection, and shared Source/Details state.
- Modify `server/app.ts`: require positive package weight in the shared `ProductInput` parser.
- Modify `tests/server/api.test.ts`: cover missing, zero, negative, and non-finite weight at the HTTP boundary.
- Modify `server/services/productResearch.ts`: use canonical category resolution, make category hint authoritative, and treat all package measurements as fixed operator facts.
- Modify `tests/services/product-research.test.ts`: cover canonical category selection, semantic ID canonicalisation, fallback, and removal of weight estimation.
- Modify `server/services/dszRules.ts`: remove the weight fallback and hard-coded category subset, then use the shared matcher in legacy AI and local fallback paths.
- Modify `tests/services/product-workflow.test.ts`: cover the service guard, manual weight preservation, mapped fallback categories, pricing, and shipping.

### Task 1: Require Package Weight in the Browser

**Files:**
- Modify: `tests/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing client tests**

Update the normal input helper so every existing successful generation test enters all four required package measurements:

```tsx
async function fillRequiredInputs(user: ReturnType<typeof userEvent.setup>) {
  await fillSourceBasics(user);
  for (const [label, value] of [
    ["Package weight kg", "0.2"],
    ["Package length cm", "12"],
    ["Package width cm", "8"],
    ["Package height cm", "3"]
  ] as const) {
    await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText(label), value);
    await user.tab();
  }
}
```

Add an isolated missing-weight gate test that fills valid dimensions but leaves weight at zero:

```tsx
test("blocks all AI requests until manual package weight is positive", async () => {
  const user = userEvent.setup();
  const fetchMock = appFetch(() => {
    throw new Error("Generation must not start");
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await fillSourceBasics(user);
  for (const [label, value] of [
    ["Package length cm", "12"],
    ["Package width cm", "8"],
    ["Package height cm", "3"]
  ] as const) {
    await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText(label), value);
    await user.tab();
  }
  await user.click(screen.getByRole("button", { name: /AI/ }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter package weight, length, width, and height before generation."
  );
  expect(fetchMock.mock.calls.filter(([url]) => url !== "/api/health"))
    .toHaveLength(0);
});
```

Replace the dimension-only request test with a full package-facts test:

```tsx
test("sends exact Source package measurements and preserves them over AI output", async () => {
  const user = userEvent.setup();
  let requestInput: ProductInput | undefined;
  vi.stubGlobal("fetch", appFetch(async (url, init) => {
    if (url === "/api/generate-product-copy") {
      requestInput = JSON.parse(String((init?.body as FormData).get("input")));
      return response({
        result: {
          fields: {
            ...completeFields,
            weight: 999,
            length: 999,
            width: 999,
            height: 999
          },
          source: "ai",
          issues: []
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
  await user.click(screen.getByRole("button", { name: /AI/ }));

  await waitFor(() => expect(requestInput).toBeDefined());
  expect(requestInput).toMatchObject({
    packageWeightKg: 0.2,
    lengthCm: 12,
    widthCm: 8,
    heightCm: 3
  });
  expect(screen.getByLabelText("Package Weight kg")).toHaveValue("0.2");
  expect(screen.getByLabelText("Length cm")).toHaveValue("12");
  expect(screen.getByLabelText("Width cm")).toHaveValue("8");
  expect(screen.getByLabelText("Height cm")).toHaveValue("3");
});
```

Update the layout test to expect `Package weight kg` in Source and
`User-provided` on the Details `Package Weight kg` label.

- [ ] **Step 2: Run the client suite and verify RED**

Run:

```powershell
npx vitest run tests/App.test.tsx
```

Expected: the new Source weight label is missing, the weight-only gate starts generation, and AI weight can still be applied.

- [ ] **Step 3: Implement the minimal browser behaviour**

Replace the dimension-only state with package-measurement state:

```tsx
const OPERATOR_PACKAGE_FIELDS = new Set<keyof DszProductFields>([
  "weight",
  "length",
  "width",
  "height"
]);

const [showMeasurementError, setShowMeasurementError] = useState(false);
const hasValidPackageMeasurements = [
  fields.weight,
  fields.length,
  fields.width,
  fields.height
].every((value) => Number.isFinite(value) && value > 0);

useEffect(() => {
  if (hasValidPackageMeasurements) setShowMeasurementError(false);
}, [hasValidPackageMeasurements]);
```

In `applyGeneratedFields`, skip all operator package fields before applying model output:

```tsx
for (const key of Object.keys(generated) as Array<keyof DszProductFields>) {
  if (OPERATOR_PACKAGE_FIELDS.has(key)) continue;
  if (key === "categoryName" && manualFieldsRef.current.has("categories")) {
    next.categoryName = generated.categories === current.categories
      ? generated.categoryName
      : "";
    continue;
  }
  if (
    !manualFieldsRef.current.has(key) &&
    fieldEditVersionsRef.current[key] === versionsAtStart[key]
  ) {
    Object.assign(next, { [key]: generated[key] });
  }
}
```

Change the `startGeneration` guard to:

```tsx
if (!hasValidPackageMeasurements) {
  setShowMeasurementError(true);
  setMessage(
    "Enter package weight, length, width, and height before generation."
  );
  return;
}
```

Render the weight input first in the renamed fieldset:

```tsx
<fieldset className="package-measurements">
  <legend>Package measurements (required)</legend>
  <div className="package-measurement-grid">
    <label>Package Weight
      <NumericInput ariaLabel="Package weight kg" value={fields.weight}
        required ariaInvalid={showMeasurementError && !(fields.weight > 0)}
        onCommit={(value) => updateField("weight", value)} />
      <span>kg</span>
    </label>
    <label>Length
      <NumericInput ariaLabel="Package length cm" value={fields.length}
        required ariaInvalid={showMeasurementError && !(fields.length > 0)}
        onCommit={(value) => updateField("length", value)} />
      <span>cm</span>
    </label>
    <label>Width
      <NumericInput ariaLabel="Package width cm" value={fields.width}
        required ariaInvalid={showMeasurementError && !(fields.width > 0)}
        onCommit={(value) => updateField("width", value)} />
      <span>cm</span>
    </label>
    <label>Height
      <NumericInput ariaLabel="Package height cm" value={fields.height}
        required ariaInvalid={showMeasurementError && !(fields.height > 0)}
        onCommit={(value) => updateField("height", value)} />
      <span>cm</span>
    </label>
  </div>
  {showMeasurementError && !hasValidPackageMeasurements && (
    <p className="inline-error" role="alert">
      Enter package weight, length, width, and height before generation.
    </p>
  )}
</fieldset>
```

Change the Details weight marker from `GPT-assisted` to `User-provided`.

Rename the focused CSS selectors and use a two-column desktop grid:

```css
.package-measurements { margin: 16px 0 0; padding: 0; border: 0; }
.package-measurements legend { margin-bottom: 10px; font-size: 12px; font-weight: 680; }
.package-measurement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.package-measurement-grid label { position: relative; }
.package-measurement-grid label span { position: absolute; right: 9px; bottom: 10px; color: var(--muted); font-size: 10px; }
.package-measurement-grid input { padding-right: 27px; }
.package-measurements .inline-error { margin: 8px 0 0; }
```

At the existing mobile breakpoint use:

```css
.package-measurement-grid { grid-template-columns: 1fr; }
```

- [ ] **Step 4: Run the client suite and verify GREEN**

Run:

```powershell
npx vitest run tests/App.test.tsx
```

Expected: all App tests pass, including the missing-weight no-request test and response overwrite test.

- [ ] **Step 5: Commit the browser slice**

```powershell
git add src/App.tsx src/styles.css tests/App.test.tsx
git commit -m "feat: require package weight before generation"
```

### Task 2: Enforce Required Weight at the API Boundary

**Files:**
- Modify: `tests/server/api.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing API tests**

Expand the existing multipart table to cover all required package measurements:

```ts
test.each([
  ["missing weight", { ...productInput, packageWeightKg: undefined }],
  ["zero weight", { ...productInput, packageWeightKg: 0 }],
  ["negative weight", { ...productInput, packageWeightKg: -1 }],
  ["non-finite weight", { ...productInput, packageWeightKg: Number.POSITIVE_INFINITY }],
  ["missing length", { ...productInput, lengthCm: undefined }],
  ["zero width", { ...productInput, widthCm: 0 }],
  ["negative height", { ...productInput, heightCm: -1 }]
])("rejects %s before product field generation", async (_name, input) => {
  const generateProductFields = vi.fn();
  const response = await request(createApp({ generateProductFields }))
    .post("/api/generate-product-fields")
    .field("input", JSON.stringify(input))
    .field("identity", JSON.stringify({
      sku: "Elosung10000",
      eanCode: "4748549810"
    }))
    .attach("images", pngImage, {
      filename: "source.png",
      contentType: "image/png"
    })
    .expect(400);

  expect(response.body).toEqual({
    error: "Package weight, length, width, and height are required."
  });
  expect(generateProductFields).not.toHaveBeenCalled();
});
```

Change the independent copy-input NaN weight case to expect the same package-specific error.

- [ ] **Step 2: Run the API suite and verify RED**

Run:

```powershell
npx vitest run tests/server/api.test.ts
```

Expected: missing and non-positive weight still use the old optional numeric behaviour.

- [ ] **Step 3: Add weight to required measurement validation**

Replace `REQUIRED_PACKAGE_DIMENSION_KEYS` with:

```ts
const REQUIRED_PACKAGE_MEASUREMENT_KEYS = [
  "packageWeightKg",
  "lengthCm",
  "widthCm",
  "heightCm"
] as const;
```

Replace the dimension check with:

```ts
if (!REQUIRED_PACKAGE_MEASUREMENT_KEYS.every((key) => {
  const measurement = value[key];
  return typeof measurement === "number" &&
    Number.isFinite(measurement) &&
    measurement > 0;
})) {
  return {
    valid: false,
    error: "Package weight, length, width, and height are required."
  };
}
```

Keep the generic numeric loop after this check for purchase-price validation.

- [ ] **Step 4: Run the API suite and verify GREEN**

Run:

```powershell
npx vitest run tests/server/api.test.ts
```

Expected: every invalid package measurement returns HTTP 400 with the specific error and never calls generation.

- [ ] **Step 5: Commit the API slice**

```powershell
git add server/app.ts tests/server/api.test.ts
git commit -m "feat: validate required package weight"
```

### Task 3: Build the Canonical Category Matcher

**Files:**
- Create: `server/services/categoryMatcher.ts`
- Create: `tests/services/category-matcher.test.ts`

- [ ] **Step 1: Write failing matcher tests**

Create `tests/services/category-matcher.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  formatCategoryCandidates,
  parseCategoryEntries,
  rankCategoryEntries,
  resolveMappedCategory
} from "../../server/services/categoryMatcher";

const mapping = [
  "| General Goods | default / unclassified | ID: 1 |",
  "| Fashion / Men's Fashion / Men's Jewellery | 924 |",
  "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
  "| Duplicate category that must be ignored | 950 |",
  "| Fashion / Women's Fashion / Women's Swimwear | 956 |",
  "| Appliances / Kitchen Appliances / Kitchen Appliance Accessories | 1022 |",
  "| malformed | not-an-id |"
].join("\n");

describe("category matcher", () => {
  test("parses ordinary rows and the supplied General Goods row", () => {
    expect(parseCategoryEntries(mapping)).toEqual([
      { id: 1, name: "General Goods" },
      { id: 924, name: "Fashion / Men's Fashion / Men's Jewellery" },
      { id: 950, name: "Fashion / Women's Fashion / Women's Jewellery" },
      { id: 956, name: "Fashion / Women's Fashion / Women's Swimwear" },
      {
        id: 1022,
        name: "Appliances / Kitchen Appliances / Kitchen Appliance Accessories"
      }
    ]);
  });

  test("normalises American spelling and selects the canonical leaf", () => {
    const ranked = rankCategoryEntries(
      parseCategoryEntries(mapping),
      "Women's Jewelry"
    );

    expect(ranked[0]).toMatchObject({
      id: 950,
      name: "Fashion / Women's Fashion / Women's Jewellery",
      highConfidence: true
    });
  });

  test("compares common singular and plural category tokens", () => {
    expect(rankCategoryEntries(
      parseCategoryEntries(mapping),
      "Kitchen Appliance Accessory"
    )[0]).toMatchObject({ id: 1022, highConfidence: true });
  });

  test("lets an unambiguous hint override a conflicting model category", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "Women's Jewelry",
      generatedCategoryId: 956
    })).toMatchObject({
      category: {
        id: 950,
        name: "Fashion / Women's Fashion / Women's Jewellery"
      },
      source: "hint",
      defaulted: false
    });
  });

  test("canonicalises a semantic model ID for a Chinese hint", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "项链",
      generatedCategoryId: 950
    })).toMatchObject({
      category: {
        id: 950,
        name: "Fashion / Women's Fashion / Women's Jewellery"
      },
      source: "model",
      defaulted: false
    });
  });

  test("falls back from an invalid model ID to the best local hint", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "Women's Jewelry",
      generatedCategoryId: 999999
    }).category.id).toBe(950);
  });

  test("uses mapped General Goods when no result is available", () => {
    expect(resolveMappedCategory({
      categoryMapping: mapping,
      categoryHint: "unclassifiable phrase",
      generatedCategoryId: 999999
    })).toMatchObject({
      category: { id: 1, name: "General Goods" },
      source: "default",
      defaulted: true
    });
  });

  test("formats only canonical mapping rows for AI selection", () => {
    expect(formatCategoryCandidates(
      mapping,
      "Women's Jewelry",
      "necklace"
    )).toContain(
      "| Fashion / Women's Fashion / Women's Jewellery | 950 |"
    );
  });

  test("rejects an unusable mapping", () => {
    expect(() => resolveMappedCategory({
      categoryMapping: "# no category rows",
      categoryHint: "jewellery"
    })).toThrow("Category mapping is unavailable.");
  });
});
```

- [ ] **Step 2: Run the matcher suite and verify RED**

Run:

```powershell
npx vitest run tests/services/category-matcher.test.ts
```

Expected: FAIL because `server/services/categoryMatcher.ts` does not exist.

- [ ] **Step 3: Implement the focused matcher module**

Create `server/services/categoryMatcher.ts`:

```ts
export interface CategoryEntry {
  id: number;
  name: string;
}

export interface RankedCategory extends CategoryEntry {
  score: number;
  highConfidence: boolean;
}

export interface CategoryResolution {
  category: CategoryEntry;
  source: "manual" | "hint" | "model" | "local" | "default";
  defaulted: boolean;
  invalidManualCategory: boolean;
}

interface ResolveCategoryOptions {
  categoryMapping: string;
  categoryHint?: string;
  fallbackText?: string;
  manualCategoryId?: number;
  generatedCategoryId?: number;
}

const SPELLING_ALIASES: Record<string, string> = {
  jewelry: "jewellery"
};

export function parseCategoryEntries(value: string): CategoryEntry[] {
  const entries: CategoryEntry[] = [];
  const ids = new Set<number>();

  for (const line of value.split(/\r?\n/)) {
    const ordinary = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
    const general = /^\|\s*(General Goods)\s*\|[^|]*\|\s*ID:\s*(\d+)\s*\|$/i
      .exec(line);
    const id = ordinary ? Number(ordinary[2]) : general ? Number(general[2]) : 0;
    const name = ordinary ? ordinary[1].trim() : general ? general[1].trim() : "";

    if (id > 0 && name && !ids.has(id)) {
      ids.add(id);
      entries.push({ id, name });
    }
  }

  return entries;
}

function canonicalToken(value: string): string {
  const aliased = SPELLING_ALIASES[value] || value;
  if (aliased.length > 4 && /ies$/.test(aliased)) {
    return `${aliased.slice(0, -3)}y`;
  }
  if (aliased.length > 4 && /(sses|shes|ches|xes|zes)$/.test(aliased)) {
    return aliased.slice(0, -2);
  }
  if (aliased.length > 3 && /s$/.test(aliased) && !/(ss|us)$/.test(aliased)) {
    return aliased.slice(0, -1);
  }
  return aliased;
}

function normalizeCategoryText(value: string): string {
  return (value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .match(/[\p{L}\p{N}]+/gu) || [])
    .map(canonicalToken)
    .join(" ");
}

function categoryOnly(value: CategoryEntry): CategoryEntry {
  return { id: value.id, name: value.name };
}

function scoreCategory(entry: CategoryEntry, query: string): number {
  const normalizedQuery = normalizeCategoryText(query);
  if (!normalizedQuery) return 0;

  const normalizedPath = normalizeCategoryText(entry.name);
  const leaf = entry.name.split("/").at(-1)?.trim() || entry.name;
  const normalizedLeaf = normalizeCategoryText(leaf);
  const queryTokens = normalizedQuery.split(" ");
  const leafTokens = new Set(normalizedLeaf.split(" "));
  const pathTokens = new Set(normalizedPath.split(" "));
  const leafOverlap = queryTokens.filter((token) => leafTokens.has(token)).length;
  const pathOverlap = queryTokens.filter((token) => pathTokens.has(token)).length;
  const depth = entry.name.split("/").length;

  if (normalizedQuery === normalizedLeaf) return 10_000 + depth;
  if (normalizedQuery === normalizedPath) return 9_000 + depth;
  if (normalizedLeaf.includes(normalizedQuery)) return 8_000 + depth;
  if (leafOverlap === queryTokens.length) return 7_000 + leafOverlap * 10 + depth;
  if (pathOverlap === 0) return 0;
  return pathOverlap * 100 + leafOverlap * 50 + depth;
}

export function rankCategoryEntries(
  entries: CategoryEntry[],
  query: string
): RankedCategory[] {
  const ranked = entries
    .map((entry, index) => ({
      ...entry,
      score: scoreCategory(entry, query),
      index
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const secondScore = ranked[1]?.score || 0;

  return ranked.map(({ index: _index, ...entry }, index) => ({
    ...entry,
    highConfidence:
      index === 0 && entry.score >= 7_000 && entry.score > secondScore
  }));
}

export function formatCategoryCandidates(
  categoryMapping: string,
  categoryHint?: string,
  fallbackText?: string
): string {
  const entries = parseCategoryEntries(categoryMapping);
  if (entries.length === 0) {
    throw new Error("Category mapping is unavailable.");
  }

  const query = categoryHint?.trim() || fallbackText?.trim() || "";
  const ranked = rankCategoryEntries(entries, query);
  const candidates = ranked.length > 0
    ? ranked.slice(0, 50)
    : entries;

  return candidates
    .map((entry) => `| ${entry.name} | ${entry.id} |`)
    .join("\n");
}

export function resolveMappedCategory(
  options: ResolveCategoryOptions
): CategoryResolution {
  const entries = parseCategoryEntries(options.categoryMapping);
  if (entries.length === 0) {
    throw new Error("Category mapping is unavailable.");
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const manual = options.manualCategoryId === undefined
    ? undefined
    : byId.get(options.manualCategoryId);
  const invalidManualCategory =
    options.manualCategoryId !== undefined && manual === undefined;
  if (manual) {
    return {
      category: manual,
      source: "manual",
      defaulted: false,
      invalidManualCategory: false
    };
  }

  const categoryHint = options.categoryHint?.trim() || "";
  const query = categoryHint || options.fallbackText?.trim() || "";
  const ranked = rankCategoryEntries(entries, query);
  if (categoryHint && ranked[0]?.highConfidence) {
    return {
      category: categoryOnly(ranked[0]),
      source: "hint",
      defaulted: false,
      invalidManualCategory
    };
  }

  const generated = options.generatedCategoryId === undefined
    ? undefined
    : byId.get(options.generatedCategoryId);
  if (generated) {
    return {
      category: generated,
      source: "model",
      defaulted: false,
      invalidManualCategory
    };
  }

  if (ranked[0]) {
    return {
      category: categoryOnly(ranked[0]),
      source: "local",
      defaulted: false,
      invalidManualCategory
    };
  }

  const general = byId.get(1);
  if (!general) {
    throw new Error("Category mapping is unavailable.");
  }
  return {
    category: general,
    source: "default",
    defaulted: true,
    invalidManualCategory
  };
}
```

- [ ] **Step 4: Run matcher tests and verify GREEN**

Run:

```powershell
npx vitest run tests/services/category-matcher.test.ts
```

Expected: all category matcher tests pass.

- [ ] **Step 5: Commit the matcher slice**

```powershell
git add server/services/categoryMatcher.ts tests/services/category-matcher.test.ts
git commit -m "feat: add canonical category matcher"
```

### Task 4: Integrate Canonical Categories and Manual Weight into Research

**Files:**
- Modify: `tests/services/product-research.test.ts`
- Modify: `server/services/productResearch.ts`

- [ ] **Step 1: Write failing research tests**

Add `packageWeightKg: 0.2` to the shared `manualInput`. Change prompt assertions to require fixed operator package facts:

```ts
expect(serialized).toContain(
  "Copy PRODUCT INPUT packageWeightKg to package.weightKg exactly"
);
expect(serialized).not.toContain("Estimate only package weightKg");
```

Change package expectations so the model fixture's `0.12` weight is ignored:

```ts
expect(result.package).toEqual({
  weightKg: 0.2,
  lengthCm: 15,
  widthCm: 10,
  heightCm: 4
});
expect(result.issues).not.toContain(
  "Package weight uses a conventional estimate."
);
```

Use a mapping fixture with General Goods and canonical jewellery:

```ts
const categoryMapping = [
  "| General Goods | default / unclassified | ID: 1 |",
  "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
  "| Fashion / Women's Fashion / Women's Swimwear | 956 |"
].join("\n");
```

Add category boundary tests:

```ts
test("lets a high-confidence category hint override model inference", () => {
  const raw = researchFixture();
  const result = validateProductResearch({
    raw: {
      ...raw,
      category: {
        id: 956,
        name: "Fashion / Women's Fashion / Women's Swimwear"
      }
    },
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping,
    input: { ...manualInput, categoryHint: "Women's Jewelry" }
  });

  expect(result.category).toEqual({
    id: 950,
    name: "Fashion / Women's Fashion / Women's Jewellery"
  });
});

test.each(["necklace", "项链"])(
  "canonicalises semantic ID 950 for hint %s even when the model path differs",
  (categoryHint) => {
  const raw = researchFixture();
  const result = validateProductResearch({
    raw: {
      ...raw,
      category: { id: 950, name: "Women's Jewelry" }
    },
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping,
    input: { ...manualInput, categoryHint }
  });

  expect(result.category).toEqual({
    id: 950,
    name: "Fashion / Women's Fashion / Women's Jewellery"
  });
  expect(result.issues).not.toContain(
    "Category needs review because no valid ID and path match was found."
  );
  }
);

test("defaults an invalid semantic ID to mapped General Goods", () => {
  const raw = researchFixture();
  const result = validateProductResearch({
    raw: {
      ...raw,
      category: { id: 999999, name: "Invented category" }
    },
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping,
    input: { ...manualInput, categoryHint: "unclassifiable phrase" }
  });

  expect(result.category).toEqual({ id: 1, name: "General Goods" });
  expect(result.issues).toContain(
    "Category defaulted to General Goods because no closer mapping match was found."
  );
});
```

- [ ] **Step 2: Run research tests and verify RED**

Run:

```powershell
npx vitest run tests/services/product-research.test.ts
```

Expected: prompt still requests a weight estimate, model weight still wins when input weight is absent in old fixtures, and category validation still requires exact ID/path equality.

- [ ] **Step 3: Integrate the matcher and fixed package facts**

Import the matcher:

```ts
import {
  formatCategoryCandidates,
  resolveMappedCategory
} from "./categoryMatcher.js";
```

Replace `selectCategoryCandidates` usage with:

```ts
const categoryCandidates = formatCategoryCandidates(
  options.categoryMapping,
  options.input.categoryHint,
  options.input.sellingPoints
);
```

Replace the category and package prompt lines with:

```ts
"When categoryHint is non-empty, treat it as authoritative. Use images and selling points only to break ties. When categoryHint is empty, infer from the product.",
"Choose exactly one category ID from CATEGORY CANDIDATES.",
"Copy PRODUCT INPUT packageWeightKg to package.weightKg exactly, and use lengthCm, widthCm, and heightCm exactly; do not estimate, change, or replace them.",
"Return keys identity, category, colour, package, sources, riskFlags and reviewNotes.",
"category requires an integer id from CATEGORY CANDIDATES and a non-empty name.",
"package requires the exact positive weightKg, lengthCm, widthCm, heightCm from PRODUCT INPUT and confidence high, medium or low."
```

Delete the old local `selectCategoryCandidates` and `parseCategoryMapping`
functions. Remove the corresponding `parseCategoryMapping` import and parser
test from `tests/services/product-research.test.ts`, because parser coverage now
lives in `category-matcher.test.ts`. In `validateProductResearch`, replace
exact path validation with:

```ts
const categoryResolution = resolveMappedCategory({
  categoryMapping: options.categoryMapping,
  categoryHint: options.input.categoryHint,
  fallbackText: options.input.sellingPoints,
  manualCategoryId: options.input.categoryId,
  generatedCategoryId: document.category.id
});
const category = categoryResolution.category;
```

Build category issues with canonical resolution state:

```ts
if (categoryResolution.invalidManualCategory) {
  issues.push("The manual category ID is not in the current mapping.");
}
if (categoryResolution.defaulted) {
  issues.push(
    "Category defaulted to General Goods because no closer mapping match was found."
  );
}
```

Replace researched-weight merging with fixed operator facts:

```ts
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
```

Keep aggregate package/source calculations only for evidence consistency; do not use them as final package facts.

- [ ] **Step 4: Run matcher and research tests and verify GREEN**

Run:

```powershell
npx vitest run tests/services/category-matcher.test.ts tests/services/product-research.test.ts
```

Expected: both suites pass; valid IDs are canonicalised, category hint wins, and package weight is always operator-owned.

- [ ] **Step 5: Commit the research slice**

```powershell
git add server/services/productResearch.ts tests/services/product-research.test.ts
git commit -m "fix: canonicalize researched product categories"
```

### Task 5: Use Manual Weight and Full Mapping in Every DSZ Assembly Path

**Files:**
- Modify: `tests/services/product-workflow.test.ts`
- Modify: `server/services/dszRules.ts`

- [ ] **Step 1: Write failing workflow tests**

Expand the direct service guard:

```ts
test.each([
  ["weight", { packageWeightKg: undefined }],
  ["length", { lengthCm: undefined }],
  ["width", { widthCm: undefined }],
  ["height", { heightCm: undefined }]
])("rejects field generation without manual package %s", async (_name, patch) => {
  await expect(generateDszFieldsWithPacky({
    productInput: { ...input, ...patch },
    env: {}
  })).rejects.toThrow(
    "Package weight, length, width, and height are required."
  );
});
```

Add `packageWeightKg: 0.2` to both literal evidence-backed `productInput`
fixtures. Rename the former conventional-weight case so it asserts that no
conventional package-weight issue is returned. Change expectations so a model
weight of `0.12` cannot replace input weight `0.2`, and price uses `0.2`:

```ts
expect(result.fields).toMatchObject({
  weight: 0.2,
  length: 15,
  width: 10,
  height: 4,
  cbm: calculateCbm(15, 10, 4)
});
expect(result.fields.vendor_price).toBe(calculateVendorPrice({
  weightKg: 0.2,
  lengthCm: 15,
  widthCm: 10,
  heightCm: 4,
  purchasePriceCny: 20
}));
```

Add a no-provider fallback test that proves the complete mapping is used:

```ts
test("uses the supplied mapping for local fallback categories", async () => {
  const result = await generateDszFieldsWithPacky({
    productInput: {
      ...input,
      categoryHint: "Women's Jewelry"
    },
    env: {},
    ruleDocuments: {
      fieldRules: "Current DSZ field rules.",
      productPrompt: "Current product prompt.",
      categoryMapping: [
        "| General Goods | default / unclassified | ID: 1 |",
        "| Fashion / Women's Fashion / Women's Jewellery | 950 |"
      ].join("\n"),
      uploadSop: "Current upload SOP.",
      productUploadAu: "Current AU rules."
    }
  });

  expect(result.source).toBe("fallback");
  expect(result.fields).toMatchObject({
    category: 950,
    categories: "950",
    categoryName: "Fashion / Women's Fashion / Women's Jewellery",
    weight: input.packageWeightKg
  });
});
```

Add an unknown-category fallback test expecting General Goods and its review note.

- [ ] **Step 2: Run workflow tests and verify RED**

Run:

```powershell
npx vitest run tests/services/product-workflow.test.ts
```

Expected: missing weight is accepted through the `0.1 kg` fallback, evidence can still take research weight, and local categories still use the hard-coded subset.

- [ ] **Step 3: Replace dimension-only guards and hard-coded category resolution**

Import the matcher:

```ts
import { resolveMappedCategory } from "./categoryMatcher.js";
```

Replace `requireManualPackageDimensions` with:

```ts
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
```

Call this helper at the start of `generateDszFieldsWithPacky`. In the evidence-backed path, use its returned weight and dimensions instead of `research.package`.

Change fallback assembly to receive the mapping and resolve the category:

```ts
function buildFallbackFields(
  input: ProductInput,
  identity: ProductIdentity,
  categoryMapping: string,
  reason?: string
): DszProductFields {
  const { weight, length, width, height } =
    requireManualPackageMeasurements(input);
  const categoryResolution = resolveMappedCategory({
    categoryMapping,
    categoryHint: input.categoryHint,
    fallbackText: input.sellingPoints,
    manualCategoryId: input.categoryId
  });
  const category = categoryResolution.category;
```

Include this conditional review note in the returned fallback fields:

```ts
...(categoryResolution.defaulted
  ? ["Category defaulted to General Goods because no closer mapping match was found."]
  : [])
```

Pass `ruleDocuments.categoryMapping` to every `buildFallbackFields` call. Change `completeGeneratedFields` to accept `categoryMapping`, resolve from input plus generated ID, and force all four package facts after the generated spread:

```ts
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
```

Pass `ruleDocuments.categoryMapping` when calling `completeGeneratedFields`.
Remove `CATEGORY_HINTS`, `guessCategory`, and `resolveCategoryHint`. Also remove
`const hintedCategory` and its later category-override block from
`completeGeneratedFields`; canonical resolution above replaces both. Update
the legacy AI prompt to say:

```ts
"Copy weight, length, width and height exactly from INPUT; do not estimate or replace them.",
"When categoryHint is non-empty it is authoritative. Choose a category ID from CATEGORY MAPPING; the server canonicalises its path."
```

Remove `weight` from the fallback note's list of AI-authored fields.

- [ ] **Step 4: Run all focused service suites and verify GREEN**

Run:

```powershell
npx vitest run tests/services/category-matcher.test.ts tests/services/product-research.test.ts tests/services/product-workflow.test.ts
```

Expected: all focused suites pass; every assembly path preserves manual package facts and returns mapped canonical categories.

- [ ] **Step 5: Commit the DSZ assembly slice**

```powershell
git add server/services/dszRules.ts tests/services/product-workflow.test.ts
git commit -m "fix: use manual weight and mapped categories"
```

### Task 6: Full Verification and Requirement Audit

**Files:**
- Verify all files changed in Tasks 1–5.

- [ ] **Step 1: Run the complete test suite**

```powershell
npm test
```

Expected: every Vitest file and test passes with zero failures.

- [ ] **Step 2: Run static and production-build verification**

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits `0`; Vite produces the production bundle.

- [ ] **Step 3: Audit removed behaviour**

```powershell
rg -n "packageWeightKg \|\| 0\.1|Estimate only package weightKg|Package weight uses a conventional estimate|Category needs review because no valid ID and path match was found|CATEGORY_HINTS" server src
```

Expected: no matches.

```powershell
rg -n "Package weight, length, width, and height are required|Package measurements \(required\)|Category defaulted to General Goods|resolveMappedCategory" server src tests
```

Expected: implementation and test matches exist at the client, API, matcher, research, and DSZ assembly boundaries.

- [ ] **Step 4: Inspect diff and branch state**

```powershell
git diff --check
git status --short
git log -6 --oneline
```

Expected: `git diff --check` emits nothing, the worktree is clean after commits, and recent history contains the design plus five focused implementation commits.

- [ ] **Step 5: Finish the branch without assuming deployment authority**

Invoke `superpowers:verification-before-completion`, then
`superpowers:finishing-a-development-branch`. Present the required merge, PR,
keep, or discard options. Push, merge, or update Vercel Production only after
the user selects the corresponding external action.
