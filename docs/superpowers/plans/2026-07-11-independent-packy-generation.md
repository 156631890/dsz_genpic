# Independent Packy Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one UI action run independent GPT-5.6 SOL title/description generation and five-role GPT-Image-2 image generation, while preserving all DSZ fields and applying the approved AU/NZ shipping rules.

**Architecture:** The React client coordinates two promises with separate state and role-level image progress. Express exposes one copy route and one role-specific image route; focused provider adapters share only `PACKY_API_KEY`. Shared pure functions own DSZ shipping calculations so the form, validation, and final payload use identical rates.

**Tech Stack:** React 18, TypeScript, Vite, Express, Multer, Vitest, Testing Library, Supertest, Packy OpenAI-compatible APIs

---

## File Structure

- Create `shared/shipping.ts`: pure billable-weight and DSZ zone-rate rules used by browser and server.
- Modify `shared/product.ts`: add the two-field copy contract and fixed image-role types.
- Create `server/services/productCopy.ts`: load the user-owned prompt, build multimodal messages, call GPT-5.6 SOL, parse and validate two-line output.
- Modify `server/services/packyImages.ts`: add one no-fallback image-role generation function while retaining legacy helpers until callers are migrated.
- Modify `server/services/dszRules.ts`: make existing zone-rate construction delegate to the approved shared shipping rule.
- Modify `server/services/adminUploader.ts`: validate and submit calculated AU/NZ rates instead of overwriting them with the old NZ 10 rate.
- Modify `server/app.ts`: add independent copy and image-role routes and dependency seams.
- Create `src/productWorkflow.ts`: browser API functions with no React state.
- Modify `src/App.tsx`: initialize editable DSZ fields, orchestrate independent promises, expose role retries, and render the optimized four-tab workbench.
- Modify `src/styles.css`: implement the approved responsive visual system.
- Create `tests/services/shipping.test.ts`, `tests/services/product-copy.test.ts`, and `tests/services/packy-image-role.test.ts`: focused service tests.
- Modify `tests/server/api.test.ts` and `tests/App.test.tsx`: route independence and browser workflow coverage.
- Modify `.env.example`: document one shared credential and the approved model identifiers.

### Task 1: Shared Shipping Rules and DSZ Payload Preservation

**Files:**
- Create: `shared/shipping.ts`
- Create: `tests/services/shipping.test.ts`
- Modify: `server/services/dszRules.ts:479-498,515-604`
- Modify: `server/services/adminUploader.ts:60-78,160-219,222-244,435-447`
- Modify: `tests/services/product-workflow.test.ts:990-1020`

- [ ] **Step 1: Write failing shipping tests**

```ts
import { describe, expect, test } from "vitest";
import {
  AU_ZONE_KEYS,
  buildShippingZoneRates,
  calculateBillableWeightKg,
  calculatePackageCbm
} from "../../shared/shipping";

describe("DSZ shipping rules", () => {
  test("uses the greater of actual and volumetric weight", () => {
    expect(
      calculateBillableWeightKg({
        actualWeightKg: 1,
        lengthCm: 50,
        widthCm: 40,
        heightCm: 30
      })
    ).toBe(12);
  });

  test("keeps every Australian zone free and charges NZ 20 below 3 kg", () => {
    const rates = buildShippingZoneRates({
      actualWeightKg: 2,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10
    });

    expect(AU_ZONE_KEYS.every((key) => rates[key] === 0)).toBe(true);
    expect(rates.nz).toBe(20);
  });

  test("charges NZ 40 at the 3 kg billable-weight boundary", () => {
    expect(
      buildShippingZoneRates({
        actualWeightKg: 3,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10
      }).nz
    ).toBe(40);
  });

  test("calculates package CBM from centimetres", () => {
    expect(calculatePackageCbm(50, 40, 30)).toBe(0.06);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/services/shipping.test.ts`

Expected: FAIL because `../../shared/shipping` does not exist.

- [ ] **Step 3: Implement the shared pure functions**

```ts
export const AU_ZONE_KEYS = [
  "act",
  "nsw_m",
  "nsw_r",
  "nt_m",
  "nt_r",
  "qld_m",
  "qld_r",
  "remote",
  "sa_m",
  "sa_r",
  "tas_m",
  "tas_r",
  "vic_m",
  "vic_r",
  "wa_m",
  "wa_r"
] as const;

export interface ShippingMeasurements {
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export function calculateBillableWeightKg(input: ShippingMeasurements): number {
  const volumetricWeightKg =
    (nonNegative(input.lengthCm) *
      nonNegative(input.widthCm) *
      nonNegative(input.heightCm)) /
    5000;

  return Math.max(nonNegative(input.actualWeightKg), volumetricWeightKg);
}

export function buildShippingZoneRates(
  input: ShippingMeasurements
): Record<string, number> {
  const rates = Object.fromEntries(AU_ZONE_KEYS.map((key) => [key, 0]));
  rates.nz = calculateBillableWeightKg(input) >= 3 ? 40 : 20;
  return rates;
}

export function calculatePackageCbm(
  lengthCm: number,
  widthCm: number,
  heightCm: number
): number {
  return Number(
    ((nonNegative(lengthCm) * nonNegative(widthCm) * nonNegative(heightCm)) /
      1_000_000).toFixed(6)
  );
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/services/shipping.test.ts`

Expected: PASS with 4 tests.

- [ ] **Step 5: Add failing payload tests for dynamic rates**

Add to `tests/services/product-workflow.test.ts`:

```ts
test("builds free AU and NZ 20 shipping below 3 kg", () => {
  const payload = buildAdminProductPayload({
    ...fields,
    weight: 2,
    length: 10,
    width: 10,
    height: 10
  });

  expect(payload.zone_rates.act).toBe(0);
  expect(payload.zone_rates.nz).toBe(20);
});

test("builds NZ 40 shipping from volumetric weight at or above 3 kg", () => {
  const payload = buildAdminProductPayload({
    ...fields,
    weight: 1,
    length: 50,
    width: 40,
    height: 30
  });

  expect(payload.zone_rates.nz).toBe(40);
});
```

Change old assertions that expect `nz: 10` to expect the rate derived from the fixture measurements.

- [ ] **Step 6: Run the payload tests and verify RED**

Run: `npm test -- tests/services/product-workflow.test.ts`

Expected: FAIL because `adminUploader.ts` still replaces rates with the fixed `REQUIRED_ZONE_RATES` object containing `nz: 10`.

- [ ] **Step 7: Delegate server rate construction to the shared rule**

In `server/services/dszRules.ts`, import `buildShippingZoneRates` and replace `standardZoneRates` with:

