# GitHub Generated Image Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Packy base64 image results through stable public GitHub raw URLs instead of the rate-limited ImgBB account.

**Architecture:** Add a focused GitHub Contents API storage adapter and select it whenever dedicated GitHub image configuration is present. Preserve the existing Packy request, role ordering, HTTPS validation, and legacy ImgBB fallback for environments that have not enabled GitHub storage.

**Tech Stack:** TypeScript, GitHub Contents API, Packy Images API, Vitest, Vercel.

---

### Task 1: GitHub image storage adapter

**Files:**
- Create: `server/services/githubImageStorage.ts`
- Create: `tests/services/github-image-storage.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Cover these behaviours with an injected `fetchImpl`:

```ts
expect(requestUrl).toMatch(
  /^https:\/\/api\.github\.com\/repos\/156631890\/dsz_genpic\/contents\/generated-images\//
);
expect(requestInit.headers).toMatchObject({
  Authorization: "Bearer github-token",
  Accept: "application/vnd.github+json"
});
expect(JSON.parse(String(requestInit.body))).toMatchObject({
  branch: "generated-images",
  content: pngBuffer.toString("base64")
});
expect(result.imageUrls[0]).toMatch(
  /^https:\/\/raw\.githubusercontent\.com\/156631890\/dsz_genpic\/generated-images\/generated-images\//
);
```

Add separate tests proving a `409` is retried three times and a `401` produces
`GitHub image upload failed: 401` without including the token or response body.

- [ ] **Step 2: Run the adapter tests and verify RED**

```powershell
npm test -- tests/services/github-image-storage.test.ts
```

Expected: FAIL because `githubImageStorage.ts` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `uploadImagesToGithub({ files, env, fetchImpl })`. Validate
`GITHUB_IMAGE_REPOSITORY` as `owner/repository`, validate the branch as a simple
Git ref segment, generate `generated-images/YYYY/MM/<uuid>.<extension>`, send a
base64 Contents API `PUT`, retry status `409` up to three times, and return raw
GitHub HTTPS URLs. Never read or include an error response body.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/services/github-image-storage.test.ts
```

Expected: all adapter tests pass.

- [ ] **Step 5: Commit the adapter**

```powershell
git add server/services/githubImageStorage.ts tests/services/github-image-storage.test.ts
git commit -m "feat: store generated images on GitHub"
```

### Task 2: Use GitHub for Packy base64 results

**Files:**
- Modify: `server/services/packyImages.ts`
- Modify: `tests/services/packy-image-role.test.ts`

- [ ] **Step 1: Write the failing integration test**

Return Packy `b64_json`, configure:

```ts
{
  PACKY_IMAGE_API_KEY: "role-key",
  GITHUB_IMAGE_TOKEN: "github-token",
  GITHUB_IMAGE_REPOSITORY: "156631890/dsz_genpic",
  GITHUB_IMAGE_BRANCH: "generated-images"
}
```

Then return `201` for the GitHub Contents API call and assert that the role URL
uses `raw.githubusercontent.com` and no ImgBB URL is called.

- [ ] **Step 2: Run the role test and verify RED**

```powershell
npm test -- tests/services/packy-image-role.test.ts
```

Expected: FAIL because base64 delivery still calls ImgBB.

- [ ] **Step 3: Select GitHub storage when configured**

Import `uploadImagesToGithub`. In `resolvePackyImageUrls`, use it when
`GITHUB_IMAGE_TOKEN`, `GITHUB_IMAGE_REPOSITORY`, and `GITHUB_IMAGE_BRANCH` are
present; otherwise retain the existing ImgBB call. Keep strict HTTPS validation
after upload.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- tests/services/packy-image-role.test.ts
git add server/services/packyImages.ts tests/services/packy-image-role.test.ts
git commit -m "fix: deliver Packy images through GitHub"
```

### Task 3: Production configuration visibility and branch suppression

**Files:**
- Modify: `.env.example`
- Modify: `server/app.ts`
- Modify: `tests/server/api.test.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the failing health test**

Configure the three GitHub variables and expect `/api/health` to return:

```ts
githubImageStorageConfigured: true
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/server/api.test.ts
```

Expected: FAIL because the health property is absent.

- [ ] **Step 3: Add configuration and Vercel branch suppression**

Add the three variable names to `.env.example`, add the health boolean, and add:

```json
"git": {
  "deploymentEnabled": {
    "generated-images": false
  }
}
```

to `vercel.json`.

- [ ] **Step 4: Run complete verification and commit**

```powershell
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all project checks pass.

```powershell
git add .env.example server/app.ts tests/server/api.test.ts vercel.json
git commit -m "chore: configure GitHub image delivery"
```

### Task 4: Configure, integrate, and verify production

**Files:**
- No source changes expected.

- [ ] **Step 1: Push application commits to the default branch**

Fast-forward `feature/product-ai-workbench` to this branch and push it to
`origin`.

- [ ] **Step 2: Create the storage branch**

Create `refs/heads/generated-images` from the new remote default-branch SHA if
it does not already exist.

- [ ] **Step 3: Configure Vercel Production**

Set `GITHUB_IMAGE_TOKEN` as sensitive and set the repository and branch values.
Do not print or persist the token.

- [ ] **Step 4: Deploy and verify**

Run `vercel --prod --yes`. Verify health reports GitHub image storage enabled,
then run one production `/api/generate-product-image-role` request.

Expected: HTTP 200 and an HTTPS URL whose host is
`raw.githubusercontent.com`.

