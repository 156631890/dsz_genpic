# Live Dropshipzone Category Mapping Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale local category snapshot with all 799 active categories from Dropshipzone and stop full-field generation with an actionable error instead of using invalid `General Goods (ID 1)`.

**Architecture:** Download `GET /new_categories` once with the existing production credentials, remove the unreturned structural prefix `1/342`, reconstruct canonical name paths, and check the deterministic Markdown snapshot into the repository. Introduce one typed category-match error at the matcher boundary, map only that error to a safe HTTP 422 response, and remove stale category IDs from bundled guidance. Runtime category lookup and upload-time live validation remain out of scope.

**Tech Stack:** TypeScript, Express, Vitest, PowerShell, Vercel CLI, Dropshipzone Supplier API, Markdown, Vite.

---

## File Map

- Modify `server/services/categoryMatcher.ts`: remove invalid default-category resolution and expose the typed unmatched-category error.
- Modify `server/app.ts`: map the typed category error to an actionable HTTP 422 response.
- Modify `server/services/dszRules.ts`: remove the built-in invalid ID 1 mapping and unreachable default review notes.
- Modify `server/services/productResearch.ts`: remove unreachable General Goods review notes.
- Modify `rules/Category_Mapping.md`: replace the stale 275-row mapping with the canonical 799-row live snapshot.
- Modify `rules/Dropshipzone_Field_Rules.md`: remove the invalid fallback and stale static category table.
- Modify `rules/Full_Product_Upload_SOP.md`: remove the invalid fallback and stale quick-reference IDs.
- Modify `tests/services/category-matcher.test.ts`: cover typed failure and validate the checked-in live snapshot.
- Modify `tests/services/product-research.test.ts`: require typed failure for an invalid semantic category.
- Modify `tests/services/product-workflow.test.ts`: require typed failure in local fallback paths and verify bundled guidance.
- Modify `tests/server/api.test.ts`: verify the safe HTTP 422 response without weakening other error masking.

### Task 1: Require a valid mapped category

**Files:**
- Modify: `tests/services/category-matcher.test.ts`
- Modify: `server/services/categoryMatcher.ts`

- [ ] **Step 1: Write the failing matcher contract**

In `tests/services/category-matcher.test.ts`, import the new public error contract:

```ts
import {
  CATEGORY_MATCH_REQUIRED_MESSAGE,
  CategoryMatchRequiredError,
  formatCategoryCandidates,
  parseCategoryEntries,
  rankCategoryEntries,
  resolveMappedCategory
} from "../../server/services/categoryMatcher";
```

Remove the `General Goods` row from the `mapping` fixture and remove it from the parser expectation. Replace the existing default-category test with:

```ts
test("requires a more specific hint when no live category can be resolved", () => {
  const resolve = () => resolveMappedCategory({
    categoryMapping: mapping,
    categoryHint: "unclassifiable phrase",
    generatedCategoryId: 999999
  });

  expect(resolve).toThrow(CategoryMatchRequiredError);
  expect(resolve).toThrow(CATEGORY_MATCH_REQUIRED_MESSAGE);
});
```

Remove `defaulted: false` assertions from successful resolution tests because the obsolete default state is removed from `CategoryResolution`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/services/category-matcher.test.ts
```

Expected: FAIL because `CategoryMatchRequiredError` and `CATEGORY_MATCH_REQUIRED_MESSAGE` are not exported and unmatched input still returns ID 1.

- [ ] **Step 3: Implement the typed matcher failure**

In `server/services/categoryMatcher.ts`, add:

```ts
export const CATEGORY_MATCH_REQUIRED_MESSAGE =
  "No valid Dropshipzone category matched. Enter a more specific category hint and generate again.";

