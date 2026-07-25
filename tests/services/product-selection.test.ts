// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import {
  ProductSelectionError,
  selectProductsByCategory
} from "../../server/services/productSelection";

describe("product selection", () => {
  test("maps Amazon AU and TikTok recent hot products and starts Newton sourcing", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const params = body.params as {
        name: string;
        arguments: Record<string, unknown>;
      };
      if (params.name === "amz_hot_amz_hot_cat_tree") {
        return mcpResponse([{
          catId: "amazon-kitchen",
          catName: "Kitchen Storage"
        }]);
      }
      if (params.name === "amz_hot_amz_hot_list_v2") {
        return mcpResponse({
          records: [{
            sku_id: "A100",
            item_title: "Airtight Food Storage Container",
            item_link: "https://www.amazon.com.au/dp/A100",
            main_image_url: "https://images.example.com/amazon.jpg",
            cat_name_paths: "Home / Kitchen Storage",
            selling_price_dig: "29.95",
            ranking: "2",
            sku_sales_last_30d: "450",
            reviews_stars: "4.6"
          }]
        });
      }
      if (params.name === "tt_commodity_get_commodity_cat_tree") {
        return mcpResponse([{
          catId: "tt-home",
          catName: "Home Supplies",
          children: [{
            catId: "tt-kitchen",
            catName: "Kitchen Storage"
          }]
        }]);
      }
      if (params.name === "tt_commodity_info_list") {
        return mcpResponse({
          records: [{
            commodityId: "T200",
            commodityName: "Stackable Kitchen Storage Box",
            commodityUrl: "https://www.tiktok.com/shop/pdp/T200",
            commodityImageUrl: "https://images.example.com/tiktok.jpg",
            commodityCategory: "Kitchen Storage",
            price: "19.99",
            currency: "USD",
            totalSalesNumber: "720",
            score: "4.8"
          }]
        });
      }
      throw new Error(`Unexpected request: ${params.name}`);
    });
    const createSourcingTask = vi.fn(async () => ({ taskId: "task-123" }));

    const result = await selectProductsByCategory({
      selection: { category: "  Kitchen   Storage  " },
      env: {
        PROBOOST_AMAZON_MCP_URL: "https://mcp.example.com/amazon",
        PROBOOST_AMAZON_MCP_SECRET_KEY: "amazon-secret",
        PROBOOST_TIKTOK_MCP_URL: "https://mcp.example.com/tiktok",
        PROBOOST_TIKTOK_MCP_SECRET_KEY: "tiktok-secret",
        PROBOOST_TIKTOK_COUNTRY_REGION: "美国"
      },
      fetcher,
      createSourcingTask
    });

    expect(result).toMatchObject({
      category: "Kitchen Storage",
      amazonMarketplace: "Amazon Australia",
      tiktokMarketplace: "TikTok 美国",
      sourcingTaskId: "task-123",
      sourcingStatus: "pending",
      notes: []
    });
    expect(result.amazon).toEqual([
      expect.objectContaining({
        id: "amazon:A100",
        price: 29.95,
        rank: 2,
        recentSales: 450
      })
    ]);
    expect(result.tiktok).toEqual([
      expect.objectContaining({
        id: "tiktok:T200",
        recentSales: 720
      })
    ]);
    expect(createSourcingTask).toHaveBeenCalledWith({
      category: "Kitchen Storage",
      candidates: [...result.amazon, ...result.tiktok]
    });

    const amazonList = requests.find((body) =>
      (body.params as { name?: string })?.name === "amz_hot_amz_hot_list_v2"
    );
    expect((amazonList?.params as {
      arguments: Record<string, unknown>;
    }).arguments).toMatchObject({
      catId: "amazon-kitchen",
      rankType: "Best Seller",
      webSiteId: "12"
    });
    const tiktokList = requests.find((body) =>
      (body.params as { name?: string })?.name === "tt_commodity_info_list"
    );
    expect((tiktokList?.params as {
      arguments: Record<string, unknown>;
    }).arguments).toMatchObject({
      commodityCatId: "tt-kitchen",
      countryRegion: "美国",
      dataPeriod: "last30d",
      orderType: "totalSalesNumberDesc"
    });
  });

  test("returns hot products without fabricating links when Newton is unconfigured", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.params.name === "amz_hot_amz_hot_cat_tree") {
        return mcpResponse([]);
      }
      if (body.params.name === "amz_product_competitor") {
        return mcpResponse({
          records: [{
            sku_id: "A200",
            item_title: "Car Boot Organiser",
            selling_price_dig: 24
          }]
        });
      }
      throw new Error("Unexpected tool");
    });

    const result = await selectProductsByCategory({
      selection: { category: "Car organiser" },
      env: {
        PROBOOST_AMAZON_MCP_URL: "https://mcp.example.com/amazon-only",
        PROBOOST_AMAZON_MCP_SECRET_KEY: "secret"
      },
      fetcher
    });

    expect(result.amazon).toHaveLength(1);
    expect(result.tiktok).toEqual([]);
    expect(result.sourcingTaskId).toBe("");
    expect(result.sourcingStatus).toBe("unavailable");
    expect(result.notes).toEqual(expect.arrayContaining([
      "TikTok ProBoost MCP 尚未配置。",
      "牛顿 Agent 尚未配置，因此没有生成 1688 链接。"
    ]));
  });

  test("fails safely when ProBoost product selection is unconfigured", async () => {
    await expect(selectProductsByCategory({
      selection: { category: "Kitchen Storage" },
      env: {}
    })).rejects.toEqual(expect.objectContaining<Partial<ProductSelectionError>>({
      status: 503,
      message: "ProBoost 选品服务尚未配置"
    }));
  });
});

function mcpResponse(data: unknown): Response {
  const payload = JSON.stringify({
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
        text: `# 响应数据（JSON）\n${payload}`
      }],
      isError: false
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
