// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  buildProductCopyMessages,
  extractCanonicalProductFooter,
  generateProductCopyWithPacky,
  loadProductSystemPrompt,
  parseProductCopy,
  validateProductCopy
} from "../../server/services/productCopy";
import { PRODUCT_IMAGE_ROLES, type ProductInput } from "../../shared/product";

const validTitle = "Compact Storage Organiser - Practical Space Saving Design, Easy Everyday Access, Versatile Home and Travel Use";
const exactSystemPrompt = await readFile(resolve("rules/DSZ系统prompt 4月20版本.txt"), "utf8");
const canonicalFooter = extractCanonicalProductFooter(exactSystemPrompt);
const descriptionPrefix = "<p><strong>Product Overview</strong></p><p>A practical organiser for everyday use.</p>";
const validDescription = `${descriptionPrefix}${canonicalFooter}`;

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

function validateCopy(copy: { title: string; description: string }): string[] {
  return validateProductCopy(copy, canonicalFooter);
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

  test.each([
    [
      "leading title tab",
      `\t${validTitle}\n${validDescription}`,
      "Title contains a character outside the approved ecommerce punctuation set."
    ],
    [
      "trailing title tab",
      `${validTitle}\t\n${validDescription}`,
      "Title contains a character outside the approved ecommerce punctuation set."
    ],
    [
      "leading description tab",
      `${validTitle}\n\t${validDescription}`,
      "Description must be one line without tabs."
    ],
    [
      "trailing description tab",
      `${validTitle}\n${validDescription}\t`,
      "Description must be one line without tabs."
    ]
  ])("preserves and rejects a %s", (_label, raw, expectedError) => {
    expect(validateCopy(parseProductCopy(raw))).toContain(expectedError);
  });
});