export class CategoryMatchRequiredError extends Error {
  constructor() {
    super(CATEGORY_MATCH_REQUIRED_MESSAGE);
    this.name = "CategoryMatchRequiredError";
  }
}
```

Change `CategoryResolution` to remove the impossible default state:

```ts
export interface CategoryResolution {
  category: CategoryEntry;
  source: "manual" | "hint" | "model" | "local";
  invalidManualCategory: boolean;
}
```

Simplify `parseCategoryEntries` to accept only canonical two-column rows:

```ts
for (const line of value.split(/\r?\n/)) {
  const ordinary = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
  const id = ordinary ? Number(ordinary[2]) : 0;
  const name = ordinary ? ordinary[1].trim() : "";

  if (id > 0 && name && !ids.has(id)) {
    ids.add(id);
    entries.push({ id, name });
  }
}
```

Remove `defaulted` from every successful return object. Replace the final `byId.get(1)` branch with:

```ts
throw new CategoryMatchRequiredError();
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- tests/services/category-matcher.test.ts
```

Expected: the category matcher test file passes with no ID 1 default.

- [ ] **Step 5: Inspect and commit the matcher change**

Run:

```powershell
git diff --check
git diff -- server/services/categoryMatcher.ts tests/services/category-matcher.test.ts
```

Expected: only the matcher and its focused test are modified; no whitespace errors.

Commit:

```powershell
git add server/services/categoryMatcher.ts tests/services/category-matcher.test.ts
git commit -m "fix: require a valid mapped category"
```

### Task 2: Surface the unmatched category safely

**Files:**
- Modify: `tests/server/api.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the failing HTTP 422 test**

Import the typed error in `tests/server/api.test.ts`:

```ts
import {
  CATEGORY_MATCH_REQUIRED_MESSAGE,
  CategoryMatchRequiredError
} from "../../server/services/categoryMatcher";
```

Add this test beside the full-field error mapping tests:

```ts
test("asks for a more specific category hint when no live category matches", async () => {
  const response = await request(createApp({
    generateProductFields: async () => {
      throw new CategoryMatchRequiredError();
    }
  }))
    .post("/api/generate-product-fields")
    .field("input", JSON.stringify(productInput))
    .field("identity", JSON.stringify({
      sku: "Elosung10000",
      eanCode: "4748549810"
    }))
    .attach("images", pngImage, {
      filename: "product.png",
      contentType: "image/png"
    })
    .expect(422);

  expect(response.body).toEqual({ error: CATEGORY_MATCH_REQUIRED_MESSAGE });
});
```

- [ ] **Step 2: Run the new API test and verify RED**

Run:

```powershell
npm test -- tests/server/api.test.ts -t "asks for a more specific category hint"
```

Expected: FAIL because the typed error is still mapped to HTTP 500 and `Internal server error`.

- [ ] **Step 3: Map only the typed error to 422**

Import `CategoryMatchRequiredError` in `server/app.ts` and add this branch immediately after the `ProductFieldRequestError` branch in `mapGenerationError`:

```ts
if (kind === "fields" && error instanceof CategoryMatchRequiredError) {
  return { status: 422, message: error.message };
}
```

Do not expose arbitrary `Error.message` values and do not change `sendSafeError`.

- [ ] **Step 4: Run safe error tests and verify GREEN**

Run:

```powershell
npm test -- tests/server/api.test.ts -t "category hint|safe failing full-field stage|does not leak"
```

Expected: the new 422 test passes and unrelated internal/provider errors remain sanitized.

- [ ] **Step 5: Commit the API behaviour**

Run:

```powershell
git diff --check
git diff -- server/app.ts tests/server/api.test.ts
git add server/app.ts tests/server/api.test.ts
git commit -m "fix: surface unmatched category guidance"
```

Expected: one focused API commit with no frontend changes.

### Task 3: Remove General Goods fallback behaviour from workflows

**Files:**
- Modify: `tests/services/product-research.test.ts`
- Modify: `tests/services/product-workflow.test.ts`
- Modify: `server/services/productResearch.ts`
- Modify: `server/services/dszRules.ts`

- [ ] **Step 1: Replace downstream default expectations with typed failures**

Remove the `General Goods` row from the `categoryMapping` fixture in
`tests/services/product-research.test.ts` and from `mappedCategories` plus local
mapping fixtures in `tests/services/product-workflow.test.ts`.

Replace the product-research default test with:

```ts
test("requires a category hint when an invalid semantic ID has no local match", () => {
  const raw = researchFixture();

  expect(() => validateProductResearch({
    raw: {
      ...raw,
      category: { id: 999999, name: "Invented category" }
    },
    annotatedUrls: ["https://supplier.example.com/item"],
    categoryMapping,
    input: { ...manualInput, categoryHint: "unclassifiable phrase" }
  })).toThrow(CATEGORY_MATCH_REQUIRED_MESSAGE);
});
```

Import `CATEGORY_MATCH_REQUIRED_MESSAGE` from `categoryMatcher` in both test
files. Replace the two workflow tests that expect ID 1 with rejections:

