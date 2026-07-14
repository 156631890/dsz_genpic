# Returns and Delivery Footer Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DSZ system prompt's canonical returns and delivery footer with the exact supplied HTML while keeping strict product-copy parsing, validation, repair, and local fallback behaviour working.

**Architecture:** First extend the canonical footer parser and description validator to understand the supplied `<h2>`, exact `</p >`, and U+2013 en dash without changing the active footer. Then replace the user-owned prompt and server fallback together, tighten canonical phrase validation to the new policy, and update regression fixtures. Keep the supplied prompt text, blank-line placement, punctuation, and tag spacing unchanged and make no frontend, upload-field, shipping-price, or unrelated rule-document changes.

**Tech Stack:** TypeScript, Node.js filesystem rules, Vitest, strict HTML token validation, Packy product-copy workflow.

---

## File Map

- Modify `tests/services/product-copy.test.ts`: define the supplied footer contract and cover parser, exact-token, character, and legacy-footer rejection behaviour.
- Modify `server/services/productCopy.ts`: support the new allowed tokens, structural parsing, required phrases, and en dash.
- Modify `rules/DSZ系统prompt 4月20版本.txt`: replace the canonical block exactly and make surrounding tag/character rules internally consistent.
- Modify `tests/services/product-workflow.test.ts`: cover bundled prompt and local fallback use of the new footer.
- Modify `server/services/dszRules.ts`: keep built-in rule documents and local fallback output aligned with the user-owned prompt.

### Task 1: Add parser and validator compatibility for the supplied HTML

**Files:**
- Modify: `tests/services/product-copy.test.ts:12-340`
- Modify: `server/services/productCopy.ts:19-29,62-70,159-166,385-429,456-466`

- [ ] **Step 1: Write a failing synthetic-footer compatibility test**

Add these constants after `validTitle` in `tests/services/product-copy.test.ts`:

```ts
const suppliedFooterSource = [
  "<h2>Returns, Refunds and Replacements</h2>",
  "<p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p >",
  "<p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p >",
  "",
  "<h2>Delivery Timeframe</h2>",
  "<p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >"
].join("\n");
const suppliedFooterSingleLine = suppliedFooterSource.replace(/\n/g, " ");
```

Add this test inside `describe("product copy validation", ...)` before the existing loaded-footer extraction tests:

```ts
test("accepts the exact supplied h2 footer without rewriting its tokens", () => {
  const suppliedPrompt = [
    "【固定页脚规则】",
    "- 固定页脚如下：",
    suppliedFooterSource,
    "【格式清洗规则】"
  ].join("\n");

  const extracted = extractCanonicalProductFooter(suppliedPrompt);

  expect(extracted).toBe(suppliedFooterSingleLine);
  expect(extracted).toContain("</p >");
  expect(extracted).toContain("5–12");
  expect(validateProductCopy({
    title: validTitle,
    description: `${descriptionPrefix}${extracted}`
  }, extracted)).toEqual([]);
});
```

In the existing unsupported-tag table, replace the `h2 tag` case with an `h3 tag` case because `<h2>` becomes intentionally supported:

```ts
["h3 tag", `${descriptionPrefix}<h3>More</h3>${canonicalFooter}`, unsupportedTagError],
```

Add this case to the existing structurally invalid HTML table to lock the compatibility exception to the exact supplied spacing:

