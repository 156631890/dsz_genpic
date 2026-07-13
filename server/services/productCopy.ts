import { readFile } from "node:fs/promises";
import type { GeneratedProductCopy, ProductInput } from "../../shared/product.js";

export type ProductCopyMessage =
  | { role: "system"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

const PRODUCT_PROMPT_URL = new URL(
  "../../rules/DSZ系统prompt 4月20版本.txt",
  import.meta.url
);
const ALLOWED_HTML_TAGS = new Set([
  "<p>",
  "</p>",
  "<strong>",
  "</strong>",
  "<ul>",
  "</ul>",
  "<li>",
  "</li>",
  "<br />"
]);

export async function loadProductSystemPrompt(): Promise<string> {
  return readFile(PRODUCT_PROMPT_URL, "utf8");
}

export function extractCanonicalProductFooter(systemPrompt: string): string {
  const footerRulesStart = systemPrompt.indexOf("【固定页脚规则】");
  const formatRulesStart = systemPrompt.indexOf("【格式清洗规则】", footerRulesStart);
  const footerMarker = "固定页脚如下：";
  const footerMarkerStart = systemPrompt.indexOf(footerMarker, footerRulesStart);

  if (
    footerRulesStart < 0 ||
    formatRulesStart < 0 ||
    footerMarkerStart < 0 ||
    footerMarkerStart >= formatRulesStart
  ) {
    throw new Error("DSZ system prompt does not contain the canonical product footer.");
  }

  const footerRegion = systemPrompt
    .slice(footerMarkerStart + footerMarker.length, formatRulesStart)
    .trim();
  const htmlStart = footerRegion.indexOf("<");
  const htmlEnd = footerRegion.lastIndexOf(">");
  const footer =
    htmlStart >= 0 && htmlEnd >= htmlStart
      ? footerRegion.slice(htmlStart, htmlEnd + 1).replace(/\r?\n/g, " ")
      : "";
  const tags = footer.match(/<[^>]*>/g) || [];
  const textNodes = footer.replace(/<[^>]*>/g, "");

  if (
    !footer.startsWith("<") ||
    !footer.endsWith(">") ||
    tags.some((tag) => !ALLOWED_HTML_TAGS.has(tag)) ||
    /[<>]/.test(textNodes) ||
    hasInvalidHtmlStructure(footer) ||
    !footer.includes("Australian Consumer Law (ACL)") ||
    !footer.includes("Delivery Timeframe")
  ) {
    throw new Error("DSZ system prompt does not contain the canonical product footer.");
  }

  return footer;
}

export function buildProductCopyMessages(
  input: ProductInput,
  systemPrompt: string
): ProductCopyMessage[] {
  const facts = [
    "Verified product facts:",
    `Selling points: ${input.sellingPoints}`,
    optionalFact("Category hint", input.categoryHint),
    optionalFact("Purchase price CNY", input.purchasePriceCny),
    optionalFact("Package weight kg", input.packageWeightKg),
    optionalFact("Length cm", input.lengthCm),
    optionalFact("Width cm", input.widthCm),
    optionalFact("Height cm", input.heightCm)
  ].filter((fact): fact is string => Boolean(fact));
  const content: Extract<ProductCopyMessage, { role: "user" }>["content"] = [
    { type: "text", text: facts.join("\n") }
  ];

  for (const url of input.imageUrls) {
    if (isHttpsUrl(url)) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content }
  ];
}

export function parseProductCopy(raw: string): GeneratedProductCopy {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^ +| +$/g, ""))
    .filter((line) => line.length > 0);

  if (lines.length !== 2) {
    throw new Error("Product copy response must contain exactly two non-empty lines.");
  }

  return { title: lines[0], description: lines[1] };
}