```ts
await expect(generateDszFieldsWithPacky({
  productInput: {
    ...input,
    categoryHint: "unclassifiable phrase"
  },
  env: {},
  ruleDocuments: {
    fieldRules: "Current DSZ field rules.",
    productPrompt: "Current product prompt.",
    categoryMapping: "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
    uploadSop: "Current upload SOP.",
    productUploadAu: "Current AU rules."
  }
})).rejects.toThrow(CATEGORY_MATCH_REQUIRED_MESSAGE);
```

Use the same rejection for the unmatched Chinese-hint test while retaining its
existing `mappedCategories` fixture and seller text.

- [ ] **Step 2: Run downstream tests, then expose obsolete type references**

Run:

```powershell
npm test -- tests/services/product-research.test.ts tests/services/product-workflow.test.ts
npm run typecheck
```

Expected: the behavioural tests pass because Task 1 already throws the typed
error, then `npm run typecheck` fails where production code still reads the
removed `categoryResolution.defaulted` property. This is the cleanup RED state.

- [ ] **Step 3: Remove unreachable default handling**

In `server/services/productResearch.ts`, delete the
`categoryResolution.defaulted` issue block. In `server/services/dszRules.ts`:

- remove `"| General Goods | default / unclassified | ID: 1 |"` from
  `BUILT_IN_RULE_DOCUMENTS.categoryMapping`;
- remove the `categoryResolution.defaulted` review-note spread from
  `buildFallbackFields`;
- remove the `categoryResolution.defaulted` review-note block from
  `completeGeneratedFields`.

Do not change successful manual, hint, model, or local category resolution.

- [ ] **Step 4: Run downstream tests and verify GREEN**

Run:

```powershell
npm test -- tests/services/product-research.test.ts tests/services/product-workflow.test.ts
npm run typecheck
```

Expected: both files and type checking pass; valid hint/model categories retain
their canonical IDs and unmatched categories throw the typed error.

- [ ] **Step 5: Commit the workflow cleanup**

Run:

```powershell
git diff --check
git add server/services/productResearch.ts server/services/dszRules.ts tests/services/product-research.test.ts tests/services/product-workflow.test.ts
git commit -m "fix: remove invalid category fallback"
```

### Task 4: Download and install the live 799-category snapshot

**Files:**
- Modify: `tests/services/category-matcher.test.ts`
- Modify: `rules/Category_Mapping.md`

- [ ] **Step 1: Add the failing checked-in snapshot test**

At the top of `tests/services/category-matcher.test.ts`, import `readFileSync`
from `node:fs` and load the repository mapping:

```ts
const liveMapping = readFileSync(
  new URL("../../rules/Category_Mapping.md", import.meta.url),
  "utf8"
);
```

Add:

```ts
test("parses the complete live Dropshipzone category snapshot", () => {
  const entries = parseCategoryEntries(liveMapping);

  expect(entries).toHaveLength(799);
  expect(new Set(entries.map((entry) => entry.id))).toHaveSize(799);
  expect(entries).toContainEqual({
    id: 1143,
    name: "Home & Garden / Bedding"
  });
  expect(entries.some((entry) => entry.id === 1)).toBe(false);
  expect(entries.some((entry) => entry.id === 12004)).toBe(false);
});
```

- [ ] **Step 2: Run the snapshot test and verify RED**

Run:

```powershell
npm test -- tests/services/category-matcher.test.ts -t "complete live Dropshipzone"
```

Expected: FAIL because the old file parses 275 rows, contains ID 1 and maps
Bedding to stale ID 12004.

- [ ] **Step 3: Fetch and validate the production category response without exposing credentials**

Run this PowerShell in one tool call. It reads production secrets without
printing them, validates the response and emits only a JSON object containing
the count, Bedding ID and Base64-encoded generated document:

