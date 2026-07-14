# Manual Package Dimensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require positive operator-entered package length, width, and height before generation, and prevent every AI or fallback path from replacing those values.

**Architecture:** Keep `DszProductFields.length`, `width`, and `height` as the single browser state and expose that state in the Source calibration panel as required inputs. Enforce the same contract at the Express boundary, then treat the accepted dimensions as immutable operator facts in research validation and DSZ field assembly. Package weight remains independently manual or AI-assisted.

**Tech Stack:** React 18, TypeScript, Vite, Express, Vitest, Testing Library, Supertest

---

## File Map

- Modify `src/App.tsx`: render required Source inputs, expose accessible validation, block generation, and relabel Details ownership.
- Modify `src/styles.css`: lay out the required dimension group and its validation text.
- Modify `tests/App.test.tsx`: cover the client gate, shared state, exact request values, and response overwrite protection.
- Modify `server/app.ts`: reject missing or non-positive dimensions in the shared `ProductInput` parser.
- Modify `tests/server/api.test.ts`: prove the multipart product-data route rejects invalid dimensions before calling generation.
- Modify `server/services/productResearch.ts`: request only a conventional weight estimate and force dimensions from operator input.
- Modify `tests/services/product-research.test.ts`: prove prompts and validation never source dimensions from model output.
- Modify `server/services/dszRules.ts`: remove dimension defaults and force manual dimensions through AI and fallback assembly.
- Modify `tests/services/product-workflow.test.ts`: cover required dimensions, weight-only estimation, and fallback preservation.

### Task 1: Add the Browser Input Gate

**Files:**
- Modify: `tests/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing client tests**

Split the existing helper so tests can populate source basics without dimensions, and make the normal helper enter all required values:

```tsx
async function fillSourceBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("鍘熷浜у搧鍥剧墖"),
    new File(["image"], "source.png", { type: "image/png" })
  );
  await user.type(
    screen.getByLabelText("鍗栫偣"),
    "Soft breathable cotton stretch"
  );
}

