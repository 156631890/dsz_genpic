// @vitest-environment node

import { describe, expect, test } from "vitest";
import {
  buildProductResearchRequest,
  type ProductResearchImage
} from "../../server/services/productResearch";

const png: ProductResearchImage = {
  mimeType: "image/png",
  buffer: Buffer.from("89504e470d0a1a0a", "hex")
};

describe("product research request", () => {
  test("sends source images, current rules and web search to GPT-5.6 SOL", () => {
    const body = buildProductResearchRequest({
      input: {
        sellingPoints: "Multicolour stone and pearl necklace",
        images: ["source.png"],
        imageUrls: []
      },
      images: [png],
      fieldRules: "Current DSZ field rules.",
      categoryMapping:
        "| Fashion / Women's Fashion / Women's Jewellery | 950 |",
      uploadSop: "Current full upload SOP.",
      productUploadAu: "Current Australian upload rules.",
      model: "gpt-5.6-sol"
    });

    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      stream: true,
      store: false,
      tools: [{ type: "web_search" }]
    });
    expect(body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "input_image",
        image_url: expect.stringMatching(/^data:image\/png;base64,/)
      }),
      expect.objectContaining({
        type: "input_text",
        text: expect.stringContaining("Similar-product estimates are forbidden.")
      })
    ]));
    expect(JSON.stringify(body)).toContain("Current DSZ field rules.");
    expect(JSON.stringify(body)).toContain("Current full upload SOP.");
    expect(JSON.stringify(body)).toContain("Current Australian upload rules.");
  });
});