export function validateProductCopy(
  copy: GeneratedProductCopy,
  canonicalFooter: string
): string[] {
  const errors: string[] = [];

  if (copy.title.length < 110 || copy.title.length > 200) {
    errors.push("Title must be between 110 and 200 characters.");
  }

  if (!/^[A-Za-z0-9 ,.'":;()&/+%-]+$/.test(copy.title)) {
    errors.push("Title contains a character outside the approved ecommerce punctuation set.");
  }

  if (containsMarkdown(copy.title)) {
    errors.push("Title must not contain Markdown.");
  }

  if (/[\r\n\t]/.test(copy.description)) {
    errors.push("Description must be one line without tabs.");
  }

  const tags = copy.description.match(/<[^>]*>/g) || [];
  const textNodes = copy.description.replace(/<[^>]*>/g, " ");
  const decodedDescription = decodeHtmlCharacterReferences(copy.description);
  const decodedTextNodes = decodeHtmlCharacterReferences(textNodes);

  if (containsUrlOrUri(decodedTextNodes.value)) {
    errors.push("Description must not contain a URL.");
  }

  if (containsMarkdown(decodedDescription.value)) {
    errors.push("Description must not contain Markdown.");
  }

  const hasUnsupportedTags = tags.some((tag) => !ALLOWED_HTML_TAGS.has(tag));
  const hasMalformedMarkup = /[<>]/.test(textNodes);

  if (hasUnsupportedTags) {
    errors.push("Description contains an unsupported HTML tag.");
  }

  if (hasUnsupportedTags || hasMalformedMarkup || hasInvalidHtmlStructure(copy.description)) {
    errors.push("Description contains unclosed, unexpected, or misnested HTML tags.");
  }

  if (hasMalformedMarkup) {
    errors.push("Description contains malformed or unsupported HTML.");
  }

  if (
    !decodedDescription.valid ||
    !decodedTextNodes.valid ||
    !/^[\x20-\x7E]*$/.test(decodedTextNodes.value) ||
    /[?*<>]/.test(decodedTextNodes.value)
  ) {
    errors.push("Description text contains a forbidden character.");
  }

  if (
    !canonicalFooter ||
    !normalizeHtmlTokens(copy.description).endsWith(
      normalizeHtmlTokens(canonicalFooter)
    )
  ) {
    errors.push("Description must end with the exact canonical DSZ footer.");
  }

  return errors;
}

export async function generateProductCopyWithPacky(
  input: ProductInput & {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  }
): Promise<GeneratedProductCopy> {
  const env = input.env || process.env;
  const apiKey = env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PACKY_API_KEY. Cannot generate product copy.");
  }

  const systemPrompt = await loadProductSystemPrompt();
  const canonicalFooter = extractCanonicalProductFooter(systemPrompt);
  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(/\/+$/, "");
  const fetcher = input.fetchImpl || fetch;
  const response = await fetcher(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.PACKY_TEXT_MODEL || "gpt-5.6-sol",
      messages: buildProductCopyMessages(input, systemPrompt)
    })
  });

  if (!response.ok) {
    throw new Error(`Packy product copy API failed: ${response.status}`);
  }

  const data = (await readJsonResponse(response)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Packy product copy API returned empty content.");
  }

  const copy = parseProductCopy(content);
  const validationErrors = validateProductCopy(
    copy,
    canonicalFooter
  );

  if (validationErrors.length > 0) {
    throw new Error(`Packy product copy API returned invalid content: ${validationErrors.join(" ")}`);
  }

  return copy;
}

function optionalFact(label: string, value: string | number | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : `${label}: ${value}`;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function containsMarkdown(value: string): boolean {
  const markdownText = value
    .replace(/<\/?(?:p|ul|li)>|<br \/>/g, "\n")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/\n+/g, "\n");
  const inlineMarkdown =
    /```|~~~|`[^`]*`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|!?\[[^\]]+\]\([^)]*\)/;
  const blockMarkdown = /^[ \t]*(?:#{1,6}(?:\s|$)|[-+*]\s+|>\s+)/m;
  const orderedMarkdown = /^[ \t]*\d+[.)]\s+/m;
  const markdownRule = /^[ \t]*(?:={3,}|-{3,}|\*{3,}|_{3,})[ \t]*$/m;
  const markdownTable =
    /^\s*\|?.+\|.+\|?\s*\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
  return (
    inlineMarkdown.test(markdownText) ||
    blockMarkdown.test(markdownText) ||
    orderedMarkdown.test(extractRootText(value)) ||
    markdownRule.test(markdownText) ||
    markdownTable.test(markdownText)
  );
}

