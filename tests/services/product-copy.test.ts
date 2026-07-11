// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  buildProductCopyMessages,
  generateProductCopyWithPacky,
  loadProductSystemPrompt,
  parseProductCopy,
  validateProductCopy
} from "../../server/services/productCopy";
import { PRODUCT_IMAGE_ROLES, type ProductInput } from "../../shared/product";

const validTitle = "Compact Storage Organiser - Practical Space Saving Design, Easy Everyday Access, Versatile Home and Travel Use";
const validDescription = "<p><strong>Product Overview</strong></p><p>A practical organiser for everyday use.</p><p><strong>Returns, Refunds and Replacements</strong><br />Eligible claims are handled under the Australian Consumer Law ACL.</p><p><strong>Delivery Timeframe</strong></p><p>Delivery estimates exclude weekends and public holidays.</p>";

function productInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    sellingPoints: "Compact storage; easy access",
    categoryHint: "Home organiser",
    images: [],
    imageUrls: [
      "https://images.example.test/front.jpg",
      "http://images.example.test/insecure.jpg",
      "https://images.example.test/side.jpg"
    ],
    purchasePriceCny: 12.5,
    packageWeightKg: 1.2,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 10,
    ...overrides
  };
}

function titleContaining(markdown: string): string {
  return `${"A".repeat(110 - markdown.length)}${markdown}`;
}

test("exports the five approved product image role contracts", () => {
  expect(PRODUCT_IMAGE_ROLES).toEqual([
    "main",
    "side",
    "detail",
    "lifestyle_1",
    "lifestyle_2"
  ]);
});

describe("product copy messages", () => {
  test("uses the supplied system prompt verbatim and attaches every HTTPS source image", () => {
    const systemPrompt = "Exact user-owned prompt\nKeep this spacing.";

    const messages = buildProductCopyMessages(productInput(), systemPrompt);

    expect(messages[0]).toEqual({ role: "system", content: systemPrompt });
    expect(messages[1]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Verified product facts:",
            "Selling points: Compact storage; easy access",
            "Category hint: Home organiser",
            "Purchase price CNY: 12.5",
            "Package weight kg: 1.2",
            "Length cm: 30",
            "Width cm: 20",
            "Height cm: 10"
          ].join("\n")
        },
        { type: "image_url", image_url: { url: "https://images.example.test/front.jpg" } },
        { type: "image_url", image_url: { url: "https://images.example.test/side.jpg" } }
      ]
    });
  });

  test("loads the exact UTF-8 DSZ system prompt", async () => {
    const expected = await readFile(
      resolve("rules/DSZ系统prompt 4月20版本.txt"),
      "utf8"
    );

    await expect(loadProductSystemPrompt()).resolves.toBe(expected);
  });

  test("resolves the prompt only from the module-relative rules path, independent of cwd", async () => {
    const expected = await readFile(resolve("rules/DSZ系统prompt 4月20版本.txt"), "utf8");
    const originalCwd = process.cwd();
    const unrelatedCwd = await mkdtemp(resolve(tmpdir(), "product-copy-cwd-"));

    try {
      process.chdir(unrelatedCwd);
      await expect(loadProductSystemPrompt()).resolves.toBe(expected);
    } finally {
      process.chdir(originalCwd);
      await rm(unrelatedCwd, { recursive: true, force: true });
    }
  });
});

describe("product copy parsing", () => {
  test("accepts exactly two non-empty lines", () => {
    expect(parseProductCopy(`  ${validTitle}  \n\n  ${validDescription}  `)).toEqual({
      title: validTitle,
      description: validDescription
    });
  });

  test("rejects an extra non-empty line", () => {
    expect(() => parseProductCopy(`${validTitle}\n${validDescription}\nExtra`)).toThrow(
      /exactly two non-empty lines/i
    );
  });
});

describe("product copy validation", () => {
  test("accepts a valid title and allowed single-line HTML description", () => {
    expect(validateProductCopy({ title: validTitle, description: validDescription })).toEqual([]);
  });

  test.each([
    ["109-character title", "A".repeat(109)],
    ["201-character title", "A".repeat(201)],
    ["unicode title", `${"A".repeat(109)}é`],
    ["question mark", `${"A".repeat(109)}?`],
    ["asterisk", `${"A".repeat(109)}*`],
    ["trademark symbol", `${"A".repeat(109)}™`],
    ["Markdown fence", titleContaining("```code```")],
    ["Markdown link", titleContaining("[link](x)")],
    ["Markdown heading", `# ${"A".repeat(108)}`],
    ["Markdown list", `- ${"A".repeat(108)}`],
    ["Markdown emphasis", titleContaining("_emphasis_")],
    ["Markdown inline code", titleContaining("`code`")]
  ])("rejects %s", (_label, title) => {
    expect(validateProductCopy({ title, description: validDescription })).not.toEqual([]);
  });

  test.each([
    ["multiline description", `${validDescription}\n<p>More</p>`],
    ["tabbed description", `${validDescription}\t`],
    ["URL", `${validDescription}<p>https://example.test</p>`],
    ["Markdown", `${validDescription} **bold**`],
    ["single-marker Markdown", `${validDescription} *bold*`],
    ["inline Markdown code", `${validDescription} \`code\``],
    ["strikethrough Markdown", `${validDescription} ~~strike~~`],
    ["Markdown link", `${validDescription} [link](x)`],
    ["Markdown image", `${validDescription} ![alt](image.png)`],
    ["Markdown heading", `# Heading ${validDescription}`],
    ["Markdown list", `- item ${validDescription}`],
    ["Markdown blockquote", `> quote ${validDescription}`],
    ["div tag", `${validDescription}<div>More</div>`],
    ["anchor tag", `${validDescription}<a>More</a>`],
    ["image tag", `${validDescription}<img>`],
    ["table tag", `${validDescription}<table></table>`],
    ["h2 tag", `${validDescription}<h2>More</h2>`],
    ["span tag", `${validDescription}<span>More</span>`]
  ])("rejects %s while all other fields remain valid", (_label, description) => {
    expect(validateProductCopy({ title: validTitle, description })).not.toEqual([]);
  });

  test.each([
    ["missing returns phrase", validDescription.replace("Returns, Refunds and Replacements", "Customer Care")],
    ["missing delivery phrase", validDescription.replace("Delivery Timeframe", "Shipping")]
  ])("rejects a description with %s", (_label, description) => {
    expect(validateProductCopy({ title: validTitle, description })).not.toEqual([]);
  });
});

describe("Packy product copy generation", () => {
  test("posts exact-prompt multimodal messages to the default GPT-5.6 SOL endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `${validTitle}\n${validDescription}` } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const systemPrompt = "Exact prompt for Packy";

    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
        systemPrompt,
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toEqual({ title: validTitle, description: validDescription });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.packyapi.com/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json"
      }
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: "gpt-5.6-sol",
      messages: buildProductCopyMessages(productInput(), systemPrompt)
    });
    expect(body).not.toHaveProperty("response_format");
  });

  test("requires PACKY_API_KEY without accepting another credential", async () => {
    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
        systemPrompt: "prompt",
        env: { PACKY_IMAGE_API_KEY: "wrong-key" }
      })
    ).rejects.toThrow("Missing PACKY_API_KEY");
  });

  test("reports only the status for a non-OK response", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response("secret upstream body", { status: 503 });
    });

    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
        systemPrompt: "private prompt",
        env: { PACKY_API_KEY: "secret-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(/^Packy product copy API failed: 503$/);
  });

  test("rejects an empty assistant content response", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
        status: 200
      });
    });

    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
        systemPrompt: "prompt",
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(/empty content/i);
  });
});