async function fillRequiredInputs(user: ReturnType<typeof userEvent.setup>) {
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
}
```

Add tests that prove the gate and shared state:

```tsx
test("blocks all AI requests until manual package dimensions are positive", async () => {
  const user = userEvent.setup();
  const fetchMock = appFetch(() => {
    throw new Error("Generation must not start");
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await fillSourceBasics(user);
  await user.click(screen.getByRole("button", { name: /AI/ }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter package length, width, and height before generation."
  );
  expect(fetchMock.mock.calls.filter(([url]) => url !== "/api/health"))
    .toHaveLength(0);
});

test("sends exact Source dimensions and preserves them over AI output", async () => {
  const user = userEvent.setup();
  let requestInput: ProductInput | undefined;
  vi.stubGlobal("fetch", appFetch(async (url, init) => {
    if (url === "/api/generate-product-copy") {
      requestInput = JSON.parse(String((init?.body as FormData).get("input")));
      return response({
        result: {
          fields: { ...completeFields, length: 999, width: 999, height: 999 },
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
  expect(requestInput).toMatchObject({ lengthCm: 12, widthCm: 8, heightCm: 3 });
  expect(screen.getByLabelText("Length cm")).toHaveValue("12");
  expect(screen.getByLabelText("Width cm")).toHaveValue("8");
  expect(screen.getByLabelText("Height cm")).toHaveValue("3");
});
```

Update the layout test to expect the three new Source labels and the Details ownership labels to contain `User-provided`.

- [ ] **Step 2: Run the focused client tests and confirm RED**

Run:

```powershell
npx vitest run tests/App.test.tsx
```

Expected: FAIL because the Source dimension inputs and pre-generation validation do not exist, and AI output still supplies dimensions unless the Details fields were manually edited.

- [ ] **Step 3: Implement the minimal client behaviour**

Extend `NumericInput` with accessibility properties:

```tsx
function NumericInput({
  value,
  onCommit,
  inputMode = "decimal",
  ariaLabel,
  required = false,
  ariaInvalid = false
}: {
  value: number;
  onCommit: (value: number) => void;
  inputMode?: "decimal" | "numeric";
  ariaLabel?: string;
  required?: boolean;
  ariaInvalid?: boolean;
}) {
  const [buffer, setBuffer] = useState(String(value));
  const editingRef = useRef(false);
  const committedRef = useRef(value);

  useEffect(() => {
    if (!editingRef.current && value !== committedRef.current) {
      setBuffer(String(value));
    }
    committedRef.current = value;
  }, [value]);

  function commit() {
    editingRef.current = false;
    const parsed = buffer.trim() === "" ? 0 : Number(buffer);
    if (!Number.isFinite(parsed)) {
      setBuffer(String(value));
      return;
    }
    committedRef.current = parsed;
    onCommit(parsed);
  }

  return <input inputMode={inputMode} value={buffer} aria-label={ariaLabel}
    aria-required={required || undefined}
    aria-invalid={ariaInvalid || undefined}
    onFocus={() => { editingRef.current = true; }}
    onChange={(event) => setBuffer(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }} />;
}
```

Inside `App`, derive validity and retain an attempted-validation flag:

```tsx
const [showDimensionError, setShowDimensionError] = useState(false);
const hasValidPackageDimensions = [fields.length, fields.width, fields.height]
  .every((value) => Number.isFinite(value) && value > 0);

useEffect(() => {
  if (hasValidPackageDimensions) setShowDimensionError(false);
}, [hasValidPackageDimensions]);
```

Render a Source group bound to the existing field state:

```tsx
<fieldset className="package-dimensions">
  <legend>Package dimensions (required)</legend>
  <div className="package-dimension-grid">
    <label>Length
      <NumericInput ariaLabel="Package length cm" value={fields.length}
        required ariaInvalid={showDimensionError && !(fields.length > 0)}
        onCommit={(value) => updateField("length", value)} />
      <span>cm</span>
    </label>
    <label>Width
      <NumericInput ariaLabel="Package width cm" value={fields.width}
        required ariaInvalid={showDimensionError && !(fields.width > 0)}
        onCommit={(value) => updateField("width", value)} />
      <span>cm</span>
    </label>
    <label>Height
      <NumericInput ariaLabel="Package height cm" value={fields.height}
        required ariaInvalid={showDimensionError && !(fields.height > 0)}
        onCommit={(value) => updateField("height", value)} />
      <span>cm</span>
    </label>
  </div>
  {showDimensionError && !hasValidPackageDimensions && (
    <p className="inline-error" role="alert">
      Enter package length, width, and height before generation.
    </p>
  )}
</fieldset>
```

Place this fieldset in `.source-context` before the generate button. Add the guard before `invalidateGeneration("all")` in `startGeneration`:

```tsx
if (!hasValidPackageDimensions) {
  setShowDimensionError(true);
  setMessage("Enter package length, width, and height before generation.");
  return;
}
```

Change the three Details origin markers from `GPT-assisted` to `User-provided`.

Add focused CSS without changing adjacent layout:

```css
.package-dimensions { margin: 16px 0 0; padding: 0; border: 0; }
.package-dimensions legend { margin-bottom: 10px; font-size: 12px; font-weight: 680; }
.package-dimension-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.package-dimension-grid label { position: relative; }
.package-dimension-grid label span { position: absolute; right: 9px; bottom: 10px; color: var(--muted); font-size: 10px; }
.package-dimension-grid input { padding-right: 27px; }
.package-dimensions .inline-error { margin: 8px 0 0; }
```

At the existing mobile breakpoint, set `.package-dimension-grid { grid-template-columns: 1fr; }`.

- [ ] **Step 4: Run the focused client tests and confirm GREEN**

Run:

```powershell
npx vitest run tests/App.test.tsx
```

Expected: all `tests/App.test.tsx` tests pass, including the new no-request gate and overwrite-protection tests.

- [ ] **Step 5: Commit the client slice**

```powershell
git add src/App.tsx src/styles.css tests/App.test.tsx
git commit -m "feat: require package dimensions before generation"
```

### Task 2: Enforce the API Contract

**Files:**
- Modify: `tests/server/api.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing multipart API tests**

Add a table-driven test near the existing `/api/generate-product-fields` tests:

```ts
test.each([
  ["missing length", { ...productInput, lengthCm: undefined }],
  ["zero width", { ...productInput, widthCm: 0 }],
  ["negative height", { ...productInput, heightCm: -1 }],
  ["non-finite length", { ...productInput, lengthCm: Number.POSITIVE_INFINITY }]
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
    error: "Package length, width, and height are required."
  });
  expect(generateProductFields).not.toHaveBeenCalled();
});
```

Move the existing infinite-length JSON case to expect the same dimension-specific error.

- [ ] **Step 2: Run the server test and confirm RED**

Run:

```powershell
npx vitest run tests/server/api.test.ts
```

Expected: FAIL because missing and zero dimensions currently pass, while negative and non-finite dimensions return the generic numeric error.

- [ ] **Step 3: Add dimension-specific parsing**

Add a narrow key list beside `PRODUCT_INPUT_NUMERIC_KEYS`:

```ts
const REQUIRED_PACKAGE_DIMENSION_KEYS = [
  "lengthCm",
  "widthCm",
  "heightCm"
] as const;
```

In `parseProductInput`, after optional string/category checks but before the generic numeric loop, validate the raw values:

```ts
if (!REQUIRED_PACKAGE_DIMENSION_KEYS.every((key) =>
  typeof value[key] === "number" &&
  Number.isFinite(value[key]) &&
  Number(value[key]) > 0
)) {
  return {
    valid: false,
    error: "Package length, width, and height are required."
  };
}
```

Keep purchase price and weight validation by retaining this loop immediately
after the required-dimension check:

```ts
for (const key of PRODUCT_INPUT_NUMERIC_KEYS) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    continue;
  }

  const numericValue = value[key];
  if (
    typeof numericValue !== "number" ||
    !Number.isFinite(numericValue) ||
    numericValue < 0
  ) {
    return { valid: false, error: "Product numeric facts are invalid" };
  }
  input[key] = numericValue;
}
```

- [ ] **Step 4: Run the server test and confirm GREEN**

Run:

```powershell
npx vitest run tests/server/api.test.ts
```

Expected: all API tests pass and invalid multipart dimensions never call `generateProductFields`.

- [ ] **Step 5: Commit the API slice**

```powershell
git add server/app.ts tests/server/api.test.ts
git commit -m "feat: validate required package dimensions"
```

### Task 3: Remove AI and Fallback Dimension Generation

**Files:**
- Modify: `tests/services/product-research.test.ts`
- Modify: `server/services/productResearch.ts`
- Modify: `tests/services/product-workflow.test.ts`
- Modify: `server/services/dszRules.ts`

- [ ] **Step 1: Write failing research-boundary tests**

Create a reusable manual input in `tests/services/product-research.test.ts`:

```ts
const manualInput = {
  sellingPoints: "Multicolour stone and pearl necklace",
  images: [],
  imageUrls: [],
  lengthCm: 15,
  widthCm: 10,
  heightCm: 4
};
```

Use it in every successful request/validation case. Replace the conventional-dimensions request expectations with:

```ts
const serialized = JSON.stringify(body);
expect(serialized).toContain("Estimate only package weightKg");
expect(serialized).toContain(
  "Use operator-provided lengthCm, widthCm, and heightCm exactly"
);
expect(serialized).not.toContain(
  "weightKg and lengthCm x widthCm x heightCm"
);
```

Add an explicit overwrite test:

```ts
test("ignores model dimensions and keeps operator dimensions", () => {
  const result = validateProductResearch({
    raw: researchFixture({ confidence: "low", includeSources: false }),
    annotatedUrls: [],
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    input: manualInput
  });

  expect(result.package).toEqual({
    weightKg: 0.12,
    lengthCm: 15,
    widthCm: 10,
    heightCm: 4
  });
  expect(result.issues).toContain(
    "Package weight uses a conventional estimate."
  );
  expect(result.issues.join(" ")).not.toContain("dimensions use conventional");
});
```

- [ ] **Step 2: Write failing DSZ assembly tests**

Replace the workflow test named `uses conventional package defaults without exact evidence` with a manual-dimension case whose model fixture still returns `12 x 8 x 3`, but whose input supplies `15 x 10 x 4`. Expect final fields and CBM to use `15 x 10 x 4`, with only the weight-estimate issue.

Add a direct service guard:

```ts
test("rejects field generation without manual package dimensions", async () => {
  await expect(generateDszFieldsWithPacky({
    productInput: {
      ...input,
      lengthCm: undefined,
      widthCm: undefined,
      heightCm: undefined
    },
    env: {}
  })).rejects.toThrow("Package length, width, and height are required.");
});
```

Update the existing fallback test to assert that its output dimensions exactly equal the input dimensions and are not `15 x 17 x 3` unless those were explicitly supplied.

- [ ] **Step 3: Run the focused service tests and confirm RED**

Run:

```powershell
npx vitest run tests/services/product-research.test.ts tests/services/product-workflow.test.ts
```

Expected: FAIL because the prompt requests full package estimates, validation accepts model dimensions, and fallback fields contain hard-coded dimension defaults.

- [ ] **Step 4: Restrict product research to weight estimation**

In `buildProductResearchRequest`, replace the package-estimate instructions with:

```ts
"Use operator-provided lengthCm, widthCm, and heightCm exactly; do not estimate, change, or replace them.",
"Estimate only package weightKg when the operator did not provide packageWeightKg.",
"A conventional weight estimate must be positive and use package confidence low.",
```

Keep the JSON contract compatible by telling the model to echo the exact input dimensions in `package`, but never treat them as model-owned values.

In `validateProductResearch`, construct package facts this way:

```ts
const packageFacts = {
  weightKg: positiveNumber(options.input.packageWeightKg) ?? researched.weightKg,
  lengthCm: positiveNumber(options.input.lengthCm),
  widthCm: positiveNumber(options.input.widthCm),
  heightCm: positiveNumber(options.input.heightCm)
};
const usesConventionalWeightEstimate =
  positiveNumber(options.input.packageWeightKg) === undefined &&
  positiveNumber(researched.weightKg) !== undefined &&
  !evidenceValid;

if (usesConventionalWeightEstimate) {
  issues.push("Package weight uses a conventional estimate.");
}
```

Do not fall back from any dimension to `document.package`.

- [ ] **Step 5: Force manual dimensions through DSZ field assembly**

Add a focused helper in `server/services/dszRules.ts`:

```ts
function requireManualPackageDimensions(input: ProductInput) {
  const length = Number(input.lengthCm);
  const width = Number(input.widthCm);
  const height = Number(input.heightCm);
  if (![length, width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Package length, width, and height are required.");
  }
  return { length, width, height };
}
```

Call it at the start of `generateDszFieldsWithPacky`. In
`generateEvidenceBackedDszFields`, source dimensions directly from
`input.productInput` through this helper rather than from `research.package`.

Change `buildFallbackFields` from:

```ts
const length = input.lengthCm || 15;
const width = input.widthCm || 17;
const height = input.heightCm || 3;
```

to:

```ts
const { length, width, height } = requireManualPackageDimensions(input);
```

In `completeGeneratedFields`, force the fallback/manual dimensions after the
generated spread and recalculate CBM and shipping from them:

```ts
const merged = normalizeGeneratedFields({
  ...fallback,
  ...fields,
  length: fallback.length,
  width: fallback.width,
  height: fallback.height,
  cbm: fallback.cbm,
  sku: fields.sku || fallback.sku,
  ean_code: fields.ean_code || fallback.ean_code,
  images: fields.images?.length ? fields.images : input.imageUrls,
  zone_rates: standardZoneRates({
    actualWeightKg: fields.weight,
    lengthCm: fallback.length,
    widthCm: fallback.width,
    heightCm: fallback.height
  })
});
```

Update the legacy generation prompt to state that `length`, `width`, and
`height` must copy `ProductInput.lengthCm`, `widthCm`, and `heightCm` exactly.
Change the fallback review note to remove `dimensions` from the list of
AI-generated fields that need review; the operator-owned values remain visible
and editable but are not described as estimates.

- [ ] **Step 6: Run the focused service tests and confirm GREEN**

Run:

```powershell
npx vitest run tests/services/product-research.test.ts tests/services/product-workflow.test.ts
```

Expected: both suites pass; model dimensions are ignored, only missing weight may be estimated, and no hard-coded dimension fallback remains.

- [ ] **Step 7: Commit the AI-boundary slice**

```powershell
git add server/services/productResearch.ts server/services/dszRules.ts tests/services/product-research.test.ts tests/services/product-workflow.test.ts
git commit -m "fix: keep package dimensions user supplied"
```

### Task 4: Full Verification and Requirement Audit

**Files:**
- Verify all modified files from Tasks 1-3.

- [ ] **Step 1: Run the complete automated test suite**

```powershell
npm test
```

Expected: Vitest reports zero failed tests.

- [ ] **Step 2: Run static verification**

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: each command exits `0`; Vite produces the production bundle without TypeScript or ESLint errors.

- [ ] **Step 3: Audit the removed behaviour**

```powershell
rg -n "lengthCm \|\| 15|widthCm \|\| 17|heightCm \|\| 3|weightKg and lengthCm x widthCm x heightCm|Package weight and dimensions use conventional estimates" server src tests
```

Expected: no matches. Also run:

```powershell
rg -n "Package length, width, and height are required|Package weight uses a conventional estimate|User-provided" server src tests
```

Expected: matches exist in implementation and tests for the new contract.

- [ ] **Step 4: Inspect repository state and diff quality**

```powershell
git diff --check
git status --short
git log -4 --oneline
```

Expected: `git diff --check` emits nothing, the worktree is clean after task commits, and the recent commits show the design plus the three implementation slices.

- [ ] **Step 5: Report verified outcome**

Report the exact test, typecheck, lint, and build results; state explicitly that package weight remains AI-assisted while length, width, and height are manual required facts.