```ts
["unsupported spaced closing p", `<p>Invalid</p  >${canonicalFooter}`],
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run:

```bash
npm test -- tests/services/product-copy.test.ts -t "accepts the exact supplied h2 footer"
```

Expected: FAIL with `DSZ system prompt does not contain the canonical product footer.` because `<h2>`, `</p >`, `local consumer laws`, and the en dash are not yet supported. The failure must come from the new behavioural assertion, not test setup.

- [ ] **Step 3: Implement the minimal compatibility layer**

Extend `ALLOWED_HTML_TAGS` in `server/services/productCopy.ts` without permitting arbitrary tag spacing:

```ts
const ALLOWED_HTML_TAGS = new Set([
  "<h2>",
  "</h2>",
  "<p>",
  "</p>",
  "</p >",
  "<strong>",
  "</strong>",
  "<ul>",
  "</ul>",
  "<li>",
  "</li>",
  "<br />"
]);
```

During this compatibility task, allow either the currently active ACL phrase or the supplied replacement phrase so the old prompt remains loadable until Task 2 switches it atomically. Update the phrase checks in `extractCanonicalProductFooter` to:

```ts
!footer.includes("Returns, Refunds and Replacements") ||
!(
  footer.includes("local consumer laws") ||
  footer.includes("Australian Consumer Law (ACL)")
) ||
!footer.includes("Delivery Timeframe")
```

Permit only U+2013 in addition to the existing printable ASCII description characters:

```ts
!/^[\x20-\x7E\u2013]*$/.test(decodedTextNodes.value) ||
```

Add this helper immediately before `hasInvalidHtmlStructure`:

```ts
function normalizeStructuralTag(token: string): string {
  return token === "</p >" ? "</p>" : token;
}
```

Use the exact token for allow-list checks, but use the normalized token for stack checks in `hasInvalidHtmlStructure`:

```ts
if (!ALLOWED_HTML_TAGS.has(token)) return true;
hasAllowedElement = true;
const structuralToken = normalizeStructuralTag(token);

if (structuralToken === "<br />") {
  if (!isTextContainer(stack.at(-1))) return true;
  continue;
}

