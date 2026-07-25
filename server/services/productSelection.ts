import type {
  ProductSelectionCandidate,
  ProductSelectionInput,
  ProductSelectionResult
} from "../../shared/product.js";
import {
  createNewtonSourcingTask,
  NewtonCloudError
} from "./newtonCloud.js";

const AMAZON_AU_SITE_ID = "12";
const DEFAULT_TIKTOK_REGION = "美国";
const MCP_TIMEOUT_MS = 25_000;
const MAX_RESULTS_PER_SOURCE = 6;
const TIKTOK_CANDIDATE_POOL_SIZE = 30;
const MAX_NEWTON_CANDIDATES = 5;

type Fetcher = typeof fetch;

interface McpConfig {
  url: string;
  secret: string;
}

interface CategoryNode {
  catId: string;
  catName: string;
  catCnName: string;
  path: string;
  depth: number;
}

const tiktokCategoryCache = new Map<string, {
  expiresAt: number;
  nodes: CategoryNode[];
}>();

export class ProductSelectionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProductSelectionError";
  }
}

export async function selectProductsByCategory(input: {
  selection: ProductSelectionInput;
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  createSourcingTask?: (selection: {
    category: string;
    candidates: ProductSelectionCandidate[];
  }) => Promise<{ taskId: string }>;
}): Promise<ProductSelectionResult> {
  const env = input.env || process.env;
  const fetcher = input.fetcher || fetch;
  const category = normalizeCategory(input.selection.category);
  if (!category) {
    throw new ProductSelectionError("选品品类不能为空", 400);
  }

  const amazonConfig = resolveMcpConfig(env, "AMAZON");
  const tiktokConfig = resolveMcpConfig(env, "TIKTOK");
  if (!amazonConfig && !tiktokConfig) {
    throw new ProductSelectionError("ProBoost 选品服务尚未配置", 503);
  }

  const tiktokRegion = env.PROBOOST_TIKTOK_COUNTRY_REGION?.trim() ||
    DEFAULT_TIKTOK_REGION;
  const amazonSearchCategory = toAmazonSearchCategory(category);
  const notes: string[] = [];
  const [amazonOutcome, tiktokOutcome] = await Promise.allSettled([
    amazonConfig
      ? loadAmazonCandidates({
          category: amazonSearchCategory,
          config: amazonConfig,
          fetcher
        })
      : Promise.resolve([]),
    tiktokConfig
      ? loadTiktokCandidates({
          category,
          countryRegion: tiktokRegion,
          config: tiktokConfig,
          fetcher
        })
      : Promise.resolve([])
  ]);

  const amazon = amazonOutcome.status === "fulfilled" ? amazonOutcome.value : [];
  const tiktok = tiktokOutcome.status === "fulfilled" ? tiktokOutcome.value : [];
  if (!amazonConfig) notes.push("Amazon ProBoost MCP 尚未配置。");
  else if (amazonOutcome.status === "rejected") {
    notes.push("Amazon Australia 热卖数据暂时不可用。");
  }
  if (!tiktokConfig) notes.push("TikTok ProBoost MCP 尚未配置。");
  else if (tiktokOutcome.status === "rejected") {
    notes.push("TikTok 热卖数据暂时不可用。");
  }
  if (
    amazonOutcome.status === "rejected" &&
    tiktokOutcome.status === "rejected"
  ) {
    throw new ProductSelectionError(
      "ProBoost 选品服务暂时不可用",
      502
    );
  }

  const candidates = interleaveCandidates(amazon, tiktok)
    .slice(0, MAX_NEWTON_CANDIDATES);
  let sourcingTaskId = "";
  let sourcingStatus: ProductSelectionResult["sourcingStatus"] = "unavailable";
  if (candidates.length === 0) {
    notes.push("当前没有可供牛顿匹配的热卖候选款。");
  } else {
    try {
      const task = input.createSourcingTask
        ? await input.createSourcingTask({ category, candidates })
        : await createNewtonSourcingTask({ category, candidates, env });
      sourcingTaskId = task.taskId;
      sourcingStatus = "pending";
    } catch (error) {
      if (error instanceof NewtonCloudError) {
        if (error.status === 503) {
          notes.push("牛顿 Agent 尚未配置，因此没有生成 1688 链接。");
        } else {
          sourcingStatus = "error";
          notes.push(error.safeMessage);
        }
      } else {
        sourcingStatus = "error";
        notes.push("牛顿 Agent 货源推荐暂时不可用。");
      }
    }
  }

  return {
    category,
    generatedAt: new Date().toISOString(),
    amazonMarketplace: "Amazon Australia",
    tiktokMarketplace: `TikTok ${tiktokRegion}`,
    amazon,
    tiktok,
    sourcingTaskId,
    sourcingStatus,
    notes
  };
}

