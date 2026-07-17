import type {
  AmazonMarketAnalysis,
  AmazonMarketAnalysisInput,
  AmazonMarketCompetitor,
  AmazonMarketPriceBand,
  MarketPricePosition
} from "../../shared/product.js";

const AMAZON_AU_SITE_ID = "12";
const MCP_TIMEOUT_MS = 20_000;
const MAX_COMPETITORS = 10;

type Fetcher = typeof fetch;

interface ProboostConfig {
  url: string;
  secret: string;
}

interface CompetitorRecord {
  web_site?: unknown;
  sku_id?: unknown;
  spu_id?: unknown;
  item_title?: unknown;
  item_link?: unknown;
  create_at?: unknown;
  reviews_ratings?: unknown;
  reviews_stars?: unknown;
  main_image_url?: unknown;
  brand_name?: unknown;
  selling_price_dig?: unknown;
  cat_name?: unknown;
  cat_id_paths?: unknown;
  cat_name_paths?: unknown;
  sku_sales_last_30d?: unknown;
  spu_sales_last_30d?: unknown;
}

interface PriceBandRecord {
  labelName?: unknown;
  productCnt?: unknown;
  totalSoldCnt?: unknown;
  totalSoldAmt?: unknown;
  totalSoldCntRatio?: unknown;
  ds?: unknown;
}

export class ProboostMarketError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProboostMarketError";
  }
}