```powershell
$vercel = Join-Path $env:APPDATA 'npm\vercel.cmd'
$projectId = 'prj_ZNTDaHLGAQdAMi5XsHaD0wNhnzzn'
$scope = 'stevens-projects-08c9c5b0'

function Invoke-VercelJson([string]$path) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $raw = & $vercel api $path --scope $scope --raw 2>$null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0 -or -not $raw) {
    throw "Vercel API lookup failed for $path"
  }
  return $raw | ConvertFrom-Json
}

$environment = Invoke-VercelJson "/v10/projects/$projectId/env"
function Get-ProductionValue([string]$key) {
  $entry = @($environment.envs | Where-Object {
    $_.key -eq $key -and $_.target -contains 'production'
  })[0]
  if (-not $entry) {
    throw "Missing production environment variable: $key"
  }
  return [string]((
    Invoke-VercelJson "/v1/projects/$projectId/env/$($entry.id)"
  ).value)
}

$baseUrl = 'https://services.dropshipzone.com.au/admin/api/supplier/v1'
$auth = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth" -ContentType 'application/json' -Body (@{
  email = (Get-ProductionValue 'ADMIN_API_EMAIL')
  password = (Get-ProductionValue 'ADMIN_API_PASSWORD')
} | ConvertTo-Json -Compress)
$token = if ($auth.token) { $auth.token } else { $auth.data.token }
if (-not $token) {
  throw 'Dropshipzone authentication returned no token.'
}

$response = Invoke-RestMethod -Method Get -Uri "$baseUrl/new_categories" -Headers @{
  Authorization = "jwt $token"
}
$categories = if ($response.data) {
  @($response.data)
} elseif ($response.categories) {
  @($response.categories)
} else {
  @($response)
}

if ($categories.Count -ne 799) {
  throw "Expected 799 categories, received $($categories.Count)."
}
if (@($categories | Where-Object {
  [string]$_.is_active -ne '1'
}).Count -ne 0) {
  throw 'The response contains inactive categories.'
}

$byId = @{}
foreach ($category in $categories) {
  $id = [string]$category.category_id
  if ($id -notmatch '^\d+$' -or [int]$id -le 0) {
    throw "Invalid category ID: $id"
  }
  if ($byId.ContainsKey($id)) {
    throw "Duplicate category ID: $id"
  }
  if ([string]$category.name -match '[|\r\n]') {
    throw "Category name is unsafe for the Markdown parser: $id"
  }
  $byId[$id] = $category
}

$sorted = $categories | Sort-Object @{
  Expression = {
    (([string]$_.path -split '/') | ForEach-Object {
      '{0:D10}' -f [int]$_
    }) -join '/'
  }
}
$rows = foreach ($category in $sorted) {
  $pathIds = @([string]$category.path -split '/')
  if (
    $pathIds.Count -lt 3 -or
    $pathIds[0] -ne '1' -or
    $pathIds[1] -ne '342'
  ) {
    throw "Unexpected structural path: $($category.path)"
  }

  $segments = foreach ($pathId in $pathIds[2..($pathIds.Count - 1)]) {
    if (-not $byId.ContainsKey($pathId)) {
      throw "Unresolved path ID $pathId in $($category.path)"
    }
    [string]($byId[$pathId].name)
  }
  "| $($segments -join ' / ') | $($category.category_id) |"
}

$header = @(
  '# Dropshipzone 类目 ID 映射表（实时快照）'
  ''
  '> 来源：Dropshipzone Supplier API `GET /new_categories`'
  '> 更新：2026-07-14'
  '> 有效类目：799'
  '> 说明：仅包含接口当前返回的有效类目；路径前缀 `1/342` 为结构节点，不是可上传类目。'
  ''
  '| 类目路径 | Dropshipzone Category ID |'
  '|---|---:|'
)
$document = (($header + $rows) -join "`n") + "`n"
$bedding = @($categories | Where-Object {
  [int]$_.category_id -eq 1143 -and $_.name -eq 'Bedding'
})
if ($bedding.Count -ne 1 -or
  $document -notmatch '(?m)^\| Home & Garden / Bedding \| 1143 \|$') {
  throw 'Canonical Bedding mapping was not generated.'
}

[pscustomobject]@{
  count = $categories.Count
  beddingId = [int]$bedding[0].category_id
  documentBase64 = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($document)
  )
} | ConvertTo-Json -Compress
```

Expected: exit 0 with `count: 799` and `beddingId: 1143`. The output must not
contain the email, password or JWT.

- [ ] **Step 4: Decode the validated document and replace the file with `apply_patch`**

Parse the JSON stdout from Step 3 as `generated`, then decode it in orchestration
memory:

```js
const bytes = Uint8Array.from(
  atob(generated.documentBase64),
  (character) => character.charCodeAt(0)
);
const document = new TextDecoder().decode(bytes);

if (!document.startsWith("# Dropshipzone 类目 ID 映射表（实时快照）\n")) {
  throw new Error("Generated category document header is invalid.");
}
```

Use `apply_patch` to replace the complete contents of
`rules/Category_Mapping.md` with `document`. Do not use `Set-Content`, shell
redirection, or a temporary credential/data file. The applied file must end
with one newline.

