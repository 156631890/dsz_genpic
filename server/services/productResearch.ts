import type { ProductInput } from "../../shared/product.js";

export interface ProductResearchImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  buffer: Buffer;
}

interface ProductResearchRequestOptions {
  input: ProductInput;
  images: ProductResearchImage[];
  fieldRules: string;
  categoryMapping: string;
  uploadSop: string;
  productUploadAu: string;
  model: string;
}

export function buildProductResearchRequest(
  options: ProductResearchRequestOptions
) {
  const content = [
    ...options.images.map((image) => ({
      type: "input_image" as const,
      image_url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`
    })),
    {
      type: "input_text" as const,
      text: [
        "Identify this exact product and return strict JSON only.",
        "Search the web for the same product and variant before returning package measurements.",
        "Prefer manufacturer or supplier pages, then the exact 1688 listing, then an exact marketplace listing.",
        "Similar-product estimates are forbidden.",
        "DSZ FIELD RULES:",
        options.fieldRules,
        "CATEGORY MAPPING:",
        options.categoryMapping,
        "FULL UPLOAD SOP:",
        options.uploadSop,
        "AU PRODUCT RULES:",
        options.productUploadAu,
        "PRODUCT INPUT:",
        JSON.stringify(options.input),
        "Return identity, category, colour, package, sources, riskFlags and reviewNotes.",
        "Each source must include url, title, matchedVariant, evidence, exactProductMatch,",
        "and its own package object with weightKg, lengthCm, widthCm and heightCm,",
        "or package null when that source does not explicitly publish every measurement.",
        "Every source URL in the JSON must be emitted with a web-search URL citation annotation.",
        "Set exactProductMatch false for similar products. Never infer a missing source value.",
        "Do not harmonise conflicting sources."
      ].join("\n")
    }
  ];

  return {
    model: options.model,
    instructions:
      "Research Dropshipzone product facts. Use web search and return strict JSON without hidden reasoning.",
    input: [{ role: "user" as const, content }],
    tools: [{ type: "web_search" as const }],
    store: false,
    stream: true
  };
}