const match = structuralToken.match(/^<(\/)?(h2|p|strong|ul|li)>$/);
```

Change the top-level element rule so `<h2>` remains a root element:

```ts
if ((name === "h2" || name === "p") && parent !== undefined) return true;
```

In `extractRootText`, normalize the token before matching so `</p >` correctly closes its stack entry and `<h2>` boundaries remain visible to Markdown detection:

```ts
const structuralToken = normalizeStructuralTag(token);
const match = structuralToken.match(/^<(\/)?(h2|p|strong|ul|li)>$/);
```

Do not add `h2` to `isTextContainer`; the supplied headings contain plain text and do not require nested `<strong>` or `<br />`.

- [ ] **Step 4: Run the complete product-copy test file and verify GREEN**

Run:

```bash
npm test -- tests/services/product-copy.test.ts
```

Expected: 177 tests PASS. The active bundled footer is still the old one, while the new synthetic footer also parses and validates.

- [ ] **Step 5: Inspect and commit the compatibility change**

Run:

```bash
git diff --check
git diff -- server/services/productCopy.ts tests/services/product-copy.test.ts
git status --short
```

Expected: only the two Task 1 files are modified and no whitespace errors are reported.

Commit:

```bash
git add server/services/productCopy.ts tests/services/product-copy.test.ts
git commit -m "feat: support supplied returns footer HTML"
```

### Task 2: Replace the canonical prompt and all server fallback copies

**Files:**
- Modify: `rules/DSZ系统prompt 4月20版本.txt:83-89,189-203`
- Modify: `tests/services/product-copy.test.ts:70-340`
- Modify: `server/services/productCopy.ts:62-72`
- Modify: `tests/services/product-workflow.test.ts:510-635,756-830`
- Modify: `server/services/dszRules.ts:83-119`

- [ ] **Step 1: Write failing exact-prompt, legacy-rejection, and fallback assertions**

Extend the existing `loads the exact UTF-8 DSZ system prompt` test in `tests/services/product-copy.test.ts`:

```ts
const loaded = await loadProductSystemPrompt();
expect(loaded).toBe(expected);
const normalizedLoaded = loaded.replace(/\r\n/g, "\n");
expect(normalizedLoaded).toContain(suppliedFooterSource);
expect(loaded).not.toContain("Australian Consumer Law (ACL)");
expect(loaded).not.toContain("WA, NT, and TAS");
```

Add this test beside the canonical extraction tests. It must fail while Task 1 still accepts the transitional ACL phrase:

```ts
test("rejects the legacy ACL footer as canonical", () => {
  const legacyFooter =
    "<p>Returns, Refunds and Replacements under the Australian Consumer Law (ACL).</p>" +
    "<p>Delivery Timeframe</p>";
  const suppliedPrompt = [
    "【固定页脚规则】",
    "- 固定页脚如下：",
    legacyFooter,
    "【格式清洗规则】"
  ].join("\n");

  expect(() => extractCanonicalProductFooter(suppliedPrompt)).toThrow(
    /canonical product footer/i
  );
});
```

Update the existing bundled canonical-footer expectations to the new contract:

```ts
expect(canonicalFooter).toMatch(/^<h2>/);
expect(canonicalFooter).toMatch(/<\/p >$/);
expect(canonicalFooter).toContain("Products received faulty");
expect(canonicalFooter).toContain("local consumer laws");
expect(canonicalFooter).toContain("Delivery Timeframe");
expect(canonicalFooter).toContain("5–12 business days");
expect(canonicalFooter).not.toContain("Australian Consumer Law (ACL)");
```

Update the multiline extraction fixture from `Products that are received` to `Products received`, replace the old ACL expectation with `local consumer laws`, and replace the regional expectation with `5–12 business days`.

Update the invalid canonical-footer table to:

```ts
test.each([
  ["missing consumer-laws phrase", canonicalFooter.replace("local consumer laws", "consumer rules")],
  ["missing delivery phrase", canonicalFooter.replace("Delivery Timeframe", "Shipping")],
  ["invalid HTML structure", canonicalFooter.replace("</h2>", "")]
])
```

Update exact-footer rewrite cases to use current text:

```ts
[
  "rewritten consumer-laws wording",
  `${descriptionPrefix}${canonicalFooter.replace("local consumer laws", "consumer laws")}`
],
[
  "rewritten delivery estimate",
  `${descriptionPrefix}${canonicalFooter.replace("5–12", "7–14")}`
],
```

Update the whitespace tests to replace `Returns, Refunds and Replacements</h2>` with `Returns, Refunds and Replacements </h2>` and `Products received` with `Products  received`.

In `tests/services/product-workflow.test.ts`, extend `loads bundled rule documents when external rule files are missing`:

```ts
expect(rules.productPrompt).toContain("<h2>Returns, Refunds and Replacements</h2>");
expect(rules.productPrompt).toContain("5–12 business days");
expect(rules.productPrompt).not.toContain("Australian Consumer Law (ACL)");
```

Extend `falls back to local rules when Packy field generation is temporarily unavailable`:

```ts
expect(result.fields.description).toContain(
  "<h2>Returns, Refunds and Replacements</h2>"
);
expect(result.fields.description).toContain("local consumer laws");
expect(result.fields.description).toContain("5–12 business days");
expect(result.fields.description).toContain("</p >");
expect(result.fields.description).not.toContain("Australian Consumer Law (ACL)");
expect(result.fields.description).not.toContain("For customers in Victoria");
```

Replace the old hard-coded footer suffix in the repair test with the already loaded canonical footer:

```ts
const repairedDescription =
  "<p><strong>Product Overview</strong></p>" +
  "<p>Women cotton thong underwear designed for breathable everyday comfort and smooth daily wear.</p>" +
  "<p><strong>Key Features</strong></p>" +
  "<ul><li>Soft cotton blend helps support comfortable everyday wear.</li><li>Breathable stretch fabric supports flexible movement.</li><li>Low-profile thong cut helps reduce visible lines under outfits.</li><li>Multiple colour options support easy wardrobe matching.</li></ul>" +
  "<p><strong>Why It Stands Out</strong></p>" +
  "<p>The design focuses on a practical balance of softness, stretch and everyday fit without unsupported claims.</p>" +
  "<p><strong>Notes</strong></p>" +
  "<p>Please check the selected colour and size before purchase.</p>" +
  workflowFooter;
```

- [ ] **Step 2: Run focused tests and verify the RED state**

Run:

```bash
npm test -- tests/services/product-copy.test.ts tests/services/product-workflow.test.ts
```

Expected: FAIL because the loaded prompt and server fallback still contain the old ACL/regional footer, and the transitional parser still accepts the legacy ACL fixture. Failures must be assertion failures tied to these old values.

- [ ] **Step 3: Replace the exact user-owned system-prompt block**

In `rules/DSZ系统prompt 4月20版本.txt`, make the tag rules internally consistent:

```text
- 只能使用以下 HTML 标签：
<h2> <p> <strong> <ul> <li> <br />
- 不要使用 <a>、<img>、<table>、<h1>、<div>、<span> 等其他标签。
```

Change the footer-spacing instruction so the exact tag spacing remains canonical while line breaks may be removed for single-line output:

```text
- 允许为了单行输出而移除换行，但不得改写核心文案或固定页脚标签。
```

Replace the old footer with this exact block, including its blank line and `</p >` tokens:

```html
<h2>Returns, Refunds and Replacements</h2>
<p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p >
<p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p >

