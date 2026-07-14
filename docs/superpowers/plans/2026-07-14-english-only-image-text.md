# English-Only Generated Image Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append one non-overridable English-only visible-text policy to every outgoing Packy image-generation prompt.

**Architecture:** Keep language enforcement in `buildPackyEditRequest`, the final request builder shared by fixed-role generation, role retries, the legacy single-image route, and the legacy five-image route. Add no UI, API fields, OCR, review calls, or new dependencies; tests inspect both the shared request and the actual multipart prompts sent by each generation path.

**Tech Stack:** TypeScript, Express service helpers, Packy GPT Image API multipart requests, Vitest.

---

## File Map

- Modify `server/services/packyImages.ts`: define the shared policy and append it after all caller-controlled prompt content.
- Modify `tests/services/product-workflow.test.ts`: specify the full policy contract, final ordering, and legacy single/five-image request coverage.
- Modify `tests/services/packy-image-role.test.ts`: verify fixed-role generation sends the shared policy in its actual multipart request.
- No frontend, API schema, configuration, or dependency files change.

### Task 1: Enforce the shared final image-text policy

**Files:**
- Modify: `tests/services/product-workflow.test.ts:1014-1180`
- Modify: `tests/services/packy-image-role.test.ts:101-135`
- Modify: `server/services/packyImages.ts:7-12,81-96`

- [ ] **Step 1: Write the failing shared-policy and outgoing-request assertions**

In `tests/services/product-workflow.test.ts`, add this test inside `describe("Packy image helpers", ...)` immediately before the existing request-config test:

```ts
test("appends the complete English-only image-text policy after caller content", () => {
  const callerPrompt = "Keep this caller instruction before the final policy.";
  const request = buildPackyEditRequest({
    prompt: callerPrompt,
    productType: "Packaged product"
  });
  const prompt = request.fields.prompt;
  const rules = [
    "All visible readable text in the generated image must be English only.",
    "Remove all Chinese and other non-English text from the source image, including brand names, trademarks, product labels, and packaging text.",
    "Translate source text into English only when its exact meaning is supported by the supplied product information or visible source context; otherwise remove it.",
    "Do not invent English wording or claims, and do not generate misspellings, gibberish, or pseudo-text.",
    "If correct English text cannot be guaranteed, generate the image with no readable text."
  ];

  for (const rule of rules) {
    expect(prompt).toContain(rule);
  }
  expect(prompt.indexOf(rules[0])).toBeGreaterThan(prompt.indexOf(callerPrompt));
  expect(prompt.endsWith(rules[rules.length - 1])).toBe(true);
});
```

In the existing `uses the image-specific Packy API key and image model for image edits` test, inspect the multipart prompt so the legacy single-image path is covered:

```ts
const form = init?.body as FormData;
expect(form.get("model")).toBe("image-model");
expect(String(form.get("prompt"))).toContain(
  "All visible readable text in the generated image must be English only."
);
```

In the existing `generates the 5 Shopify images as separate one-role Packy requests` test, add this assertion inside the request mock so all five legacy prompts are checked:

```ts
expect(String(form.get("prompt"))).toContain(
  "All visible readable text in the generated image must be English only."
);
```

In `tests/services/packy-image-role.test.ts`, add the same assertion to `sends every source image in one fixed GPT-Image-2 multipart request`, after the role assertion:

```ts
expect(String(form.get("prompt"))).toContain(
  "All visible readable text in the generated image must be English only."
);
```

These assertions cover the complete rule text once and prove that the shared rule reaches fixed-role, retry-compatible, standalone legacy, and aggregate legacy request composition.

- [ ] **Step 2: Run focused tests and verify the RED state**

Run:

```bash
npm test -- tests/services/product-workflow.test.ts tests/services/packy-image-role.test.ts
```

Expected: FAIL because the current request prompt does not contain `All visible readable text in the generated image must be English only.` The failure must be an assertion failure, not a TypeScript/import/setup error.

- [ ] **Step 3: Add the minimal shared production policy**

In `server/services/packyImages.ts`, place this constant immediately after the existing image-count/quality constants:

```ts
const ENGLISH_ONLY_IMAGE_TEXT_RULES = [
  "All visible readable text in the generated image must be English only.",
  "Remove all Chinese and other non-English text from the source image, including brand names, trademarks, product labels, and packaging text.",
  "Translate source text into English only when its exact meaning is supported by the supplied product information or visible source context; otherwise remove it.",
  "Do not invent English wording or claims, and do not generate misspellings, gibberish, or pseudo-text.",
  "If correct English text cannot be guaranteed, generate the image with no readable text."
];
```

Append the constant after the existing generic ecommerce instruction in `buildPackyEditRequest`:

```ts
const prompt = [
  `Product type: ${input.productType}`,
  input.prompt,
  "Generate ecommerce product images for an independent store product page. Keep the product clear, accurate, and free of watermarks.",
  ...ENGLISH_ONLY_IMAGE_TEXT_RULES
].join("\n");
```

Do not add the policy separately to role-specific prompts. The shared final builder is the single source of truth and its final position prevents caller-controlled content from taking precedence.

- [ ] **Step 4: Run focused tests and verify the GREEN state**

Run:

```bash
npm test -- tests/services/product-workflow.test.ts tests/services/packy-image-role.test.ts
```

Expected: both test files PASS, including the full policy/order test and all actual multipart request assertions.

- [ ] **Step 5: Check the focused diff and commit the behaviour**

Run:

```bash
git diff --check
git diff -- server/services/packyImages.ts tests/services/product-workflow.test.ts tests/services/packy-image-role.test.ts
git status --short
```

Expected: only the three planned files are modified and `git diff --check` reports no whitespace errors.

Commit:

```bash
git add server/services/packyImages.ts tests/services/product-workflow.test.ts tests/services/packy-image-role.test.ts
git commit -m "feat: require English-only generated image text"
```

### Task 2: Verify repository-wide correctness and scope

**Files:**
- Verify: `server/services/packyImages.ts`
- Verify: `tests/services/product-workflow.test.ts`
- Verify: `tests/services/packy-image-role.test.ts`

- [ ] **Step 1: Audit that every image-generation path uses the shared builder**

Run:

```bash
rg -n "buildPackyEditRequest|generateImageWithPacky|generateShopifyProductImagesWithPacky|generateProductImageRoleWithPacky" server tests
```

Expected: all three generation functions in `server/services/packyImages.ts` reach `buildPackyEditRequest`; no separate provider request bypasses the final policy.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: 12 test files pass with 0 failed tests. The exact test count should be the baseline 503 plus the newly added policy test.

- [ ] **Step 3: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit 0 with no TypeScript or ESLint errors.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: `tsc -b && vite build` exits 0 and produces the `dist` bundle.

- [ ] **Step 5: Verify final branch state**

Run:

```bash
git status -sb
git log -3 --oneline --decorate
```

Expected: the worktree is clean on `feature/english-only-image-text`; the feature commit follows the committed design and implementation-plan documents. No push or production deployment occurs without an explicit user request.