```ts
export function standardZoneRates(input: {
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
} = {}): Record<string, number> {
  return buildShippingZoneRates({
    actualWeightKg: input.weightKg || 0,
    lengthCm: input.lengthCm || 0,
    widthCm: input.widthCm || 0,
    heightCm: input.heightCm || 0
  });
}
```

Pass the actual `weight`, `length`, `width`, and `height` to this function inside `buildFallbackFields` and `completeGeneratedFields`.

In `server/services/adminUploader.ts`, import `AU_ZONE_KEYS` and `buildShippingZoneRates`, then replace fixed normalization with:

```ts
function expectedZoneRates(fields: Pick<
  DszProductFields,
  "weight" | "length" | "width" | "height"
>): Record<string, number> {
  return buildShippingZoneRates({
    actualWeightKg: Number(fields.weight),
    lengthCm: Number(fields.length),
    widthCm: Number(fields.width),
    heightCm: Number(fields.height)
  });
}

function hasRequiredZoneRates(
  zoneRates: Record<string, number>,
  fields: Pick<DszProductFields, "weight" | "length" | "width" | "height">
): boolean {
  const expected = expectedZoneRates(fields);
  return [...AU_ZONE_KEYS, "nz"].every((key) => zoneRates[key] === expected[key]);
}
```

Call `hasRequiredZoneRates(fields.zone_rates, fields)` during validation and set `zone_rates: expectedZoneRates(fields)` in `buildAdminProductPayload`.

- [ ] **Step 8: Run shipping and workflow tests**

Run: `npm test -- tests/services/shipping.test.ts tests/services/product-workflow.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add shared/shipping.ts server/services/dszRules.ts server/services/adminUploader.ts tests/services/shipping.test.ts tests/services/product-workflow.test.ts
git commit -m "feat: apply AU and NZ shipping rules"
```

### Task 2: GPT-5.6 SOL Copy Service Using the User Prompt

**Files:**
- Modify: `shared/product.ts`
- Create: `server/services/productCopy.ts`
- Create: `tests/services/product-copy.test.ts`

- [ ] **Step 1: Add the copy and multimodal-message contract test**

```ts
import { describe, expect, test, vi } from "vitest";
import {
  buildProductCopyMessages,
  generateProductCopyWithPacky,
  parseProductCopy,
  validateProductCopy
} from "../../server/services/productCopy";

const footer =
  "<p><strong>Returns, Refunds and Replacements </strong><br />Products that are received faulty.</p><p><strong>Delivery Timeframe</strong></p>";

describe("Packy product copy", () => {
  test("uses the exact system prompt and attaches source image URLs", () => {
    const messages = buildProductCopyMessages({
      systemPrompt: "MY EXACT PROMPT",
      input: {
        sellingPoints: "Compact storage",
        categoryHint: "Home storage",
        images: ["front.png"],
        imageUrls: ["https://cdn.example.com/front.png"]
      }
    });

    expect(messages[0]).toEqual({ role: "system", content: "MY EXACT PROMPT" });
    expect(messages[1].content).toEqual(
      expect.arrayContaining([
        {
          type: "image_url",
          image_url: { url: "https://cdn.example.com/front.png" }
        }
      ])
    );
  });

  test("parses exactly two non-empty lines", () => {
    const title = `Storage Organiser - ${"Compact Durable Everyday Use ".repeat(4)}`.slice(0, 140);
    expect(parseProductCopy(`${title}\n${footer}`)).toEqual({
      title,
      description: footer
    });
    expect(() => parseProductCopy(`${title}\n${footer}\nEXTRA`)).toThrow(
      "exactly two non-empty lines"
    );
  });

  test("rejects forbidden HTML and a missing fixed footer", () => {
    const title = `Storage Organiser - ${"Compact Durable Everyday Use ".repeat(4)}`.slice(0, 140);
    expect(validateProductCopy({ title, description: "<div>Unsafe</div>" })).toEqual(
      expect.arrayContaining([
        "Description contains unsupported HTML tags",
        "Description is missing the ACL footer",
        "Description is missing the delivery footer"
      ])
    );
  });

  test("calls Packy with gpt-5.6-sol and no JSON response format", async () => {
    const title = `Storage Organiser - ${"Compact Durable Everyday Use ".repeat(4)}`.slice(0, 140);
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-5.6-sol");
      expect(body.response_format).toBeUndefined();
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `${title}\n${footer}` } }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductCopyWithPacky({
        input: {
          sellingPoints: "Compact storage",
          images: ["front.png"],
          imageUrls: ["https://cdn.example.com/front.png"]
        },
        systemPrompt: "MY EXACT PROMPT",
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl
      })
    ).resolves.toMatchObject({ title, description: footer });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/services/product-copy.test.ts`

Expected: FAIL because `server/services/productCopy.ts` does not exist.

- [ ] **Step 3: Add shared result types**

Append to `shared/product.ts`:

```ts
export interface GeneratedProductCopy {
  title: string;
  description: string;
}

export const PRODUCT_IMAGE_ROLES = [
  "main",
  "side",
  "detail",
  "lifestyle_1",
  "lifestyle_2"
] as const;

export type ProductImageRole = (typeof PRODUCT_IMAGE_ROLES)[number];

export interface GeneratedProductImage {
  role: ProductImageRole;
  imageUrl: string;
}
```

- [ ] **Step 4: Implement prompt loading, request building, parsing, and validation**

Create `server/services/productCopy.ts` with these public functions and constants:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GeneratedProductCopy,
  ProductInput
} from "../../shared/product.js";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../rules/DSZ系统prompt 4月20版本.txt"
);
const ALLOWED_TAG = /^<\/?(?:p|strong|ul|li)>$|^<br \/>$/i;

type UserContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ProductCopyMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: UserContent[] };

export async function loadProductSystemPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, "utf8");
}

export function buildProductCopyMessages(input: {
  systemPrompt: string;
  input: ProductInput;
}): ProductCopyMessage[] {
  const facts = {
    sellingPoints: input.input.sellingPoints,
    categoryHint: input.input.categoryHint || null,
    purchasePriceCny: input.input.purchasePriceCny || null,
    packageWeightKg: input.input.packageWeightKg || null,
    lengthCm: input.input.lengthCm || null,
    widthCm: input.input.widthCm || null,
    heightCm: input.input.heightCm || null
  };

  return [
    { role: "system", content: input.systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: `Verified product context:\n${JSON.stringify(facts, null, 2)}` },
        ...input.input.imageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url }
        }))
      ]
    }
  ];
}

export function parseProductCopy(raw: string): GeneratedProductCopy {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 2) {
    throw new Error("Packy copy response must contain exactly two non-empty lines");
  }

  const copy = { title: lines[0], description: lines[1] };
  const errors = validateProductCopy(copy);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return copy;
}