export async function analyzeAmazonAuMarket(input: {
  product: AmazonMarketAnalysisInput;
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<AmazonMarketAnalysis> {
  const config = resolveProboostConfig(input.env || process.env);
  const fetcher = input.fetcher || fetch;
  const candidates = buildSearchCandidates(input.product);
  let selectedQuery = candidates[0] || input.product.productName.trim();
  let selectedRecords: CompetitorRecord[] = [];

  for (const query of candidates) {
    const data = await callProboostTool({
      config,
      fetcher,
      name: "amz_product_competitor",
      arguments: {
        webSiteId: AMAZON_AU_SITE_ID,
        keyword: query,
        matchType: 1,
        page: 1,
        size: 12,
        "order.field": "total_units",
        "order.desc": true
      }
    });
    const records = competitorRecords(data);
    if (records.length > selectedRecords.length) {
      selectedQuery = query;
      selectedRecords = records;
    }
    if (records.length >= 3) break;
  }

  const competitors = toCompetitors(selectedRecords).slice(0, MAX_COMPETITORS);
  const categoryPath = dominantString(selectedRecords, "cat_id_paths");
  const categoryName = dominantString(selectedRecords, "cat_name_paths") ||
    dominantString(selectedRecords, "cat_name");
  let priceBands: AmazonMarketPriceBand[] = [];
  let snapshotDate = competitorSnapshotDate(selectedRecords);
  const notes: string[] = [];

  if (categoryPath) {
    try {
      const priceData = await callProboostTool({
        config,
        fetcher,
        name: "amz_market_price",
        arguments: {
          marketplace: AMAZON_AU_SITE_ID,
          nodeIdPath: categoryPath,
          topN: 10,
          newProduct: 3
        }
      });
      const rawBands = priceBandRecords(priceData);
      priceBands = rawBands.map(toPriceBand).filter((band) => band.productCount > 0);
      snapshotDate = normalizedDate(stringValue(rawBands[0]?.ds)) || snapshotDate;
    } catch {
      notes.push("Amazon category price bands were unavailable; the comparison uses matched listings only.");
    }
  }

  const prices = competitors.map((item) => item.priceAud).sort((left, right) => left - right);
  const minimum = prices.length ? prices[0] : null;
  const median = prices.length ? medianValue(prices) : null;
  const maximum = prices.length ? prices[prices.length - 1] : null;
  const currentRrp = roundMoney(input.product.currentRrpAud);
  const advantage = median && currentRrp > 0
    ? round(((median - currentRrp) / median) * 100, 1)
    : null;
  const position = pricePosition(advantage);
  const confidence = competitors.length >= 5 && tokenCount(selectedQuery) >= 3
    ? "high"
    : competitors.length >= 3
      ? "medium"
      : "low";

  if (competitors.length === 0) {
    notes.push("No comparable Amazon Australia listings were found for the generated search terms.");
  } else {
    notes.push(
      `Price advantage compares the current RRP with the median of ${competitors.length} matched Amazon Australia listings.`
    );
    notes.push("The suggested range targets 5% to 15% below the matched median and never changes the product RRP automatically.");
  }
  if (confidence === "low" && competitors.length > 0) {
    notes.push("Match confidence is low; review the competitor titles before using the price recommendation.");
  }

  return {
    source: "proboost-amazon-au",
    marketplace: "Amazon Australia",
    query: selectedQuery,
    analyzedAt: new Date().toISOString(),
    snapshotDate,
    confidence,
    categoryName,
    categoryPath,
    currentRrpAud: currentRrp,
    competitorCount: competitors.length,
    priceMinimumAud: minimum === null ? null : roundMoney(minimum),
    priceMedianAud: median === null ? null : roundMoney(median),
    priceMaximumAud: maximum === null ? null : roundMoney(maximum),
    priceAdvantagePercent: advantage,
    pricePosition: position,
    suggestedRrpMinimumAud: median === null ? null : roundMoney(median * 0.85),
    suggestedRrpMaximumAud: median === null ? null : roundMoney(median * 0.95),
    sampledMonthlySales: competitors.reduce(
      (total, item) => total + (item.monthlySales || 0),
      0
    ),
    competitors,
    priceBands,
    notes
  };
}

export function buildSearchCandidates(input: AmazonMarketAnalysisInput): string[] {
  const titlePrefix = input.productName.split(/\s[-|–—]\s/)[0];
  const titleTokens = searchTokens(titlePrefix || input.productName);
  const hintTokens = searchTokens(input.categoryHint || "");
  const categoryLeaf = (input.categoryName || "").split(/[/>]/).pop() || "";
  const categoryTokens = searchTokens(categoryLeaf);
  const sellingPointTokens = searchTokens(input.sellingPoints || "");
  const candidates = [
    titleTokens.slice(0, 4),
    hintTokens.slice(0, 4),
    categoryTokens.slice(0, 4),
    sellingPointTokens.slice(0, 3),
    titleTokens.slice(0, 3),
    titleTokens.slice(0, 2)
  ]
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => tokens.join(" "));
  return Array.from(new Set(candidates)).slice(0, 5);
}

function resolveProboostConfig(env: Record<string, string | undefined>): ProboostConfig {
  const url = env.PROBOOST_MCP_URL?.trim() || "";
  const secret = env.PROBOOST_MCP_SECRET_KEY?.trim() || "";
  if (!url || !secret) {
    throw new ProboostMarketError("ProBoost Amazon market analysis is not configured", 503);
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") throw new Error("unsupported");
  } catch {
    throw new ProboostMarketError("ProBoost Amazon market analysis is not configured", 503);
  }
  return { url, secret };
}

async function callProboostTool(input: {
  config: ProboostConfig;
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
    throw new ProboostMarketError("ProBoost Amazon market analysis is temporarily unavailable", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ProboostMarketError("ProBoost Amazon market analysis is temporarily unavailable", 502);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new ProboostMarketError("ProBoost returned an invalid market response", 502);
  }
  if (!isRecord(payload) || isRecord(payload.error) || !isRecord(payload.result)) {
    throw new ProboostMarketError("ProBoost returned an invalid market response", 502);
  }
  const result = payload.result;
  if (result.isError === true || !Array.isArray(result.content)) {
    throw new ProboostMarketError("ProBoost Amazon market analysis failed", 502);
  }
  const text = result.content
    .filter(isRecord)
    .map((item) => item.type === "text" ? stringValue(item.text) : "")
    .filter(Boolean)
    .join("\n");
  const parsed = parseResponseData(text);
  if (!isRecord(parsed) || parsed.success !== true) {
    throw new ProboostMarketError("ProBoost Amazon market analysis failed", 502);
  }
  return parsed.data;
}

function parseResponseData(text: string): unknown {
  const marker = "# 响应数据（JSON）";
  const block = (text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length) : text).trim();
  try {
    const once: unknown = JSON.parse(block);
    return typeof once === "string" ? JSON.parse(once) : once;
  } catch {
    throw new ProboostMarketError("ProBoost returned an invalid market response", 502);
  }
}

function competitorRecords(value: unknown): CompetitorRecord[] {
  return isRecord(value) && Array.isArray(value.records)
    ? value.records.filter(isRecord) as CompetitorRecord[]
    : [];
}

function priceBandRecords(value: unknown): PriceBandRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) as PriceBandRecord[] : [];
}

