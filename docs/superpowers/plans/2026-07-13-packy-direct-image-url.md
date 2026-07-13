# Packy Direct Image URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GPT-Image-2 return a provider-hosted HTTPS URL so the five-role workflow does not depend on ImgBB in normal production use.

**Architecture:** Add Packy's documented URL response fields to the existing shared `/v1/images/edits` multipart request builder. Keep the current strict HTTPS response validation and all role orchestration unchanged.

**Tech Stack:** TypeScript, Packy Images API, FormData, Vitest, Vercel.

---

### Task 1: Request a Packy-hosted URL

**Files:**
- Modify: `server/services/packyImages.ts`
- Test: `tests/services/packy-image-role.test.ts`

- [ ] **Step 1: Write the failing request test**

In `sends every source image in one fixed GPT-Image-2 multipart request`, add:

```ts
expect(form.get("response_format")).toBe("url");
expect(form.get("output_format")).toBe("png");
```

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
npm test -- tests/services/packy-image-role.test.ts
```

Expected: the request test fails because both fields are currently absent.

- [ ] **Step 3: Add the two Packy request fields**

Add these entries to `buildPackyEditRequest(...).fields`:

```ts
response_format: "url",
output_format: "png"
```

- [ ] **Step 4: Verify targeted and full checks**

Run:

```powershell
npm test -- tests/services/packy-image-role.test.ts
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: 43 targeted tests and all project checks pass.

- [ ] **Step 5: Commit the implementation**

```powershell
git add server/services/packyImages.ts tests/services/packy-image-role.test.ts
git commit -m "fix: request hosted Packy image URLs"
```

### Task 2: Verify and deploy

**Files:**
- No source changes expected.

- [ ] **Step 1: Run one live Packy image-edit probe**

Send one source image with `response_format=url` and `output_format=png`.
Expected: HTTP 200 with one absolute HTTPS URL and no `b64_json` dependency.

- [ ] **Step 2: Integrate and push**

Fast-forward `feature/product-ai-workbench` to the implementation branch and push it to `origin`.

- [ ] **Step 3: Deploy and verify production**

Run:

```powershell
vercel --prod --yes
```

Expected: the Vercel build completes without TypeScript errors, the production alias is `https://dsz-genpic.vercel.app`, and one `/api/generate-product-image-role` request returns an HTTPS URL.