<h2>Delivery Timeframe</h2>
<p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >
```

Update the character rule to acknowledge the required en dash:

```text
- 仅保留必要英文字符、数字、空格、标准英文标点、固定页脚中的 en dash（–）和 HTML 标签。
```

- [ ] **Step 4: Tighten canonical parsing to the replacement policy**

In `extractCanonicalProductFooter`, remove the transitional ACL alternative from Task 1. The final required phrase checks must be:

```ts
!footer.includes("Returns, Refunds and Replacements") ||
!footer.includes("local consumer laws") ||
!footer.includes("Delivery Timeframe")
```

This makes the old footer invalid once the exact replacement is active.

- [ ] **Step 5: Synchronize the built-in and local fallback footer**

Replace `FOOTER` in `server/services/dszRules.ts` with the same text and exact tokens in single-line runtime form:

```ts
const FOOTER =
  "<h2>Returns, Refunds and Replacements</h2><p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p ><p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p ><h2>Delivery Timeframe</h2><p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >";
```

Update the built-in fallback prompt lines to:

```ts
"Allowed HTML tags only: <h2>, <p>, <strong>, <ul>, <li>, <br />.",
"Include Product Overview, Key Features and Notes sections when useful.",
"Always include this fixed Returns and Delivery Timeframe footer:",
FOOTER
```

Do not edit `rules/Product_Upload_AU.md`; `buildDszGenerationMessages` explicitly makes `PRODUCT PROMPT` the only title/description writing source.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/services/product-copy.test.ts tests/services/product-workflow.test.ts
```

Expected: both files PASS with 240 tests total: 178 product-copy tests and 62 product-workflow tests.

- [ ] **Step 7: Audit old production wording and commit the replacement**

Run:

```bash
rg -n "Australian Consumer Law|Products that are received|WA, NT, and TAS|For customers in Victoria|7-10 working|9-12 working" "rules/DSZ系统prompt 4月20版本.txt" server
git diff --check
git status --short
```

Expected: the old production wording search returns no matches; only the five Task 2 files are modified; `git diff --check` reports no whitespace errors.

Commit:

```bash
git add "rules/DSZ系统prompt 4月20版本.txt" server/services/productCopy.ts server/services/dszRules.ts tests/services/product-copy.test.ts tests/services/product-workflow.test.ts
git commit -m "feat: replace returns and delivery footer"
```

### Task 3: Run repository-wide verification

**Files:**
- Verify: `rules/DSZ系统prompt 4月20版本.txt`
- Verify: `server/services/productCopy.ts`
- Verify: `server/services/dszRules.ts`
- Verify: `tests/services/product-copy.test.ts`
- Verify: `tests/services/product-workflow.test.ts`

- [ ] **Step 1: Verify the prompt contains the exact supplied multiline block**

Run:

```powershell
$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath 'rules\DSZ系统prompt 4月20版本.txt'
$expected = @'
<h2>Returns, Refunds and Replacements</h2>
<p>Products received faulty, damaged, or not as described are eligible for a return, refund, or replacement in accordance with local consumer laws. We are committed to ensuring all products meet the standards of quality and reliability expected by our customers.</p >
<p>Please note that we do not accept returns or provide refunds for change of mind. We encourage you to carefully consider your purchase to ensure it meets your needs and expectations.</p >

<h2>Delivery Timeframe</h2>
<p>Delivery is approximately 5–12 business days (excluding weekends and public holidays).</p >
'@
$normalizedPrompt = $prompt -replace "`r`n", "`n"
$normalizedExpected = ($expected -replace "`r`n", "`n").TrimEnd([char]10)
if (-not $normalizedPrompt.Contains($normalizedExpected)) { throw 'Exact footer block missing' }
```

Expected: exit 0 with no exception.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: 12 test files and 506 tests PASS with 0 failures.

- [ ] **Step 3: Run type checking and lint**

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

Expected: `tsc -b && vite build` exits 0 and produces `dist`.

- [ ] **Step 5: Verify final branch state**

Run:

```bash
git status -sb
git log -4 --oneline --decorate
```

Expected: the worktree is clean on `feature/returns-delivery-footer`; the parser-compatibility commit and footer-replacement commit follow the design and implementation-plan documents. No push or deployment occurs without explicit user approval.