export function validateProductCopy(copy: GeneratedProductCopy): string[] {
  const errors: string[] = [];
  if (copy.title.length < 110 || copy.title.length > 200) {
    errors.push("Title must contain 110 to 200 characters");
  }
  if (!/^[\x20-\x7E]+$/.test(copy.title) || /[?*€™®©★☆※◆•→←✔]/.test(copy.title)) {
    errors.push("Title must use English ASCII text and approved punctuation");
  }
  if (/\r|\n|\t/.test(copy.description)) {
    errors.push("Description must be a single line");
  }
  const tags = copy.description.match(/<[^>]+>/g) || [];
  if (tags.some((tag) => !ALLOWED_TAG.test(tag))) {
    errors.push("Description contains unsupported HTML tags");
  }
  if (/https?:\/\/|www\./i.test(copy.description)) {
    errors.push("Description must not contain URLs");
  }
  if (!copy.description.includes("Returns, Refunds and Replacements")) {
    errors.push("Description is missing the ACL footer");
  }
  if (!copy.description.includes("Delivery Timeframe")) {
    errors.push("Description is missing the delivery footer");
  }
  if (/```/.test(copy.title) || /```/.test(copy.description)) {
    errors.push("Copy must not contain Markdown fences");
  }
  return errors;
}

export async function generateProductCopyWithPacky(input: {
  input: ProductInput;
  systemPrompt?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<GeneratedProductCopy> {
  const env = input.env || process.env;
  const apiKey = env.PACKY_API_KEY;
  if (!apiKey) throw new Error("Missing PACKY_API_KEY. Cannot generate product copy.");

  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(/\/+$/, "");
  const systemPrompt = input.systemPrompt || (await loadProductSystemPrompt());
  const response = await (input.fetchImpl || fetch)(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.PACKY_TEXT_MODEL || "gpt-5.6-sol",
      messages: buildProductCopyMessages({ systemPrompt, input: input.input })
    })
  });

  if (!response.ok) throw new Error(`Packy copy API failed: ${response.status}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Packy copy API returned empty content");
  return parseProductCopy(content);
}
```

- [ ] **Step 5: Run the copy service test and verify GREEN**

Run: `npm test -- tests/services/product-copy.test.ts`

Expected: PASS with 4 tests.

- [ ] **Step 6: Add edge-case tests and keep them green**

Add these individual tests, using the fixed footer fixture so each assertion targets one rule:

```ts
test.each([
  ["109-character title", { title: "A".repeat(109), description: footer }, "Title must contain 110 to 200 characters"],
  ["201-character title", { title: "A".repeat(201), description: footer }, "Title must contain 110 to 200 characters"],
  ["multiline description", { title: "A".repeat(120), description: `${footer}\n<p>Extra</p>` }, "Description must be a single line"],
  ["description URL", { title: "A".repeat(120), description: `${footer}<p>https://example.com</p>` }, "Description must not contain URLs"],
  ["Markdown fence", { title: "A".repeat(120), description: `${footer}\`\`\`` }, "Copy must not contain Markdown fences"],
  ["div tag", { title: "A".repeat(120), description: `${footer}<div>Extra</div>` }, "Description contains unsupported HTML tags"],
  ["anchor tag", { title: "A".repeat(120), description: `${footer}<a href=\"/\">Extra</a>` }, "Description contains unsupported HTML tags"],
  ["image tag", { title: "A".repeat(120), description: `${footer}<img src=\"x\">` }, "Description contains unsupported HTML tags"],
  ["table tag", { title: "A".repeat(120), description: `${footer}<table></table>` }, "Description contains unsupported HTML tags"],
  ["heading tag", { title: "A".repeat(120), description: `${footer}<h2>Extra</h2>` }, "Description contains unsupported HTML tags"],
  ["span tag", { title: "A".repeat(120), description: `${footer}<span>Extra</span>` }, "Description contains unsupported HTML tags"]
])("rejects %s", (_name, copy, expectedError) => {
  expect(validateProductCopy(copy)).toContain(expectedError);
});
```

Run: `npm test -- tests/services/product-copy.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add shared/product.ts server/services/productCopy.ts tests/services/product-copy.test.ts
git commit -m "feat: generate copy from the DSZ system prompt"
```

### Task 3: No-Fallback GPT-Image-2 Role Service

**Files:**
- Modify: `server/services/packyImages.ts:3-43,109-269`
- Create: `tests/services/packy-image-role.test.ts`

- [ ] **Step 1: Write failing role-service tests**

```ts
import { describe, expect, test, vi } from "vitest";
import {
  buildProductImageRolePrompt,
  generateProductImageRoleWithPacky
} from "../../server/services/packyImages";

const image = {
  buffer: Buffer.from("source"),
  mimetype: "image/png",
  originalname: "source.png"
} as Express.Multer.File;