- [ ] **Step 5: Validate the new snapshot**

Run:

```powershell
npm test -- tests/services/category-matcher.test.ts
rg -n '^\| Home & Garden / Bedding \| 1143 \|$' rules/Category_Mapping.md
rg -n '\| (1|12004) \|$' rules/Category_Mapping.md
git diff --check
```

Expected: matcher tests pass; Bedding has ID 1143; the stale-ID search returns
no matches; no whitespace errors.

- [ ] **Step 6: Commit the live snapshot**

Run:

```powershell
git add rules/Category_Mapping.md tests/services/category-matcher.test.ts
git commit -m "data: refresh Dropshipzone category mapping"
```

### Task 5: Remove stale category guidance from bundled rules

**Files:**
- Modify: `tests/services/product-workflow.test.ts`
- Modify: `rules/Dropshipzone_Field_Rules.md`
- Modify: `rules/Full_Product_Upload_SOP.md`

- [ ] **Step 1: Add failing bundled-rule assertions**

Extend `includes bundled category mapping and upload SOP in Packy field prompts`
in `tests/services/product-workflow.test.ts` with:

```ts
expect(rules.fieldRules).not.toContain("General Goods");
expect(rules.fieldRules).not.toContain("| 蓝牙耳机 | 6025 |");
expect(rules.uploadSop).not.toContain("General Goods (ID=1)");
expect(rules.uploadSop).not.toContain("| 蓝牙耳机 | 6025 |");
expect(rules.fieldRules).toContain("Category_Mapping.md");
expect(rules.uploadSop).toContain("Category_Mapping.md");
```

- [ ] **Step 2: Run the bundled-rule test and verify RED**

Run:

```powershell
npm test -- tests/services/product-workflow.test.ts -t "includes bundled category mapping"
```

Expected: FAIL because both rule documents still contain the invalid fallback
and stale quick-reference IDs.

- [ ] **Step 3: Replace stale field-rule guidance**

In `rules/Dropshipzone_Field_Rules.md`:

- change the priority to operator hint, then AI recognition, then explicit
  failure requiring a more specific hint;
- update the `/new_categories` verification date to `2026-07-14`;
- state that only IDs returned by the current endpoint may be uploaded;
- state that `1/342` is a structural prefix and ID 1 must not be used as
  `General Goods`;
- replace the static category table with a single canonical-source statement
  pointing to `Category_Mapping.md`.

- [ ] **Step 4: Replace stale upload-SOP guidance**

In `rules/Full_Product_Upload_SOP.md`:

- replace the `General Goods (ID=1)` fallback with the actionable-hint failure;
- make the output example use a generic current mapping path without a hard-coded
  category ID;
- replace the stale Top 20 ID table with a statement that
  `Category_Mapping.md` is the only category-code reference.

- [ ] **Step 5: Run the rule test and audit stale guidance**

Run:

```powershell
npm test -- tests/services/product-workflow.test.ts -t "includes bundled category mapping"
rg -n 'General Goods|6024|6025|6027|6028|12018|12025|11008|11007|11005|4006|15003|14003|ID: 6025' rules/Dropshipzone_Field_Rules.md rules/Full_Product_Upload_SOP.md
git diff --check
```

Expected: the test passes; the stale-guidance search returns no matches; no
whitespace errors.

- [ ] **Step 6: Commit the canonical rule guidance**

Run:

```powershell
git add rules/Dropshipzone_Field_Rules.md rules/Full_Product_Upload_SOP.md tests/services/product-workflow.test.ts
git commit -m "docs: use live category mapping as source of truth"
```

### Task 6: Run repository-wide verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused category and API tests**

Run:

```powershell
npm test -- tests/services/category-matcher.test.ts tests/services/product-research.test.ts tests/services/product-workflow.test.ts tests/server/api.test.ts
```

Expected: all four files pass with zero failures.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: all test files pass with zero failures.

- [ ] **Step 3: Run type checking and lint**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands exit 0 with no TypeScript or ESLint errors.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: `tsc -b && vite build` exits 0 and produces `dist`.

- [ ] **Step 5: Audit the final diff and branch state**

Run:

```powershell
git diff --check origin/feature/product-ai-workbench...HEAD
git status --short --branch
git log -8 --oneline --decorate
```

Expected: the worktree is clean; the design, plan, matcher, API, live snapshot,
and rule-guidance commits are present. No push or deployment occurs without a
separate explicit user request.
