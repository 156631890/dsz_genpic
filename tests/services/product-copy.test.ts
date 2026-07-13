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

  test("does not hide a tab-only extra line as blank", () => {
    expect(() => parseProductCopy(`${validTitle}\n\t\n${validDescription}`)).toThrow(
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

  test("accepts authorized repeated ordinary spaces in footer text", () => {
    const doubleSpacedFooter = canonicalFooter.replace(
      "Products that are received",
      "Products  that  are received"
    );

    expect(validateCopy({
      title: validTitle,
      description: `${descriptionPrefix}${doubleSpacedFooter}`
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

  test.each(["&#8482;", "&#x2122;", "&#20013;", "&#x4E2D;"])(
    "decodes and rejects forbidden numeric entity %s",
    (entity) => {
      const description = `${descriptionPrefix}<p>Invalid ${entity} text</p>${canonicalFooter}`;
      expect(validateCopy({ title: validTitle, description })).toContain(
        "Description text contains a forbidden character."
      );
    }
  );

  test.each(["&trade;", "&copy;", "&reg;", "&euro;"])(
    "decodes and rejects forbidden named entity %s",
    (entity) => {
      const description = `${descriptionPrefix}<p>Invalid ${entity} text</p>${canonicalFooter}`;
      expect(validateCopy({ title: validTitle, description })).toContain(
        "Description text contains a forbidden character."
      );
    }
  );

  test.each(["&#xZZ;", "&#99999999;"])(
    "rejects malformed or out-of-range numeric entity %s safely",
    (entity) => {
      const description = `${descriptionPrefix}<p>Invalid ${entity} text</p>${canonicalFooter}`;
      expect(validateCopy({ title: validTitle, description })).toContain(
        "Description text contains a forbidden character."
      );
    }
  );

  test.each([
    "&#8482",
    "&#x2122",
    "&#8482abc",
    "&#169copy",
    "&copy text",
    "&reg",
    "&reg text",
    "&copycat",
    "&trade",
    "&euro",
    "&bull",
    "&rarr",
    "&larr",
    "&ldquo",
    "&rdquo",
    "&lsquo",
    "&rsquo",
    "&star",
    "&starf",
    "&check",
    "&checkmark",
    "&ast",
    "&quest",
    "https&#58&#47&#47example&#46com"
  ])("rejects semicolonless HTML entity bypass %s", (text) => {
    const description = `${descriptionPrefix}<p>Invalid ${text}</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(
      "Description text contains a forbidden character."
    );
  });

  test("decodes an encoded URL before URL validation", () => {
    const description =
      `${descriptionPrefix}<p>https&#58;&#47;&#47;example&#46;com</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(urlError);
  });

  test("decodes encoded Markdown before Markdown validation", () => {
    const description =
      `${descriptionPrefix}<p>&#42;&#42;bold&#42;&#42;</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(markdownError);
  });

  test("accepts amp as a decoded ordinary ampersand", () => {
    const description = `${descriptionPrefix}<p>Storage &amp; organisation.</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toEqual([]);
  });

  test.each(["Salt & Pepper", "R&D", "Rock&Roll"])(
    "accepts ordinary standalone ampersand text %s",
    (text) => {
      const description = `${descriptionPrefix}<p>${text}</p>${canonicalFooter}`;

      expect(validateCopy({ title: validTitle, description })).toEqual([]);
    }
  );

  test("rejects unknown named entities safely", () => {
    const description = `${descriptionPrefix}<p>Unknown &bogus; entity.</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(
      "Description text contains a forbidden character."
    );
  });

  test.each([
    "http://example.com/path",
    "https://example.com/path",
    "www.example.com",
    "example.com",
    "//example.com/path",
    "ftp://example.com/file",
    "mailto:buyer@example.com",
    "tel:+61412345678"
  ])("rejects URL or URI form %s", (url) => {
    const description = `${descriptionPrefix}<p>${url}</p>${canonicalFooter}`;
    expect(validateCopy({ title: validTitle, description })).toContain(urlError);
  });

  test.each([
    "sms:+61412345678",
    "geo:-37,144",
    "urn:isbn:9780141036144",
    "magnet:?xt=urn:btih:abcdef",
    "ws://example.com/socket",
    "wss://example.com/socket"
  ])("rejects generic URI scheme %s", (uri) => {
    const description = `${descriptionPrefix}<p>${uri}</p>${canonicalFooter}`;

    expect(validateCopy({ title: validTitle, description })).toContain(urlError);
  });

  test.each([
    "SMS:+61412345678",
    "Geo:-37,144",
    "URN:ISBN:9780141036144",
    "Magnet:?xt=urn:btih:abcdef",
    "WS://example.com/socket",
    "WsS://example.com/socket"
  ])("rejects case-insensitive URI scheme %s", (uri) => {
    const description = `${descriptionPrefix}<p>${uri}</p>${canonicalFooter}`;

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

  test("does not reject an unknown alphabetic colon token as a URI scheme", () => {
    const description = `<p>Custom:resource/path is an internal label.</p>${canonicalFooter}`;

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

  test("adds verified research facts, source images and web search without changing the system prompt", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      _init?: RequestInit
    ) => {
      void _url;
      void _init;
      return new Response([
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: `${validTitle}\n${validDescription}`
        })}`,
        "data: [DONE]",
        ""
      ].join("\n\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    });

    await generateProductCopyWithPacky({
      input: productInput(),
      verifiedResearchFacts:
        "Category: Women's Jewellery\nColour: Multicolor\nPackage weight kg: 0.12",
      images: [{
        mimeType: "image/png",
        buffer: Buffer.from("89504e470d0a1a0a", "hex")
      }],
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl: fetchImpl as typeof fetch
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.instructions).toBe(exactSystemPrompt);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "input_image" }),
      expect.objectContaining({
        type: "input_text",
        text: expect.stringContaining("Verified research facts")
      })
    ]));
  });

  test("posts the exact prompt and product facts to the Responses endpoint with the text key", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(
        JSON.stringify({ output_text: `${validTitle}\n${validDescription}` }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    await expect(
      generateProductCopyWithPacky({
        input: productInput(),
        env: { PACKY_API_KEY: "shared-key", PACKY_TEXT_API_KEY: "text-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toEqual({ title: validTitle, description: validDescription });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.packyapi.com/v1/responses");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer text-key",
        "Content-Type": "application/json"
      }
    });
    const body = JSON.parse(String(init?.body));
    const expectedUserMessage = buildProductCopyMessages(productInput(), exactSystemPrompt)[1];
    if (expectedUserMessage.role !== "user" || expectedUserMessage.content[0].type !== "text") {
      throw new Error("Expected the product-copy user message to start with text.");
    }
    expect(body).toEqual({
      model: "gpt-5.6-sol",
      instructions: exactSystemPrompt,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: expectedUserMessage.content[0].text }]
      }],
      tools: [{ type: "web_search" }],
      store: false,
      stream: true
    });
  });

  test("requires a text or shared Packy credential without accepting the image credential", async () => {
    await expect(
      generateProductCopyWithPacky({
        input: productInput(),
        env: { PACKY_IMAGE_API_KEY: "wrong-key" }
      })
    ).rejects.toThrow("Missing PACKY_TEXT_API_KEY or PACKY_API_KEY");
  });

  test("reports only the status for a non-OK response", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response("secret upstream body", { status: 503 });
    });

    await expect(
      generateProductCopyWithPacky({
        input: productInput(),
        env: { PACKY_API_KEY: "secret-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(/^Packy product copy API failed: 503$/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("rejects an empty assistant content response", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(JSON.stringify({ output_text: "" }), {
        status: 200
      });
    });

    await expect(
      generateProductCopyWithPacky({
        input: productInput(),
        env: { PACKY_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toThrow(/empty content/i);
  });

  test("retries completed Responses that contain no output text", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      return new Response(JSON.stringify(
        attempt < 3
          ? { status: "completed", output: [] }
          : { output_text: `${validTitle}\n${validDescription}` }
      ), { status: 200 });
    });

    await expect(generateProductCopyWithPacky({
      input: productInput(),
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({ title: validTitle, description: validDescription });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("retries Responses whose copy does not satisfy the system prompt", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      return new Response(JSON.stringify({
        output_text: attempt === 1
          ? `${validTitle}\n<p>Missing the canonical footer.</p>`
          : `${validTitle}\n${validDescription}`
      }), { status: 200 });
    });

    await expect(generateProductCopyWithPacky({
      input: productInput(),
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({ title: validTitle, description: validDescription });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("uses streaming Responses deltas for Packy copy", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      void url;
      void init;
      return new Response([
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: `${validTitle}\n`
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: validDescription
        })}`,
        "data: [DONE]",
        ""
      ].join("\n\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    });

    await expect(generateProductCopyWithPacky({
      input: productInput(),
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({ title: validTitle, description: validDescription });

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true });
  });

  test("reads text from nested Responses output content", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: `${validTitle}\n${validDescription}` }]
      }]
    }), { status: 200 }));

    await expect(generateProductCopyWithPacky({
      input: productInput(),
      env: { PACKY_TEXT_API_KEY: "text-key" },
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({ title: validTitle, description: validDescription });
  });
});