describe("Packy product image roles", () => {
  test("builds one distinct prompt per fixed role", () => {
    expect(buildProductImageRolePrompt("main", "Compact storage")).toContain(
      "feature main image"
    );
    expect(buildProductImageRolePrompt("side", "Compact storage")).toContain(
      "side profile"
    );
  });

  test("returns the requested role and one GPT-Image-2 URL", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("gpt-image-2");
      expect(form.get("n")).toBe("1");
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.example.com/main.png" }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    await expect(
      generateProductImageRoleWithPacky({
        role: "main",
        images: [image],
        productType: "Storage organiser",
        sellingPoints: "Compact storage",
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl
      })
    ).resolves.toEqual({ role: "main", imageUrl: "https://cdn.example.com/main.png" });
  });

  test("throws after provider failure instead of returning source-image fallbacks", async () => {
    const fetchImpl = vi.fn(async () => new Response("Unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(
      generateProductImageRoleWithPacky({
        role: "detail",
        images: [image],
        productType: "Storage organiser",
        sellingPoints: "Compact storage",
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl
      })
    ).rejects.toThrow("Packy Shopify product image API failed: 503");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/services/packy-image-role.test.ts`

Expected: FAIL because the role exports do not exist.

- [ ] **Step 3: Implement role prompts and the no-fallback adapter**

Add imports for `GeneratedProductImage` and `ProductImageRole` from `shared/product.ts`, export the five role prompts as a record, and implement:

```ts
const PRODUCT_IMAGE_ROLE_RULES: Record<ProductImageRole, string> = {
  main: "Feature main image. Product-focused hero image on a premium neutral or subtle real-world background. Keep the full product visible and do not use a plain white background.",
  side: "Side angle. Show a product-only side profile, contour, or alternate view on a clean background.",
  detail: "Detail or packaging. Show only confirmed texture, material, packaging, closure, or useful close-up details. Do not invent measurements or text.",
  lifestyle_1: "Lifestyle scene 1. Show one realistic usage context, not a collage or white-background feature image.",
  lifestyle_2: "Lifestyle scene 2. Show a second distinct realistic usage context, not a collage or white-background feature image."
};

export function buildProductImageRolePrompt(
  role: ProductImageRole,
  sellingPoints: string
): string {
  return [
    "Generate exactly one square Shopify product image for this role.",
    "Do not create a collage, grid, contact sheet, split screen, watermark, logo, badge, or unsupported text overlay.",
    "Keep the actual product accurate, recognizable, sharp, and free of unsupported claims.",
    PRODUCT_IMAGE_ROLE_RULES[role],
    `Selling points for visual emphasis only: ${sellingPoints}`
  ].join("\n");
}

export async function generateProductImageRoleWithPacky(input: {
  role: ProductImageRole;
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<GeneratedProductImage> {
  if (input.images.length === 0) throw new Error("At least one source product image is required.");
  const env = input.env || process.env;
  const apiKey = env.PACKY_API_KEY;
  if (!apiKey) throw new Error("Missing PACKY_API_KEY. Cannot generate images.");

  const imageUrls = await requestPackyShopifyProductImageUrls({
    images: input.images,
    productType: input.productType,
    prompt: buildProductImageRolePrompt(input.role, input.sellingPoints),
    count: 1,
    env,
    fetcher: input.fetchImpl || fetch,
    apiKey,
    maxAttempts: PACKY_SHOPIFY_PRODUCT_IMAGE_MAX_ATTEMPTS
  });
  const imageUrl = imageUrls[0];
  if (!imageUrl) throw new Error("Packy product image role returned no image.");
  return { role: input.role, imageUrl };
}
```

Do not call `buildSourceImageFallbackUrls` from this new function. Keep the legacy aggregate function unchanged until all current tests and callers have migrated.

- [ ] **Step 4: Run the role-service tests and verify GREEN**

Run: `npm test -- tests/services/packy-image-role.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit Task 3**

```bash
git add server/services/packyImages.ts tests/services/packy-image-role.test.ts
git commit -m "feat: generate Packy images by fixed role"
```

### Task 4: Independent Express Routes

**Files:**
- Modify: `server/app.ts:12-159`
- Modify: `tests/server/api.test.ts`

- [ ] **Step 1: Replace route expectations with independent endpoint tests**

Add tests that inject the new dependency seams:

```ts
test("generates only title and description through the copy route", async () => {
  const generateProductCopy = vi.fn(async () => ({
    title: "A".repeat(120),
    description: "<p><strong>Returns, Refunds and Replacements </strong></p><p><strong>Delivery Timeframe</strong></p>"
  }));
  const app = createApp({ generateProductCopy });

  const response = await request(app)
    .post("/api/generate-product-copy")
    .send({ input: productInput })
    .expect(200);

  expect(response.body).toEqual({
    title: "A".repeat(120),
    description: expect.stringContaining("Delivery Timeframe")
  });
  expect(generateProductCopy).toHaveBeenCalledOnce();
});

test("generates one requested image role without invoking copy", async () => {
  const generateProductImageRole = vi.fn(async (input) => ({
    role: input.role,
    imageUrl: `https://cdn.example.com/${input.role}.png`
  }));
  const app = createApp({ generateProductImageRole });

  const response = await request(app)
    .post("/api/generate-product-image-role")
    .field("role", "side")
    .field("productType", "Storage organiser")
    .field("sellingPoints", "Compact storage")
    .attach("images", Buffer.from("one"), "one.png")
    .expect(200);

  expect(response.body).toEqual({
    role: "side",
    imageUrl: "https://cdn.example.com/side.png"
  });
});

test("rejects an unknown image role before calling Packy", async () => {
  const generateProductImageRole = vi.fn();
  const app = createApp({ generateProductImageRole });
  await request(app)
    .post("/api/generate-product-image-role")
    .field("role", "unknown")
    .attach("images", Buffer.from("one"), "one.png")
    .expect(400);
  expect(generateProductImageRole).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -- tests/server/api.test.ts`

Expected: FAIL because the dependencies and routes do not exist.

- [ ] **Step 3: Add dependency types and route validation**

Import `generateProductCopyWithPacky`, `generateProductImageRoleWithPacky`, `PRODUCT_IMAGE_ROLES`, and their result/input types. Add these `AppDependencies` members:

```ts
generateProductCopy?: (input: ProductInput) => Promise<GeneratedProductCopy>;
generateProductImageRole?: (input: {
  role: ProductImageRole;
  images: Express.Multer.File[];
  productType: string;
  sellingPoints: string;
}) => Promise<GeneratedProductImage>;
```

Add the routes before the legacy generation routes:

```ts
app.post("/api/generate-product-copy", async (req, res) => {
  try {
    const productInput = req.body.input as ProductInput;
    if (!productInput?.sellingPoints?.trim()) {
      res.status(400).json({ error: "Selling points are required" });
      return;
    }
    if (!Array.isArray(productInput.imageUrls) || productInput.imageUrls.length === 0) {
      res.status(400).json({ error: "Uploaded image URLs are required" });
      return;
    }
    const result = dependencies.generateProductCopy
      ? await dependencies.generateProductCopy(productInput)
      : await generateProductCopyWithPacky({ input: productInput, env });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post(
  "/api/generate-product-image-role",
  upload.array("images", 10),
  async (req, res) => {
    try {
      const images = (req.files || []) as Express.Multer.File[];
      const role = String(req.body.role || "") as ProductImageRole;
      if (images.length === 0) {
        res.status(400).json({ error: "At least one source image is required" });
        return;
      }
      if (!PRODUCT_IMAGE_ROLES.includes(role)) {
        res.status(400).json({ error: "Unknown product image role" });
        return;
      }
      const providerInput = {
        role,
        images,
        productType: String(req.body.productType || "Product"),
        sellingPoints: String(req.body.sellingPoints || "")
      };
      const result = dependencies.generateProductImageRole
        ? await dependencies.generateProductImageRole(providerInput)
        : await generateProductImageRoleWithPacky({ ...providerInput, env });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  }
);
```

Keep old endpoints temporarily so unrelated existing callers and tests do not break during migration.

- [ ] **Step 4: Make health status explicit without exposing credentials**

Change `/api/health` to return:

```ts
textConfigured: Boolean(env.PACKY_API_KEY),
imageConfigured: Boolean(env.PACKY_API_KEY),
textModel: env.PACKY_TEXT_MODEL || "gpt-5.6-sol",
imageModel: env.PACKY_IMAGE_MODEL || "gpt-image-2",
```

Update the health test to assert these safe values and to assert the response string does not contain the test credential.

- [ ] **Step 5: Run API tests and verify GREEN**

Run: `npm test -- tests/server/api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/app.ts tests/server/api.test.ts
git commit -m "feat: expose independent Packy generation routes"
```

### Task 5: Browser API Helpers and One-Button Parallel Orchestration

**Files:**
- Create: `src/productWorkflow.ts`
- Modify: `src/App.tsx:1-293`
- Modify: `tests/App.test.tsx`

- [ ] **Step 1: Write the one-button independence tests**

Replace the old sequential-generation test in `tests/App.test.tsx` with three behavior tests:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("one click starts copy and all five image roles", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/upload-images") {
      return json({ imageUrls: ["https://cdn.example.com/source.png"] });
    }
    if (url === "/api/generate-product-copy") {
      return json({ title: "A".repeat(120), description: validDescription });
    }
    if (url === "/api/generate-product-image-role") {
      const role = String((init?.body as FormData).get("role"));
      return json({ role, imageUrl: `https://cdn.example.com/${role}.png` });
    }
    throw new Error(`Unexpected URL ${url}`);
  }));

  render(<App />);
  await chooseSourceImageAndSellingPoints();
  await userEvent.click(screen.getByRole("button", { name: "开始 AI 生成" }));

  expect(await screen.findByDisplayValue("A".repeat(120))).toBeInTheDocument();
  expect(await screen.findAllByRole("img", { name: /生成图片/ })).toHaveLength(5);
  expect(calls.filter((url) => url === "/api/generate-product-copy")).toHaveLength(1);
  expect(calls.filter((url) => url === "/api/generate-product-image-role")).toHaveLength(5);
});