async function loadAmazonCandidates(input: {
  category: string;
  config: McpConfig;
  fetcher: Fetcher;
}): Promise<ProductSelectionCandidate[]> {
  try {
    const treeData = await callMcpTool({
      config: input.config,
      fetcher: input.fetcher,
      name: "amz_hot_amz_hot_cat_tree",
      arguments: {
        keyword: input.category,
        rankType: "Best Seller",
        webSiteId: AMAZON_AU_SITE_ID
      }
    });
    const categoryNode = bestCategoryNode(
      flattenCategoryTree(treeData),
      input.category
    );
    if (categoryNode) {
      const listData = await callMcpTool({
        config: input.config,
        fetcher: input.fetcher,
        name: "amz_hot_amz_hot_list",
        arguments: {
          catId: categoryNode.catId,
          currentPage: 1,
          pageSize: MAX_RESULTS_PER_SOURCE,
          rankType: "Best Seller",
          webSiteId: AMAZON_AU_SITE_ID
        }
      });
      const candidates = toAmazonCandidates(
        listRecords(listData),
        categoryNode.path
      );
      if (candidates.length > 0) return candidates;
    }
  } catch {
    // The category hot list is not available for every query; use sales-ranked
    // Amazon Australia competitors as the bounded fallback.
  }

  const fallbackData = await callMcpTool({
    config: input.config,
    fetcher: input.fetcher,
    name: "amz_product_competitor",
    arguments: {
      webSiteId: AMAZON_AU_SITE_ID,
      keyword: input.category,
      matchType: 1,
      page: 1,
      size: MAX_RESULTS_PER_SOURCE,
      "order.field": "total_units",
      "order.desc": true
    }
  });
  return toAmazonCandidates(listRecords(fallbackData), input.category);
}

async function loadTiktokCandidates(input: {
  category: string;
  countryRegion: string;
  config: McpConfig;
  fetcher: Fetcher;
}): Promise<ProductSelectionCandidate[]> {
  const nodes = await loadTiktokCategoryNodes(input.config, input.fetcher);
  const categoryNode = bestCategoryNode(nodes, input.category);
  const listData = await callMcpTool({
    config: input.config,
    fetcher: input.fetcher,
    name: "tt_commodity_info_list",
    arguments: {
      ...(categoryNode
        ? { commodityCatId: categoryNode.catId }
        : { commodityCategory: input.category }),
      countryRegion: input.countryRegion,
      current: 1,
      size: TIKTOK_CANDIDATE_POOL_SIZE,
      dataPeriod: "last30d",
      orderType: "totalSalesNumberDesc"
    }
  });
  return toTiktokCandidates(
    listRecords(listData),
    categoryNode?.path || input.category
  );
}

async function loadTiktokCategoryNodes(
  config: McpConfig,
  fetcher: Fetcher
): Promise<CategoryNode[]> {
  const cached = tiktokCategoryCache.get(config.url);
  if (cached && cached.expiresAt > Date.now()) return cached.nodes;
  const data = await callMcpTool({
    config,
    fetcher,
    name: "tt_commodity_get_commodity_cat_tree",
    arguments: {}
  });
  const nodes = flattenCategoryTree(data);
  tiktokCategoryCache.set(config.url, {
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    nodes
  });
  return nodes;
}