function containsUrlOrUri(value: string): boolean {
  const knownUriScheme =
    /\b(?:https?|ftps?|mailto|tel|sms|geo|urn|magnet|wss?|data|file|javascript):/i;
  const protocolRelative = /\/\/[a-z0-9]/i;
  const bareDomain = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/i;
  return (
    knownUriScheme.test(value) ||
    protocolRelative.test(value) ||
    /\bwww\./i.test(value) ||
    bareDomain.test(value)
  );
}

function decodeHtmlCharacterReferences(value: string): {
  value: string;
  valid: boolean;
} {
  const numericReference = /&#(?:x[0-9a-f]+|\d+)/i;
  const forbiddenLegacyNamedPrefix =
    /&(?:copy|reg|trade|euro|bull|rarr|larr|ldquo|rdquo|lsquo|rsquo|starf?|check(?:mark)?|ast|quest|nbsp|lt|gt|quot|amp)(?!;)/i;
  const namedReferences: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: '"'
  };
  let valid =
    !numericReference.test(value) && !forbiddenLegacyNamedPrefix.test(value);
  const decoded = value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (reference, body: string) => {
      if (!body.startsWith("#")) {
        const named = namedReferences[body.toLowerCase()];

        if (named !== undefined) return named;
        valid = false;
        return reference;
      }

      const hexadecimal = body[1]?.toLowerCase() === "x";
      const digits = body.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);

      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        valid = false;
        return reference;
      }

      return String.fromCodePoint(codePoint);
    }
  );

  if (/&(?:#[^;\s<]*|[a-z][a-z0-9]+);/i.test(decoded)) {
    valid = false;
  }

  return { value: decoded, valid };
}

function hasInvalidHtmlStructure(value: string): boolean {
  const stack: string[] = [];
  const tokens = value.match(/<[^>]*>|[^<>]+|[<>]/g) || [];
  let hasAllowedElement = false;

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (token === ">" || (stack.at(-1) === "ul" && token.trim())) return true;
      continue;
    }

    if (!ALLOWED_HTML_TAGS.has(token)) return true;
    hasAllowedElement = true;

    if (token === "<br />") {
      if (!isTextContainer(stack.at(-1))) return true;
      continue;
    }

    const match = token.match(/^<(\/)?(p|strong|ul|li)>$/);

    if (!match) return true;
    const [, closing, name] = match;

    if (!closing) {
      const parent = stack.at(-1);

      if (name === "p" && parent !== undefined) return true;
      if (name === "ul" && parent !== undefined) return true;
      if (name === "li" && parent !== "ul") return true;
      if (name === "strong" && !isTextContainer(parent)) return true;
      stack.push(name);
    } else if (stack.pop() !== name) {
      return true;
    }
  }

  return !hasAllowedElement || stack.length > 0;
}

function isTextContainer(tag: string | undefined): boolean {
  return tag === "p" || tag === "li";
}

function extractRootText(value: string): string {
  const tokens = value.match(/<[^>]*>|[^<]+/g) || [];
  const stack: string[] = [];
  let rootText = "";

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (stack.length === 0) rootText += token;
      continue;
    }

    rootText += "\n";
    const match = token.match(/^<(\/)?(p|strong|ul|li)>$/);

    if (!match) continue;
    const [, closing, name] = match;

    if (closing) {
      if (stack.at(-1) === name) stack.pop();
    } else {
      stack.push(name);
    }
  }

  return rootText;
}

function normalizeHtmlTokens(value: string): string {
  const tokens = value.match(/<[^>]*>|[^<]+/g) || [];

  return tokens
    .map((token) => {
      if (token.startsWith("<")) return `tag:${token}`;
      const text = token.replace(/\s+/g, " ").trim();
      return text ? `text:${text}` : "";
    })
    .filter(Boolean)
    .join("\u0000");
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Packy product copy API returned an invalid response.");
  }
}
