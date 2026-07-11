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
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 2) {
    throw new Error("Product copy response must contain exactly two non-empty lines.");
  }

  return { title: lines[0], description: lines[1] };
}

export function validateProductCopy(copy: GeneratedProductCopy): string[] {
  const errors: string[] = [];

  if (copy.title.length < 110 || copy.title.length > 200) {
    errors.push("Title must be between 110 and 200 characters.");
  }

  if (!/^[\x20-\x7E]+$/.test(copy.title)) {
    errors.push("Title must contain only printable ASCII characters.");
  }

  if (/[?*]/.test(copy.title) || containsMarkdown(copy.title)) {
    errors.push("Title contains a forbidden symbol or Markdown.");
  }

  if (/[\r\n\t]/.test(copy.description)) {
    errors.push("Description must be one line without tabs.");
  }

  if (/(?:https?:\/\/|www\.)/i.test(copy.description)) {
    errors.push("Description must not contain a URL.");
  }

  if (containsMarkdown(copy.description)) {
    errors.push("Description must not contain Markdown.");
  }

  const tags = copy.description.match(/<[^>]*>/g) || [];
  if (tags.some((tag) => !ALLOWED_HTML_TAGS.has(tag))) {
    errors.push("Description contains an unsupported HTML tag.");
  }

  const textWithoutTags = copy.description.replace(/<[^>]*>/g, "");
  if (/[<>]/.test(textWithoutTags)) {
    errors.push("Description contains malformed or unsupported HTML.");
  }

  if (!copy.description.includes("Returns, Refunds and Replacements")) {
    errors.push("Description must include Returns, Refunds and Replacements.");
  }

  if (!copy.description.includes("Delivery Timeframe")) {
    errors.push("Description must include Delivery Timeframe.");
  }

  return errors;
}

export async function generateProductCopyWithPacky(
  input: ProductInput & {
    systemPrompt?: string;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  }
): Promise<GeneratedProductCopy> {
  const env = input.env || process.env;
  const apiKey = env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("Missing PACKY_API_KEY. Cannot generate product copy.");
  }

  const systemPrompt = input.systemPrompt ?? (await loadProductSystemPrompt());
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
  const validationErrors = validateProductCopy(copy);

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
  const inlineMarkdown =
    /```|~~~|`[^`]*`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|!?\[[^\]]+\]\([^)]*\)/;
  const blockMarkdown = /^(?:#{1,6}\s|[-+*]\s|>\s|\d+\.\s)/;
  return inlineMarkdown.test(value) || blockMarkdown.test(value);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Packy product copy API returned an invalid response.");
  }
}
