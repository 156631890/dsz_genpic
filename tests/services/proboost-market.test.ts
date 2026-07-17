// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import {
  analyzeAmazonAuMarket,
  buildSearchCandidates,
  ProboostMarketError
} from "../../server/services/proboostMarket";

const product = {
  productName: "Wireless Sports Earbuds - Secure Fit and Clear Calls",
  categoryName: "Electronics / Headphones / In-Ear Headphones",
  categoryHint: "Wireless Earbuds",
  sellingPoints: "Bluetooth earbuds with charging case",
  currentRrpAud: 27
};

describe("ProBoost Amazon Australia market analysis", () => {
  test("builds focused search candidates without marketing filler", () => {
    expect(buildSearchCandidates(product)).toEqual([
      "wireless sports earbuds",
      "wireless earbuds",
      "ear headphones",
      "bluetooth earbuds charging",
      "wireless sports"
    ]);
  });

  test("compares current RRP with matched competitors and loads category price bands", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.params.name === "amz_product_competitor") {
        return mcpResponse({
          records: [20, 25, 30, 35, 40].map((price, index) => ({
            sku_id: `B00000000${index}`,
            spu_id: `PARENT000${index}`,
            item_title: `Wireless Sports Earbuds Model ${index}`,
            item_link: `https://www.amazon.com.au/dp/B00000000${index}`,
            create_at: "2026-07-16 08:00:00",
            reviews_ratings: String(100 + index),
            reviews_stars: 4.2,
            main_image_url: `https://images.example.com/${index}.jpg`,
            brand_name: "Example",
            selling_price_dig: price,
            cat_name: "In-Ear Headphones",
            cat_name_paths: "Electronics->Headphones->In-Ear Headphones",
            cat_id_paths: "1->2->3",
            sku_sales_last_30d: String(50 + index)
          }))
        });
      }
      if (request.params.name === "amz_market_price") {
        return mcpResponse([
          {
            labelName: "15-30",
            productCnt: "12",
            totalSoldCnt: "350",
            totalSoldAmt: "8200.50",
            totalSoldCntRatio: 0.42,
            ds: "20260716"
          }
        ]);
      }
      throw new Error("Unexpected tool");
    });

    const result = await analyzeAmazonAuMarket({
      product,
      env: {
        PROBOOST_MCP_URL: "https://mcp.example.com/amazon",
        PROBOOST_MCP_SECRET_KEY: "test-secret"
      },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      source: "proboost-amazon-au",
      marketplace: "Amazon Australia",
      query: "wireless sports earbuds",
      confidence: "high",
      categoryName: "Electronics->Headphones->In-Ear Headphones",
      categoryPath: "1->2->3",
      currentRrpAud: 27,
      competitorCount: 5,
      priceMinimumAud: 20,
      priceMedianAud: 30,
      priceMaximumAud: 40,
      priceAdvantagePercent: 10,
      pricePosition: "moderate_advantage",
      suggestedRrpMinimumAud: 25.5,
      suggestedRrpMaximumAud: 28.5,
      sampledMonthlySales: 260,
      snapshotDate: "2026-07-16"
    });
    expect(result.priceBands).toEqual([{
      label: "15-30",
      productCount: 12,
      monthlySales: 350,
      revenueAud: 8200.5,
      salesShare: 42
    }]);
    expect(result.competitors).toHaveLength(5);

    const firstRequest = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(firstRequest).toMatchObject({
      method: "tools/call",
      params: {
        name: "amz_product_competitor",
        arguments: { webSiteId: "12", matchType: 1 }
      }
    });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("secret-key")).toBe("test-secret");
  });

  test("returns competitor pricing when the optional category price-band call fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.params.name === "amz_product_competitor") {
        return mcpResponse({
          records: [20, 25, 30].map((price, index) => ({
            sku_id: `B00000000${index}`,
            item_title: `Wireless Sports Earbuds ${index}`,
            item_link: `https://www.amazon.com.au/dp/B00000000${index}`,
            selling_price_dig: price,
            cat_id_paths: "1->2->3"
          }))
        });
      }
      return new Response("upstream unavailable", { status: 503 });
    });

    const result = await analyzeAmazonAuMarket({
      product,
      env: {
        PROBOOST_MCP_URL: "https://mcp.example.com/amazon",
        PROBOOST_MCP_SECRET_KEY: "test-secret"
      },
      fetcher
    });

    expect(result.priceMedianAud).toBe(25);
    expect(result.priceBands).toEqual([]);
    expect(result.notes[0]).toMatch(/price bands were unavailable/i);
  });

  test("fails safely when the production MCP configuration is absent", async () => {
    await expect(analyzeAmazonAuMarket({ product, env: {} })).rejects.toEqual(
      expect.objectContaining<Partial<ProboostMarketError>>({
        status: 503,
        message: "ProBoost Amazon market analysis is not configured"
      })
    );
  });
});

function mcpResponse(data: unknown): Response {
  const toolPayload = JSON.stringify({
    success: true,
    errCode: null,
    errMessage: null,
    data
  });
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: "test",
    result: {
      content: [{
        type: "text",
        text: `# 响应数据（JSON）\n${JSON.stringify(toolPayload)}`
      }],
      isError: false
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