function resolveMcpConfig(
  env: Record<string, string | undefined>,
  source: "AMAZON" | "TIKTOK"
): McpConfig | null {
  const url = env[`PROBOOST_${source}_MCP_URL`]?.trim() ||
    env.PROBOOST_MCP_URL?.trim() || "";
  const secret = env[`PROBOOST_${source}_MCP_SECRET_KEY`]?.trim() ||
    env.PROBOOST_MCP_SECRET_KEY?.trim() || "";
  if (!url || !secret || !isHttpUrl(url)) return null;
  return { url, secret };
}

async function callMcpTool(input: {
  config: McpConfig;
  fetcher: Fetcher;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await input.fetcher(input.config.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "secret-key": input.config.secret
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method: "tools/call",
        params: { name: input.name, arguments: input.arguments }
      }),
      signal: controller.signal
    });
  } catch {
    throw new ProductSelectionError(
      "ProBoost 选品服务暂时不可用",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ProductSelectionError(
      "ProBoost 选品服务暂时不可用",
      502
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new ProductSelectionError("ProBoost 返回了无效选品数据", 502);
  }
  if (!isRecord(payload) || isRecord(payload.error) || !isRecord(payload.result)) {
    throw new ProductSelectionError("ProBoost 返回了无效选品数据", 502);
  }
  const result = payload.result;
  if (result.isError === true || !Array.isArray(result.content)) {
    throw new ProductSelectionError("ProBoost 选品查询失败", 502);
  }
  const text = result.content
    .filter(isRecord)
    .map((item) => item.type === "text" ? stringValue(item.text) : "")
    .filter(Boolean)
    .join("\n");
  const parsed = parseMcpResponse(text);
  if (!isRecord(parsed) || parsed.success !== true) {
    throw new ProductSelectionError("ProBoost 选品查询失败", 502);
  }
  return parsed.data;
}

function parseMcpResponse(text: string): unknown {
  const marker = "# 响应数据（JSON）";
  const block = (
    text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length) : text
  ).trim();
  try {
    const once: unknown = JSON.parse(block);
    return typeof once === "string" ? JSON.parse(once) : once;
  } catch {
    throw new ProductSelectionError("ProBoost 返回了无效选品数据", 502);
  }
}

function flattenCategoryTree(value: unknown): CategoryNode[] {
  const roots = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.records)
      ? value.records
      : [];
  const result: CategoryNode[] = [];

  function visit(node: unknown, parentPath: string, depth: number) {
    if (!isRecord(node)) return;
    const catId = firstString(node, ["catId", "cat_id", "id"]);
    const catName = firstString(node, ["catName", "cat_name", "name"]);
    const catCnName = firstString(node, ["catCnName", "cat_cn_name"]);
    const label = catName || catCnName;
    if (!catId || !label) return;
    const path = parentPath ? `${parentPath} / ${label}` : label;
    result.push({ catId, catName, catCnName, path, depth });
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => visit(child, path, depth + 1));
    }
  }

  roots.forEach((root) => visit(root, "", 0));
  return result;
}