describe("product copy validation", () => {
  const footerError = "Description must end with the exact canonical DSZ footer.";
  const htmlStructureError =
    "Description contains unclosed, unexpected, or misnested HTML tags.";
  const markdownError = "Description must not contain Markdown.";
  const urlError = "Description must not contain a URL.";
  const unsupportedTagError = "Description contains an unsupported HTML tag.";
  const descriptionLineError = "Description must be one line without tabs.";
  const titleLengthError = "Title must be between 110 and 200 characters.";
  const titleCharacterError =
    "Title contains a character outside the approved ecommerce punctuation set.";
  const titleMarkdownError = "Title must not contain Markdown.";

  test("extracts only the exact HTML footer from the loaded system prompt", () => {
    expect(canonicalFooter).toMatch(/^<p>/);
    expect(canonicalFooter).toMatch(/<\/ul>$/);
    expect(canonicalFooter).not.toContain("在描述最后");
    expect(canonicalFooter).not.toContain("固定页脚如下");
  });

  test("extracts the HTML footer without surrounding rule prose", () => {
    const suppliedPrompt = [
      "【固定页脚规则】",
      "- Preserve this rule.",
      "- 固定页脚如下：",
      canonicalFooter,
      "- This prose is not part of the footer.",
      "【格式清洗规则】"
    ].join("\n");

    expect(extractCanonicalProductFooter(suppliedPrompt)).toBe(canonicalFooter);
  });

  test("extracts and safely joins a complete multiline canonical footer", () => {
    const multilineFooter = canonicalFooter
      .replace(/></g, ">\n<")
      .replace("Products that are received", "Products that\nare received");
    const suppliedPrompt = [
      "【固定页脚规则】",
      "- 固定页脚如下：",
      multilineFooter,
      "【格式清洗规则】"
    ].join("\n");

    const extracted = extractCanonicalProductFooter(suppliedPrompt);

    expect(extracted).toBe(multilineFooter.replace(/\n/g, " "));
    expect(extracted).toContain("Products that are received");
    expect(extracted).toContain("Australian Consumer Law (ACL)");
    expect(extracted).toContain("Delivery Timeframe");
    expect(extracted).toContain("WA, NT, and TAS");
  });

  test.each([
    ["missing ACL phrase", canonicalFooter.replace("Australian Consumer Law (ACL)", "consumer law")],
    ["missing delivery phrase", canonicalFooter.replace("Delivery Timeframe", "Shipping")],
    ["invalid HTML structure", canonicalFooter.replace("</ul>", "")]
  ])("rejects a canonical footer with %s", (_label, footer) => {
    const suppliedPrompt = [
      "【固定页脚规则】",
      "- 固定页脚如下：",
      footer,
      "【格式清洗规则】"
    ].join("\n");

    expect(() => extractCanonicalProductFooter(suppliedPrompt)).toThrow(/canonical product footer/i);
  });

  test("accepts a valid title and allowed single-line HTML description", () => {
    expect(validateCopy({ title: validTitle, description: validDescription })).toEqual([]);
  });

  test.each([
    ["109-character title", "A".repeat(109), titleLengthError],
    ["201-character title", "A".repeat(201), titleLengthError],
    ["unicode title", `${"A".repeat(109)}é`, titleCharacterError],
    ["question mark", `${"A".repeat(109)}?`, titleCharacterError],
    ["asterisk", `${"A".repeat(109)}*`, titleCharacterError],
    ["trademark symbol", `${"A".repeat(109)}™`, titleCharacterError],
    ["Markdown fence", titleContaining("```code```"), titleMarkdownError],
    ["Markdown link", titleContaining("[link](x)"), titleMarkdownError],
    ["Markdown heading", `# ${"A".repeat(108)}`, titleMarkdownError],
    ["Markdown list", `- ${"A".repeat(108)}`, titleMarkdownError],
    ["Markdown emphasis", titleContaining("_emphasis_"), titleMarkdownError],
    ["Markdown inline code", titleContaining("`code`"), titleMarkdownError]
  ])("rejects %s", (_label, title, expectedError) => {
    expect(validateCopy({ title, description: validDescription })).toContain(expectedError);
  });

  test.each(["$", "@", "^", "{", "}", "|", "\\", "~", "[", "]", "?", "*", "`"])(
    "rejects forbidden printable ASCII title symbol %s",
    (symbol) => {
      expect(
        validateCopy({ title: titleContaining(symbol), description: validDescription })
      ).toContain(titleCharacterError);
    }
  );

  test("accepts the complete approved ecommerce title punctuation set", () => {
    const approvedPunctuation = `Comma, period. hyphen- apostrophe' quote" colon: semicolon; parentheses() ampersand& slash/ plus+ percent%`;

    expect(
      validateCopy({
        title: titleContaining(approvedPunctuation),
        description: validDescription
      })
    ).toEqual([]);
  });

  test.each([
    ["multiline description", `${descriptionPrefix}<p>Line one\nLine two</p>${canonicalFooter}`, descriptionLineError],
    ["tabbed description", `${descriptionPrefix}<p>Tabbed\ttext</p>${canonicalFooter}`, descriptionLineError],
    ["URL", `${descriptionPrefix}<p>https://example.test</p>${canonicalFooter}`, urlError],
    ["Markdown", `${descriptionPrefix}<p>**bold**</p>${canonicalFooter}`, markdownError],
    ["single-marker Markdown", `${descriptionPrefix}<p>*bold*</p>${canonicalFooter}`, markdownError],
    ["inline Markdown code", `${descriptionPrefix}<p>\`code\`</p>${canonicalFooter}`, markdownError],
    ["strikethrough Markdown", `${descriptionPrefix}<p>~~strike~~</p>${canonicalFooter}`, markdownError],
    ["Markdown link", `${descriptionPrefix}<p>[link](x)</p>${canonicalFooter}`, markdownError],
    ["Markdown image", `${descriptionPrefix}<p>![alt](image.png)</p>${canonicalFooter}`, markdownError],
    ["Markdown heading", `# Heading ${descriptionPrefix}${canonicalFooter}`, markdownError],
    ["Markdown list", `- item ${descriptionPrefix}${canonicalFooter}`, markdownError],
    ["Markdown blockquote", `> quote ${descriptionPrefix}${canonicalFooter}`, markdownError],
    ["div tag", `${descriptionPrefix}<div>More</div>${canonicalFooter}`, unsupportedTagError],
    ["anchor tag", `${descriptionPrefix}<a>More</a>${canonicalFooter}`, unsupportedTagError],
    ["image tag", `${descriptionPrefix}<img>${canonicalFooter}`, unsupportedTagError],
    ["table tag", `${descriptionPrefix}<table></table>${canonicalFooter}`, unsupportedTagError],
    ["h2 tag", `${descriptionPrefix}<h2>More</h2>${canonicalFooter}`, unsupportedTagError],
    ["span tag", `${descriptionPrefix}<span>More</span>${canonicalFooter}`, unsupportedTagError]
  ])("rejects %s while all other fields remain valid", (_label, description, expectedError) => {
    expect(validateCopy({ title: validTitle, description })).toContain(expectedError);
  });

  test.each([
    ["missing returns phrase", validDescription.replace("Returns, Refunds and Replacements", "Customer Care")],
    ["missing delivery phrase", validDescription.replace("Delivery Timeframe", "Shipping")]
  ])("rejects a description with %s", (_label, description) => {
    expect(validateCopy({ title: validTitle, description })).toContain(footerError);
  });

  test.each([
    ["truncated footer", `${descriptionPrefix}${canonicalFooter.slice(0, -20)}`],
    [
      "rewritten ACL wording",
      `${descriptionPrefix}${canonicalFooter.replace("Australian Consumer Law (ACL)", "Australian Consumer Law")}`
    ],
    [
      "missing delivery regions",
      `${descriptionPrefix}${canonicalFooter.replace("NSW, SA, ACT, and QLD", "NSW and QLD")}`
    ],
    ["footer followed by content", `${validDescription}<p>Extra content</p>`]
  ])("rejects %s", (_label, description) => {
    expect(validateCopy({ title: validTitle, description })).toContain(footerError);
  });

  test("accepts the exact footer with normalized whitespace between adjacent tags", () => {
    const spacedFooter = canonicalFooter.replace(/></g, ">   <");

    expect(validateCopy({
      title: validTitle,
      description: `${descriptionPrefix}${spacedFooter}`
    })).toEqual([]);
  });

  test("accepts insignificant text-node whitespace changes at footer tag boundaries", () => {
    const footerWithoutHeadingSpace = canonicalFooter.replace(
      "Returns, Refunds and Replacements </strong>",
      "Returns, Refunds and Replacements</strong>"
    );

    expect(validateCopy({
      title: validTitle,
      description: `${descriptionPrefix}${footerWithoutHeadingSpace}`
    })).toEqual([]);
  });

  test.each([
    ["unclosed p", `<p>Unclosed${canonicalFooter}`],
    ["mismatched strong and p", `<p><strong>Misnested</p></strong>${canonicalFooter}`],
    ["p nested directly in ul", `<p>Overview</p><ul><p>Invalid</p></ul>${canonicalFooter}`],
    ["li outside ul", `<li>Invalid</li>${canonicalFooter}`],
    ["alternate br", `<p>Invalid<br>break</p>${canonicalFooter}`],
    ["br with attributes", `<p>Invalid<br class="gap" />break</p>${canonicalFooter}`],
    ["tag with attributes", `<p class="copy">Invalid</p>${canonicalFooter}`],
    ["stray markup", `<p>Invalid <<strong>text</strong></p>${canonicalFooter}`]
  ])("rejects structurally invalid HTML with an %s", (_label, description) => {
    expect(validateCopy({ title: validTitle, description })).toContain(htmlStructureError);
  });

  test("accepts valid p, strong, br, ul, and li nesting", () => {
    const description =
      `<p>Overview <strong>with emphasis</strong><br />and detail.</p>` +
      `<ul><li><strong>Feature</strong> with benefit<br />and context.</li></ul>` +
      canonicalFooter;

    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });

  test("accepts a balanced top-level ul without a preceding p", () => {
    const description = `<ul><li>Standalone list item.</li></ul>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });

  test("accepts a numbered instruction as ordinary li text", () => {
    const description =
      `<ul><li>1. Charge the device before use.</li></ul>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });

  test("rejects a description with no allowed HTML elements", () => {
    expect(
      validateProductCopy({ title: validTitle, description: "Plain text only" }, canonicalFooter)
    ).toContain(htmlStructureError);
  });

  test.each(["中文", "😀", "™", "©", "€", "?", "*"])(
    "rejects forbidden description text characters in %s",
    (text) => {
      const description = `${descriptionPrefix}<p>Invalid ${text} text</p>${canonicalFooter}`;
      expect(validateCopy({ title: validTitle, description })).toContain(
        "Description text contains a forbidden character."
      );
    }
  );

  test.each([
    "http://example.com/path",
    "https://example.com/path",
    "www.example.com",
    "example.com",
    "//example.com/path",
    "ftp://example.com/file",
    "mailto:buyer@example.com"
  ])("rejects URL or URI form %s", (url) => {
    const description = `${descriptionPrefix}<p>${url}</p>${canonicalFooter}`;
    expect(validateCopy({ title: validTitle, description })).toContain(urlError);
  });

  test.each([
    ["before elements", "# Heading<p>Overview</p>"],
    ["inside an element", "<p># Heading</p>"],
    ["between elements", "<p>Overview</p>- item<p>More</p>"],
    ["after a br boundary", "<p>Overview<br />> quote</p>"],
    ["ordered list outside elements", "<p>Overview</p>1. item<p>After</p>"],
    ["after elements", "<p>Overview</p># Heading"]
  ])("rejects block Markdown %s", (_position, adversarialHtml) => {
    const description = `${adversarialHtml}${canonicalFooter}`;
    expect(validateCopy({ title: validTitle, description })).toContain(markdownError);
  });

  test.each([
    ["setext equals heading", "<p>Heading text</p>===<p>After</p>"],
    ["setext hyphen heading", "<p>Heading text</p>---<p>After</p>"],
    ["hyphen horizontal rule", "<p>Before</p>---<p>After</p>"],
    ["asterisk horizontal rule", "<p>Before</p>***<p>After</p>"],
    ["underscore horizontal rule", "<p>Before</p>___<p>After</p>"],
    [
      "Markdown table",
      "<p>| Feature | Benefit |</p><p>| --- | --- |</p><p>| Compact | Portable |</p>"
    ]
  ])("rejects %s between allowed HTML blocks", (_label, adversarialHtml) => {
    const description = `${adversarialHtml}${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(markdownError);
  });

  test("preserves legitimate hyphenated prose", () => {
    const description = `<p>Space-saving design supports day-to-day use.</p>${canonicalFooter}`;
    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });

  test("does not treat ordinary colon-separated prose as a URL scheme", () => {
    const description = `<p>Note:Use only as intended.</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });
});

describe("Packy product copy generation", () => {
  test("does not expose a system prompt override", () => {
    type GenerationInput = Parameters<typeof generateProductCopyWithPacky>[0];
    type HasSystemPromptOverride = "systemPrompt" extends keyof GenerationInput ? true : false;
    const hasSystemPromptOverride: HasSystemPromptOverride = false;

    expect(hasSystemPromptOverride).toBe(false);
  });

  test("posts exact-prompt multimodal messages to the default GPT-5.6 SOL endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `${validTitle}\n${validDescription}` } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
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
      messages: buildProductCopyMessages(productInput(), exactSystemPrompt)
    });
    expect(body).not.toHaveProperty("response_format");
  });

  test("requires PACKY_API_KEY without accepting another credential", async () => {
    await expect(
      generateProductCopyWithPacky({
        ...productInput(),
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
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(/empty content/i);
  });
});