function toCompetitors(records: CompetitorRecord[]): AmazonMarketCompetitor[] {
  const byProduct = new Map<string, AmazonMarketCompetitor>();
  for (const record of records) {
    const asin = stringValue(record.sku_id);
    const title = stringValue(record.item_title);
    const price = numberValue(record.selling_price_dig);
    if (!asin || !title || !(price > 0)) continue;
    const key = stringValue(record.spu_id) || asin;
    if (byProduct.has(key)) continue;
    const itemUrl = httpsUrl(stringValue(record.item_link)) ||
      `https://www.amazon.com.au/dp/${encodeURIComponent(asin)}`;
    byProduct.set(key, {
      asin,
      title,
      url: itemUrl,
      imageUrl: httpsUrl(stringValue(record.main_image_url)),
      brand: stringValue(record.brand_name),
      priceAud: roundMoney(price),
      rating: nullableNumber(record.reviews_stars),
      reviews: nullableInteger(record.reviews_ratings),
      monthlySales: nullableInteger(
        record.sku_sales_last_30d ?? record.spu_sales_last_30d
      ),
      categoryName: stringValue(record.cat_name)
    });
  }
  return Array.from(byProduct.values());
}

function toPriceBand(record: PriceBandRecord): AmazonMarketPriceBand {
  return {
    label: stringValue(record.labelName),
    productCount: integerValue(record.productCnt),
    monthlySales: integerValue(record.totalSoldCnt),
    revenueAud: roundMoney(numberValue(record.totalSoldAmt)),
    salesShare: round(numberValue(record.totalSoldCntRatio) * 100, 1)
  };
}

function dominantString(records: CompetitorRecord[], key: keyof CompetitorRecord): string {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = stringValue(record[key]);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || "";
}

function competitorSnapshotDate(records: CompetitorRecord[]): string | null {
  const value = stringValue(records[0]?.create_at).slice(0, 10);
  return normalizedDate(value);
}

function normalizedDate(value: string): string | null {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function pricePosition(advantage: number | null): MarketPricePosition {
  if (advantage === null) return "unavailable";
  if (advantage >= 15) return "strong_advantage";
  if (advantage >= 5) return "moderate_advantage";
  if (advantage >= -5) return "market_aligned";
  return "above_market";
}

const STOP_WORDS = new Set([
  "a", "an", "and", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
  "easy", "everyday", "new", "premium", "practical", "quality", "versatile", "design"
]);

function searchTokens(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z0-9]+/g) || [];
  return Array.from(new Set(
    tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  ));
}

function tokenCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function medianValue(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function integerValue(value: unknown): number {
  return Math.max(0, Math.round(numberValue(value)));
}

function nullableNumber(value: unknown): number | null {
  const number = numberValue(value);
  return number > 0 ? round(number, 1) : null;
}

function nullableInteger(value: unknown): number | null {
  const number = integerValue(value);
  return number > 0 ? number : null;
}

function roundMoney(value: number): number {
  return round(value, 2);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function httpsUrl(value: string): string {
  try {
    return new URL(value).protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