function bestCategoryNode(
  nodes: CategoryNode[],
  category: string
): CategoryNode | undefined {
  const query = normalizedSearchText(category);
  const queryTokens = searchTokens(query);
  if (!query) return undefined;
  return nodes
    .map((node) => {
      const names = [node.catName, node.catCnName, node.path]
        .map(normalizedSearchText)
        .filter(Boolean);
      const exact = names.some((name) => name === query) ? 100 : 0;
      const substring = names.some((name) =>
        name.includes(query) || query.includes(name)
      ) ? 40 : 0;
      const nodeTokens = searchTokens(names.join(" "));
      const overlap = queryTokens.filter((token) =>
        nodeTokens.includes(token)
      ).length;
      const chineseSimilarity = chineseCategorySimilarity(query, names);
      const baseScore = exact + substring + overlap * 12 + chineseSimilarity;
      return {
        node,
        score: baseScore > 0
          ? baseScore - Math.min(node.depth, 5)
          : 0
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.node;
}

function listRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["records", "list", "rows", "items"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

function interleaveCandidates(
  amazon: ProductSelectionCandidate[],
  tiktok: ProductSelectionCandidate[]
): ProductSelectionCandidate[] {
  const candidates: ProductSelectionCandidate[] = [];
  const length = Math.max(amazon.length, tiktok.length);
  for (let index = 0; index < length; index += 1) {
    if (amazon[index]) candidates.push(amazon[index]);
    if (tiktok[index]) candidates.push(tiktok[index]);
  }
  return candidates;
}

function toAmazonCandidates(
  records: Record<string, unknown>[],
  fallbackCategory: string
): ProductSelectionCandidate[] {
  return records
    .map<ProductSelectionCandidate | null>((record, index) => {
      const sourceId = firstString(record, ["sku_id", "skuId", "asin"]);
      const title = firstString(record, ["item_title", "itemTitle", "title"]);
      if (!sourceId || !title) return null;
      return {
        id: `amazon:${sourceId}`,
        source: "amazon",
        sourceId,
        title,
        url: httpsUrl(firstString(record, [
          "item_link",
          "itemLink",
          "url"
        ])) || `https://www.amazon.com.au/dp/${encodeURIComponent(sourceId)}`,
        imageUrl: httpsUrl(firstString(record, [
          "main_image_url",
          "mainImageUrl",
          "imageUrl"
        ])),
        categoryName: firstString(record, [
          "cat_name_paths",
          "catNamePaths",
          "cat_name",
          "catName"
        ]) || fallbackCategory,
        price: nullableNumber(firstValue(record, [
          "selling_price_dig",
          "sellingPrice",
          "price"
        ])),
        currency: "AUD",
        rank: nullableInteger(firstValue(record, [
          "ranking",
          "rank",
          "rankNum"
        ])) || index + 1,
        recentSales: nullableInteger(firstValue(record, [
          "sku_sales_last_30d",
          "skuSalesLast30d",
          "spu_sales_last_30d",
          "soldLast30d",
          "monthlySales"
        ])),
        rating: nullableNumber(firstValue(record, [
          "reviews_stars",
          "reviewsStars",
          "rating"
        ]))
      };
    })
    .filter((candidate): candidate is ProductSelectionCandidate =>
      candidate !== null
    )
    .slice(0, MAX_RESULTS_PER_SOURCE);
}

function toTiktokCandidates(
  records: Record<string, unknown>[],
  fallbackCategory: string
): ProductSelectionCandidate[] {
  return [...records]
    .sort((left, right) =>
      tiktokRecentSales(right) - tiktokRecentSales(left)
    )
    .map<ProductSelectionCandidate | null>((record, index) => {
      const sourceId = firstString(record, [
        "commodityId",
        "commodity_id",
        "productId",
        "id"
      ]);
      const title = firstString(record, [
        "commodityTitle",
        "commodityName",
        "commodity_name",
        "productName",
        "title"
      ]);
      if (!sourceId || !title) return null;
      return {
        id: `tiktok:${sourceId}`,
        source: "tiktok",
        sourceId,
        title,
        url: httpsUrl(firstString(record, [
          "commodityUrl",
          "commodityLink",
          "productUrl",
          "url"
        ])) || `https://www.tiktok.com/shop/pdp/${encodeURIComponent(sourceId)}`,
        imageUrl: httpsUrl(firstString(record, [
          "commodityThumbnailUrl",
          "commodityImageUrl",
          "mainImageUrl",
          "imageUrl",
          "commodityPicture",
          "coverUrl"
        ])),
        categoryName: firstString(record, [
          "commodityCategory",
          "categoryName",
          "catName"
        ]) || fallbackCategory,
        price: nullableNumber(firstValue(record, [
          "commodityPriceMin",
          "commodityPrice",
          "price",
          "sellingPrice"
        ])),
        currency: firstString(record, ["currency", "currencyCode"]) || "USD",
        rank: nullableInteger(firstValue(record, [
          "rank",
          "ranking"
        ])) || index + 1,
        recentSales: nullableInteger(tiktokRecentSales(record)),
        rating: nullableNumber(firstValue(record, [
          "commodityStarRate",
          "score",
          "rating",
          "reviewsStars"
        ]))
      };
    })
    .filter((candidate): candidate is ProductSelectionCandidate =>
      candidate !== null
    )
    .slice(0, MAX_RESULTS_PER_SOURCE);
}

function tiktokRecentSales(record: Record<string, unknown>): number {
  const value = firstValue(record, [
    "salesLst30d",
    "salesLast30d",
    "soldLast30d",
    "sales",
    "totalSalesNumber",
    "saleAmount"
  ]);
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeCategory(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizedSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
    .trim();
}

function searchTokens(value: string): string[] {
  return Array.from(new Set(
    normalizedSearchText(value).split(/\s+/).filter(Boolean)
  ));
}

function chineseCategorySimilarity(query: string, names: string[]): number {
  const queryChinese = query.replace(/[^\u3400-\u9fff]/g, "");
  if (queryChinese.length < 2) return 0;
  const suffix = queryChinese.slice(-2);
  const prefix = queryChinese.slice(0, 2);
  const queryCharacters = Array.from(new Set(queryChinese));
  let best = 0;
  for (const name of names) {
    const nameChinese = name.replace(/[^\u3400-\u9fff]/g, "");
    if (!nameChinese) continue;
    const suffixScore = nameChinese.includes(suffix) ? 50 : 0;
    const prefixScore = nameChinese.includes(prefix) ? 30 : 0;
    const overlap = queryCharacters.filter((character) =>
      nameChinese.includes(character)
    ).length;
    best = Math.max(best, suffixScore + prefixScore + overlap * 4);
  }
  return best;
}

function toAmazonSearchCategory(category: string): string {
  if (!/[\u3400-\u9fff]/.test(category)) return category;
  const terms: Array<[RegExp, string]> = [
    [/厨房/g, " kitchen "],
    [/收纳|储物|置物/g, " storage "],
    [/家居|家庭/g, " home "],
    [/汽车|车载/g, " car "],
    [/宠物/g, " pet "],
    [/婴儿|母婴/g, " baby "],
    [/玩具/g, " toy "],
    [/美妆|美容/g, " beauty "],
    [/女装/g, " women clothing "],
    [/男装/g, " men clothing "],
    [/服装|衣服/g, " clothing "],
    [/鞋/g, " shoes "],
    [/箱包|包袋|背包/g, " bags "],
    [/户外/g, " outdoor "],
    [/花园|园艺/g, " garden "],
    [/工具/g, " tools "],
    [/手机/g, " phone "],
    [/电脑/g, " computer "],
    [/电子/g, " electronics "],
    [/运动|健身/g, " sports "]
  ];
  let translated = category;
  for (const [pattern, replacement] of terms) {
    translated = translated.replace(pattern, replacement);
  }
  const english = translated
    .replace(/[\u3400-\u9fff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return english || category;
}

function firstString(
  value: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const current = stringValue(value[key]);
    if (current) return current;
  }
  return "";
}

function firstValue(
  value: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.round((number + Number.EPSILON) * 100) / 100
    : null;
}

function nullableInteger(value: unknown): number | null {
  const number = nullableNumber(value);
  return number === null ? null : Math.max(1, Math.round(number));
}

function httpsUrl(value: string): string {
  try {
    return new URL(value).protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