test("keeps generated copy when one image role fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url === "/api/upload-images") {
      return json({ imageUrls: ["https://cdn.example.com/source.png"] });
    }
    if (url === "/api/generate-product-copy") {
      return json({ title: "A".repeat(120), description: validDescription });
    }
    if (url === "/api/generate-product-image-role") {
      const role = String((init?.body as FormData).get("role"));
      return role === "detail"
        ? json({ error: "Packy unavailable" }, 503)
        : json({ role, imageUrl: `https://cdn.example.com/${role}.png` });
    }
    throw new Error(`Unexpected URL ${url}`);
  }));

  render(<App />);
  await chooseSourceImageAndSellingPoints();
  await userEvent.click(screen.getByRole("button", { name: "开始 AI 生成" }));

  expect(await screen.findByDisplayValue("A".repeat(120))).toBeInTheDocument();
  expect(await screen.findAllByRole("img", { name: /生成图片/ })).toHaveLength(4);
  expect(screen.getByTestId("image-role-detail")).toHaveTextContent("Packy unavailable");
  expect(within(screen.getByTestId("image-role-detail")).getByRole("button", { name: "重试" })).toBeInTheDocument();
});

test("keeps generated images when copy fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url === "/api/upload-images") {
      return json({ imageUrls: ["https://cdn.example.com/source.png"] });
    }
    if (url === "/api/generate-product-copy") {
      return json({ error: "Copy validation failed" }, 422);
    }
    if (url === "/api/generate-product-image-role") {
      const role = String((init?.body as FormData).get("role"));
      return json({ role, imageUrl: `https://cdn.example.com/${role}.png` });
    }
    throw new Error(`Unexpected URL ${url}`);
  }));

  render(<App />);
  await chooseSourceImageAndSellingPoints();
  await userEvent.type(screen.getByLabelText("Product Name"), "Existing title");
  await userEvent.click(screen.getByRole("button", { name: "开始 AI 生成" }));

  expect(await screen.findAllByRole("img", { name: /生成图片/ })).toHaveLength(5);
  expect(screen.getByLabelText("Product Name")).toHaveValue("Existing title");
  expect(screen.getByTestId("copy-task-status")).toHaveTextContent("Copy validation failed");
  expect(within(screen.getByTestId("copy-task-status")).getByRole("button", { name: "重试" })).toBeInTheDocument();
});
```

Use these complete test helpers in the same file:

```tsx
const validDescription =
  "<p><strong>Returns, Refunds and Replacements </strong></p><p><strong>Delivery Timeframe</strong></p>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function chooseSourceImageAndSellingPoints() {
  await userEvent.upload(
    screen.getByLabelText("原始产品图片"),
    new File(["image"], "source.png", { type: "image/png" })
  );
  await userEvent.type(screen.getByLabelText("商品卖点"), "Compact storage");
}
```

- [ ] **Step 2: Run the App tests and verify RED**

Run: `npm test -- tests/App.test.tsx`

Expected: FAIL because the old UI calls the aggregate field and image endpoints sequentially.

- [ ] **Step 3: Implement browser API helpers**

Create `src/productWorkflow.ts`:

```ts
import type {
  GeneratedProductCopy,
  GeneratedProductImage,
  ProductImageRole,
  ProductInput
} from "../shared/product";

async function readJson(response: Response): Promise<any> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function uploadSourceImages(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((file) => form.append("images", file));
  const data = await readJson(await fetch("/api/upload-images", { method: "POST", body: form }));
  return data.imageUrls;
}

