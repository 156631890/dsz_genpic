# Independent Packy Responses Implementation Plan

> Execution: follow the repository TDD workflow and verify each task before moving on.

**Goal:** Decouple title/description generation from ImgBB and image generation while switching Packy text calls to the Responses API.

**Architecture:** Preserve the existing Express boundary and validation pipeline. Change only provider transport and credential selection on the server, then remove the browser's source-upload prerequisite for copy generation.

**Tech stack:** React, TypeScript, Express, Vitest, Vite.

## Task 1: Responses transport and independent text key

**Files:** `tests/services/product-copy.test.ts`, `server/services/productCopy.ts`

1. Add tests asserting `PACKY_TEXT_API_KEY` precedence, `/v1/responses`, `instructions`, `input`, `store: false`, and both supported response shapes.
2. Run the focused test and confirm it fails for the old chat-completions behavior.
3. Add the smallest Responses request builder/parser while retaining existing copy validation.
4. Run the focused test and confirm it passes.

## Task 2: Independent image key and health flags

**Files:** `tests/services/packy-image-role.test.ts`, `tests/server/api.test.ts`, `server/services/packyImages.ts`, `server/app.ts`, `.env.example`

1. Add tests asserting image-role requests prefer `PACKY_IMAGE_API_KEY` and health reports text/image configuration independently.
2. Run focused tests and confirm the new assertions fail.
3. Implement key selection and health checks; document both optional dedicated keys.
4. Run focused tests and confirm they pass.

## Task 3: Remove copy's ImgBB dependency

**Files:** `tests/App.test.tsx`, `src/App.tsx`

1. Update the workflow test to assert copy posts directly with `imageUrls: []` and never calls `/api/upload-images`.
2. Run the focused UI test and confirm failure against the old upload-first flow.
3. Remove only the upload call and upload-task transitions from `runCopyTask`; leave the reusable upload client untouched.
4. Run the focused UI test and confirm it passes.

## Task 4: Verify, integrate, and deploy

1. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
2. Inspect `git diff --check`, status, and the scoped diff.
3. Commit the implementation, integrate it into `feature/product-ai-workbench`, and push.
4. Configure dedicated Vercel environment variable names without printing values, wait for deployment, then probe `/api/health` and the live copy endpoint.
5. Report application results separately from any provider-side token-group error.
