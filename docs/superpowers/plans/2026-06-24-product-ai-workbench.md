# Product AI Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working React + Express product upload workbench with Packy image-to-image, AI copy generation, editable review, and configurable Dropshipzone admin upload.

**Architecture:** React + Vite renders the internal operations UI. Express owns all provider calls, environment variables, request validation, and admin upload adapters. Shared TypeScript types keep browser/server payloads aligned.

**Tech Stack:** React 18, Vite, TypeScript, Express, Multer 2, Vitest, React Testing Library.

---

### Task 1: Project Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `.env.example`
- Create: `.gitignore`

- [x] Add scripts for `dev`, `build`, `test`, `lint`, and `typecheck`.
- [x] Install React, Vite, Express, Multer, Vitest, and testing dependencies.
- [x] Verify production dependency audit with `npm audit --omit=dev`.

### Task 2: Service Layer With Tests

**Files:**
- Create: `shared/product.ts`
- Create: `server/services/copyGenerator.ts`
- Create: `server/services/packyImages.ts`
- Create: `server/services/adminUploader.ts`
- Create: `tests/services/product-workflow.test.ts`

- [ ] Write failing tests for copy prompt construction, generated copy parsing, Packy endpoint config, admin config resolution, product payload mapping, and draft validation.
- [ ] Run `npm test -- tests/services/product-workflow.test.ts` and confirm the tests fail because modules are missing.
- [ ] Implement the minimal service code to pass those tests.
- [ ] Re-run the service test and confirm it passes.

### Task 3: Express API

**Files:**
- Create: `server/index.ts`
- Create: `tests/server/api.test.ts`

- [ ] Write failing tests for `/api/generate-copy`, `/api/generate-image`, `/api/upload-product`, and `/api/health`.
- [ ] Implement API routes that call the tested service layer.
- [ ] Return explicit missing-config errors for Packy key or admin endpoint gaps.
- [ ] Re-run the API test and confirm it passes.

### Task 4: React Workbench

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `tests/App.test.tsx`

- [ ] Write failing UI tests for visible Chinese labels and local editable workflow state.
- [ ] Implement the three-column workbench UI: base fields, generated assets/copy, upload readiness.
- [ ] Wire client calls to Express routes.
- [ ] Re-run UI tests and confirm they pass.

### Task 5: Verification

**Files:**
- Modify: project files touched above

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and verify the workbench opens locally.
- [ ] Record any unsupported real Dropshipzone upload behavior caused by missing authorized Swagger details.