export async function requestProductCopy(input: ProductInput): Promise<GeneratedProductCopy> {
  return readJson(
    await fetch("/api/generate-product-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    })
  );
}

export async function requestProductImageRole(input: {
  role: ProductImageRole;
  files: File[];
  productType: string;
  sellingPoints: string;
}): Promise<GeneratedProductImage> {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("role", input.role);
  form.append("productType", input.productType || "Product");
  form.append("sellingPoints", input.sellingPoints);
  return readJson(
    await fetch("/api/generate-product-image-role", { method: "POST", body: form })
  );
}
```

- [ ] **Step 4: Initialize editable fields and independent task state**

In `src/App.tsx`, use non-null fields from the start and these state shapes:

```ts
interface TaskState {
  status: Status;
  error: string;
}

type ImageRoleState = Record<
  ProductImageRole,
  TaskState & { imageUrl: string }
>;

const initialImageRoles: ImageRoleState = Object.fromEntries(
  PRODUCT_IMAGE_ROLES.map((role) => [
    role,
    { status: "idle", error: "", imageUrl: "" }
  ])
) as ImageRoleState;

const initialFields: DszProductFields = {
  category: 0,
  categories: "",
  categoryName: "",
  product_name: "",
  sku: "",
  status: 1,
  ean_code: "",
  stock: 1000,
  weight: 0,
  length: 0,
  width: 0,
  height: 0,
  cbm: 0,
  brand_name: "Elosung",
  colour: "",
  enabled: true,
  description: "",
  vendor_price: 0,
  rrp: 0,
  zone_rates: buildShippingZoneRates({
    actualWeightKg: 0,
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0
  }),
  images: [],
  risk_flags: [],
  review_notes: []
};
```

Create the state with:

```ts
const [fields, setFields] = useState<DszProductFields>(initialFields);
const [copyTask, setCopyTask] = useState<TaskState>({ status: "idle", error: "" });
const [imageRoles, setImageRoles] = useState<ImageRoleState>(initialImageRoles);
const [activeTab, setActiveTab] = useState<keyof typeof TAB_LABELS>("details");
```

Remove `fieldSource`, the single combined `status`, and `detailStatus` because they encode the old sequential workflow. Expand `updateField` to accept `string | number | boolean`. After weight or dimension changes, use `calculatePackageCbm` and `buildShippingZoneRates` from `shared/shipping.ts` to update `cbm` and `zone_rates` from the same next field object.

- [ ] **Step 5: Implement the one-button coordinator**

```ts
async function startAiGeneration() {
  if (sourceFiles.length === 0 || !sellingPoints.trim()) {
    setPageMessage(sourceFiles.length === 0 ? "请先上传至少一张原始产品图片" : "请填写卖点");
    return;
  }

  const copyPromise = runCopyTask();
  const imagePromise = runAllImageRoles();
  await Promise.allSettled([copyPromise, imagePromise]);
}

async function runCopyTask() {
  setCopyTask({ status: "loading", error: "" });
  try {
    const uploadedUrls = await uploadSourceImages(sourceFiles);
    const copy = await requestProductCopy({
      sellingPoints: sellingPoints.trim(),
      categoryHint: optionalInputs.categoryHint.trim() || undefined,
      images: sourceFiles.map((file) => file.name),
      imageUrls: uploadedUrls,
      purchasePriceCny: optionalNumber(optionalInputs.purchasePriceCny),
      packageWeightKg: fields.weight || undefined,
      lengthCm: fields.length || undefined,
      widthCm: fields.width || undefined,
      heightCm: fields.height || undefined
    });
    setFields((current) => ({
      ...current,
      product_name: copy.title,
      description: copy.description
    }));
    setCopyTask({ status: "success", error: "" });
  } catch (error) {
    setCopyTask({
      status: "error",
      error: error instanceof Error ? error.message : "标题和描述生成失败"
    });
  }
}

async function runImageRole(role: ProductImageRole) {
  setImageRoles((current) => ({
    ...current,
    [role]: { ...current[role], status: "loading", error: "" }
  }));
  try {
    const result = await requestProductImageRole({
      role,
      files: sourceFiles,
      productType: optionalInputs.categoryHint || sellingPoints,
      sellingPoints: sellingPoints.trim()
    });
    setImageRoles((current) => ({
      ...current,
      [role]: { status: "success", error: "", imageUrl: result.imageUrl }
    }));
  } catch (error) {
    setImageRoles((current) => ({
      ...current,
      [role]: {
        ...current[role],
        status: "error",
        error: error instanceof Error ? error.message : "图片生成失败"
      }
    }));
  }
}

async function runAllImageRoles() {
  await Promise.allSettled(PRODUCT_IMAGE_ROLES.map((role) => runImageRole(role)));
}
```

Keep role URLs in `imageRoles` so out-of-order completion cannot shift slots. Immediately before upload, build the submitted object in fixed order:

```ts
const fieldsForUpload: DszProductFields = {
  ...fields,
  images: PRODUCT_IMAGE_ROLES
    .map((role) => imageRoles[role].imageUrl)
    .filter((url): url is string => Boolean(url))
};
```

When updating weight or dimensions, recompute `cbm` and `zone_rates` from the next field object using `calculateCbm` and `buildShippingZoneRates`.

- [ ] **Step 6: Run App tests and verify GREEN for orchestration behavior**

Run: `npm test -- tests/App.test.tsx`

Expected: the three new independence tests PASS. Layout assertions may remain RED until Task 6.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/productWorkflow.ts src/App.tsx tests/App.test.tsx
git commit -m "feat: orchestrate independent AI tasks from one action"
```

### Task 6: Optimized Four-Tab Workbench

**Files:**
- Modify: `src/App.tsx:295-end`
- Modify: `src/styles.css`
- Modify: `tests/App.test.tsx`

- [ ] **Step 1: Add failing layout and field-ownership assertions**

```tsx
test("renders the approved four-tab workbench and all DSZ field groups", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "DSZ Product Studio" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Details/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Price/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Shipping/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Images/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Product Name")).toHaveAttribute("data-ai-field", "true");
  expect(screen.getByLabelText("Vendor Product Description")).toHaveAttribute("data-ai-field", "true");
  expect(screen.getByLabelText("Colour")).not.toHaveAttribute("data-ai-field");
});

test("shows the approved shipping summary", async () => {
  render(<App />);
  await userEvent.click(screen.getByRole("tab", { name: /Shipping/ }));
  expect(screen.getByText("Australian zones")).toHaveTextContent("Free");
  expect(screen.getByText("New Zealand below 3 kg")).toHaveTextContent("AUD 20");
  expect(screen.getByText("New Zealand 3 kg and above")).toHaveTextContent("AUD 40");
});
```

- [ ] **Step 2: Run the App tests and verify RED**

Run: `npm test -- tests/App.test.tsx`

Expected: FAIL because the existing interface has three panels and no tabs.

- [ ] **Step 3: Replace the old three-panel return tree with the approved shell**

Implement these exact structural regions in `App.tsx`:

```tsx
<main className="studio-shell">
  <header className="studio-topbar">
    <div className="studio-brand">
      <span className="brand-mark">D</span>
      <div><h1>DSZ Product Studio</h1><p>商品生成与上架审核</p></div>
    </div>
    <span className="connection-health">Packy 服务状态</span>
  </header>

  <div className="studio-workspace">
    <aside className="source-rail">
      <span className="eyebrow">01 · Source</span>
      <h2>商品资料</h2>
      <label className="file-drop">
        <span>拖入或选择商品图片</span>
        <input aria-label="原始产品图片" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={handleFiles} />
      </label>
      <label>商品卖点<textarea aria-label="商品卖点" value={sellingPoints} onChange={handleSellingPoints} /></label>
      <label>类目提示<input value={optionalInputs.categoryHint} onChange={handleCategoryHint} /></label>
      <button className="primary-generate" onClick={startAiGeneration}>开始 AI 生成</button>
      <small>一次点击，同时启动两项独立任务</small>
    </aside>

    <section className="editor-area">
      <div className="task-status-grid">
        <TaskStatusCard title="标题与描述" model="GPT-5.6 SOL" state={copyTask} onRetry={runCopyTask} />
        <ImageTaskStatusCard roles={imageRoles} onRetryRole={runImageRole} />
      </div>
      <div role="tablist" className="product-tabs">
        {(["details", "price", "shipping", "images"] as const).map((tab) => (
          <button role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} key={tab}>
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {activeTab === "details" && <DetailsPanel fields={fields} updateField={updateField} />}
      {activeTab === "price" && <PricePanel fields={fields} updateField={updateField} />}
      {activeTab === "shipping" && <ShippingPanel fields={fields} />}
      {activeTab === "images" && <ImagesPanel roles={imageRoles} onRetryRole={runImageRole} />}
      <footer className="sticky-submit-bar">
        <span>字段完整度 {completionPercent}%</span>
        <button onClick={uploadProduct} disabled={uploadStatus === "loading"}>验证并提交审核</button>
      </footer>
    </section>
  </div>
</main>
```

Keep `TaskStatusCard`, `ImageTaskStatusCard`, `DetailsPanel`, `PricePanel`, `ShippingPanel`, and `ImagesPanel` as focused functions in the same file for this iteration. Do not create a component directory until a later requirement needs reuse.

`DetailsPanel` must render Category, Product Name, SKU, Status, EAN Code, Quantity, Package Weight, Length, Width, Height, CBM, Brand Name, Colour, Enable Product, and Vendor Product Description. Only the Product Name and Vendor Product Description inputs receive `data-ai-field="true"`.

`PricePanel` renders Vendor Price and Vendor RRP. `ShippingPanel` renders the formula and computed billable weight plus the three approved price rows. `ImagesPanel` renders the five fixed roles in `PRODUCT_IMAGE_ROLES` order with preview, status, error, and role-specific retry.

Define the tab labels and event handlers used by the structural tree:

```tsx
const TAB_LABELS = {
  details: "Details",
  price: "Price",
  shipping: "Shipping (Incl. GST)",
  images: "Images"
} as const;

const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) =>
  setSourceFiles(Array.from(event.target.files || []));
const handleSellingPoints = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
  setSellingPoints(event.target.value);
const handleCategoryHint = (event: React.ChangeEvent<HTMLInputElement>) =>
  updateOptionalInput("categoryHint", event.target.value);

const completionPercent = useMemo(() => {
  const required = [
    fields.categories,
    fields.product_name,
    fields.sku,
    fields.ean_code,
    fields.weight,
    fields.length,
    fields.width,
    fields.height,
    fields.vendor_price,
    fields.rrp,
    fields.description,
    ...PRODUCT_IMAGE_ROLES.map((role) => imageRoles[role].imageUrl)
  ];
  return Math.round((required.filter(Boolean).length / required.length) * 100);
}, [fields, imageRoles]);
```

Define the focused status and image components with the same state types from Task 5:

```tsx
function TaskStatusCard(props: {
  title: string;
  model: string;
  state: TaskState;
  onRetry: () => Promise<void>;
}) {
  return (
    <article className={`task-card task-${props.state.status}`} data-testid="copy-task-status">
      <div><strong>{props.title}</strong><small>{props.model}</small></div>
      <span>{props.state.status}</span>
      {props.state.error && <p>{props.state.error}</p>}
      {props.state.status === "error" && <button onClick={props.onRetry}>重试</button>}
    </article>
  );
}

function ImageTaskStatusCard(props: {
  roles: ImageRoleState;
  onRetryRole: (role: ProductImageRole) => Promise<void>;
}) {
  const complete = PRODUCT_IMAGE_ROLES.filter(
    (role) => props.roles[role].status === "success"
  ).length;
  return (
    <article className="task-card">
      <div><strong>商品图片</strong><small>GPT-Image-2 · 五个固定角色</small></div>
      <span>{complete} / 5</span>
    </article>
  );
}

function ImagesPanel(props: {
  roles: ImageRoleState;
  onRetryRole: (role: ProductImageRole) => Promise<void>;
}) {
  return (
    <section className="image-role-grid">
      {PRODUCT_IMAGE_ROLES.map((role) => {
        const item = props.roles[role];
        return (
          <article key={role} data-testid={`image-role-${role}`} className="image-role-card">
            <strong>{role}</strong>
            {item.imageUrl && <img src={item.imageUrl} alt={`生成图片 ${role}`} />}
            {item.error && <p>{item.error}</p>}
            {item.status === "error" && <button onClick={() => props.onRetryRole(role)}>重试</button>}
          </article>
        );
      })}
    </section>
  );
}
```

Implement `DetailsPanel`, `PricePanel`, and `ShippingPanel` as controlled forms. The complete field mapping is:

```tsx
const DETAIL_TEXT_FIELDS: Array<[keyof DszProductFields, string, boolean]> = [
  ["categories", "Category", false],
  ["product_name", "Product Name", true],
  ["sku", "SKU", false],
  ["ean_code", "EAN Code", false],
  ["brand_name", "Brand Name", false],
  ["colour", "Colour", false]
];
const DETAIL_NUMBER_FIELDS: Array<[keyof DszProductFields, string]> = [
  ["status", "Status"],
  ["stock", "Quantity"],
  ["weight", "Package Weight (kg)"],
  ["length", "Package Length (cm)"],
  ["width", "Package Width (cm)"],
  ["height", "Package Height (cm)"],
  ["cbm", "Package CBM (m3)"]
];

function DetailsPanel(props: {
  fields: DszProductFields;
  updateField: (field: keyof DszProductFields, value: string | number | boolean) => void;
}) {
  return (
    <section className="field-section field-grid">
      {DETAIL_TEXT_FIELDS.map(([key, label, ai]) => (
        <label key={String(key)}>{label}
          <input aria-label={label} data-ai-field={ai || undefined} value={String(props.fields[key] ?? "")} onChange={(event) => props.updateField(key, event.target.value)} />
        </label>
      ))}
      {DETAIL_NUMBER_FIELDS.map(([key, label]) => (
        <label key={String(key)}>{label}
          <input aria-label={label} inputMode="decimal" value={String(props.fields[key] ?? "")} onChange={(event) => props.updateField(key, Number(event.target.value) || 0)} />
        </label>
      ))}
      <label>Enable Product
        <input aria-label="Enable Product" type="checkbox" checked={props.fields.enabled} onChange={(event) => props.updateField("enabled", event.target.checked)} />
      </label>
      <label className="span-all">Vendor Product Description
        <textarea aria-label="Vendor Product Description" data-ai-field="true" value={props.fields.description} onChange={(event) => props.updateField("description", event.target.value)} />
      </label>
    </section>
  );
}

function PricePanel(props: {
  fields: DszProductFields;
  updateField: (field: keyof DszProductFields, value: number) => void;
}) {
  return <section className="field-section field-grid">
    <label>Vendor Price<input aria-label="Vendor Price" value={props.fields.vendor_price} onChange={(event) => props.updateField("vendor_price", Number(event.target.value) || 0)} /></label>
    <label>Vendor RRP<input aria-label="Vendor RRP" value={props.fields.rrp} onChange={(event) => props.updateField("rrp", Number(event.target.value) || 0)} /></label>
  </section>;
}

function ShippingPanel(props: { fields: DszProductFields }) {
  const billable = calculateBillableWeightKg({
    actualWeightKg: props.fields.weight,
    lengthCm: props.fields.length,
    widthCm: props.fields.width,
    heightCm: props.fields.height
  });
  return <section className="field-section shipping-summary">
    <p><strong>Australian zones</strong><span>Free</span></p>
    <p><strong>New Zealand below 3 kg</strong><span>AUD 20</span></p>
    <p><strong>New Zealand 3 kg and above</strong><span>AUD 40</span></p>
    <p>Current billable weight: {billable.toFixed(2)} kg</p>
  </section>;
}
```

- [ ] **Step 4: Replace CSS with the approved responsive visual system**

Use the visual artifact `.superpowers/brainstorm/20260711-150920/content/workbench-polished-v4.html` as the spacing and hierarchy reference. Implement these foundation rules in `src/styles.css` and map every class from Step 3:

```css
:root {
  font-family: Inter, "Segoe UI", sans-serif;
  color: #17151d;
  background: #f2eff4;
  --line: #e8e4ec;
  --muted: #736e7c;
  --violet: #6d28d9;
  --violet-soft: #f3edff;
  --green: #13795b;
  --green-soft: #edf9f4;
  --amber: #a85d00;
  --amber-soft: #fff6e8;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #f2eff4; }
button, input, textarea, select { font: inherit; }
.studio-shell { max-width: 1500px; margin: 24px auto; overflow: hidden; border: 1px solid #ded9e3; border-radius: 18px; background: #fff; box-shadow: 0 18px 55px rgba(35, 25, 45, .1); }
.studio-topbar { min-height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; border-bottom: 1px solid var(--line); }
.studio-workspace { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 760px; }
.source-rail { padding: 20px; background: #faf9fb; border-right: 1px solid var(--line); }
.task-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px 20px 0; }
.product-tabs { display: flex; gap: 5px; margin: 16px 20px 0; padding: 5px; border-radius: 11px; background: #f7f5f8; }
.product-tabs button { flex: 1; padding: 9px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-weight: 650; }
.product-tabs button[aria-selected="true"] { background: #fff; color: #17151d; box-shadow: 0 1px 4px rgba(25, 20, 30, .08); }
.field-section { margin: 12px 20px; padding: 16px; border: 1px solid var(--line); border-radius: 13px; }
.field-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.sticky-submit-bar { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; padding: 13px 20px; border-top: 1px solid var(--line); background: rgba(255,255,255,.95); backdrop-filter: blur(10px); }
@media (max-width: 1050px) {
  .studio-shell { margin: 0; border-radius: 0; }
  .studio-workspace { grid-template-columns: 1fr; }
  .source-rail { border-right: 0; border-bottom: 1px solid var(--line); }
  .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .task-status-grid, .field-grid { grid-template-columns: 1fr; }
  .product-tabs { overflow-x: auto; }
  .product-tabs button { min-width: 100px; }
}
```

- [ ] **Step 5: Run App tests and verify GREEN**

Run: `npm test -- tests/App.test.tsx`

Expected: PASS with orchestration, partial-failure, tab, field-ownership, and shipping-summary tests.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/App.tsx src/styles.css tests/App.test.tsx
git commit -m "feat: build optimized DSZ product workbench"
```

### Task 7: Configuration, Regression Verification, and Live Acceptance

**Files:**
- Modify: `.env.example`
- Modify locally but do not stage: `.env.local`
- Modify only if verification exposes a covered regression: files from Tasks 1-6 and their corresponding tests

- [ ] **Step 1: Document the single credential and exact models**

Set `.env.example` to include:

```dotenv
PACKY_API_KEY=
PACKY_BASE_URL=https://www.packyapi.com
PACKY_TEXT_MODEL=gpt-5.6-sol
PACKY_IMAGE_MODEL=gpt-image-2
PACKY_IMAGE_SIZE=1024x1024
PACKY_IMAGE_QUALITY=high
```

Remove `PACKY_FIELD_API_KEY` and `PACKY_IMAGE_API_KEY` from the example so new installations do not imply separate credentials. Do not remove unrelated admin or ImgBB settings.

- [ ] **Step 2: Configure local model identifiers without exposing the credential**

Ensure the untracked `.env.local` contains `PACKY_TEXT_MODEL=gpt-5.6-sol` and `PACKY_IMAGE_MODEL=gpt-image-2`. Preserve the existing `PACKY_API_KEY` value and do not print, stage, or log the file.

- [ ] **Step 3: Run the complete automated verification suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0 with no test failures, TypeScript errors, ESLint errors, or build errors.

- [ ] **Step 4: Verify provider configuration without leaking secrets**

Start the application with `npm run dev`, request `/api/health`, and verify only these public facts:

```json
{
  "textConfigured": true,
  "imageConfigured": true,
  "textModel": "gpt-5.6-sol",
  "imageModel": "gpt-image-2"
}
```

Do not display headers, environment values, or `.env.local` contents.

- [ ] **Step 5: Perform live browser acceptance**

Use one representative product with verified facts and source images. Confirm:

1. One click starts both task cards.
2. The title is English and 110-200 characters.
3. The description is a single HTML line using only allowed tags and includes both fixed footer sections.
4. Five image roles occupy the correct slots.
5. AU rates show Free and NZ changes from AUD 20 to AUD 40 at 3 kg billable weight.
6. A controlled test failure in one task leaves the other task's results intact.
7. The layout remains usable at desktop, tablet, and narrow mobile widths.

- [ ] **Step 6: Inspect the final diff and secret boundary**

Run:

```bash
git diff --check
git status --short
git diff -- . ':!.env.local' ':!.superpowers/**'
```

Expected: no whitespace errors; `.env.local` is not staged; `.superpowers/` and the user's pre-existing untracked documents remain uncommitted; no credential appears in tracked changes.

- [ ] **Step 7: Commit Task 7**

```bash
git add .env.example
git commit -m "chore: configure independent Packy models"
```

- [ ] **Step 8: Record final evidence before claiming completion**

Capture the exact exit status of the four automated commands, the safe `/api/health` response, and the browser acceptance outcomes in the final handoff. If any live provider call cannot be completed, state which check is unverified and do not describe it as passing.
