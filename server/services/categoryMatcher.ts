export interface CategoryEntry {
  id: number;
  name: string;
}

export interface RankedCategory extends CategoryEntry {
  score: number;
  highConfidence: boolean;
}

export interface CategoryResolution {
  category: CategoryEntry;
  source: "manual" | "hint" | "model" | "local" | "default";
  defaulted: boolean;
  invalidManualCategory: boolean;
}

interface ResolveCategoryOptions {
  categoryMapping: string;
  categoryHint?: string;
  fallbackText?: string;
  manualCategoryId?: number;
  generatedCategoryId?: number;
}

const SPELLING_ALIASES: Record<string, string> = {
  jewelry: "jewellery"
};

export function parseCategoryEntries(value: string): CategoryEntry[] {
  const entries: CategoryEntry[] = [];
  const ids = new Set<number>();

  for (const line of value.split(/\r?\n/)) {
    const ordinary = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
    const general = /^\|\s*(General Goods)\s*\|[^|]*\|\s*ID:\s*(\d+)\s*\|$/i
      .exec(line);
    const id = ordinary ? Number(ordinary[2]) : general ? Number(general[2]) : 0;
    const name = ordinary ? ordinary[1].trim() : general ? general[1].trim() : "";

    if (id > 0 && name && !ids.has(id)) {
      ids.add(id);
      entries.push({ id, name });
    }
  }

  return entries;
}

function canonicalToken(value: string): string {
  const aliased = SPELLING_ALIASES[value] || value;
  if (aliased.length > 4 && /ies$/.test(aliased)) {
    return SPELLING_ALIASES[`${aliased.slice(0, -3)}y`] ||
      `${aliased.slice(0, -3)}y`;
  }
  if (aliased.length > 4 && /(sses|shes|ches|xes|zes)$/.test(aliased)) {
    return aliased.slice(0, -2);
  }
  if (aliased.length > 3 && /s$/.test(aliased) && !/(ss|us)$/.test(aliased)) {
    return aliased.slice(0, -1);
  }
  return aliased;
}

function normalizeCategoryText(value: string): string {
  return (value.normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]+/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .match(/[a-z0-9\u00c0-\u024f\u3400-\u9fff]+/gi) || [])
    .map(canonicalToken)
    .join(" ");
}

function categoryOnly(value: CategoryEntry): CategoryEntry {
  return { id: value.id, name: value.name };
}

function scoreCategory(entry: CategoryEntry, query: string): number {
  const normalizedQuery = normalizeCategoryText(query);
  if (!normalizedQuery) return 0;

  const normalizedPath = normalizeCategoryText(entry.name);
  const leaf = entry.name.split("/").at(-1)?.trim() || entry.name;
  const normalizedLeaf = normalizeCategoryText(leaf);
  const queryTokens = normalizedQuery.split(" ");
  const leafTokens = new Set(normalizedLeaf.split(" "));
  const pathTokens = new Set(normalizedPath.split(" "));
  const leafOverlap = queryTokens.filter((token) => leafTokens.has(token)).length;
  const pathOverlap = queryTokens.filter((token) => pathTokens.has(token)).length;
  const depth = entry.name.split("/").length;

  if (normalizedQuery === normalizedLeaf) return 10_000 + depth;
  if (normalizedQuery === normalizedPath) return 9_000 + depth;
  if (normalizedLeaf.includes(normalizedQuery)) return 8_000 + depth;
  if (leafOverlap === queryTokens.length) {
    return 7_000 + leafOverlap * 10 + depth;
  }
  if (pathOverlap === 0) return 0;
  return pathOverlap * 100 + leafOverlap * 50 + depth;
}

export function rankCategoryEntries(
  entries: CategoryEntry[],
  query: string
): RankedCategory[] {
  const ranked = entries
    .map((entry, index) => ({
      ...entry,
      score: scoreCategory(entry, query),
      index
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const secondScore = ranked[1]?.score || 0;

  return ranked.map(({ index: _index, ...entry }, index) => ({
    ...entry,
    highConfidence:
      index === 0 && entry.score >= 7_000 && entry.score > secondScore
  }));
}

export function formatCategoryCandidates(
  categoryMapping: string,
  categoryHint?: string,
  fallbackText?: string
): string {
  const entries = parseCategoryEntries(categoryMapping);
  if (entries.length === 0) {
    throw new Error("Category mapping is unavailable.");
  }

  const query = categoryHint?.trim() || fallbackText?.trim() || "";
  const ranked = rankCategoryEntries(entries, query);
  const candidates = ranked.length > 0
    ? ranked.slice(0, 50)
    : entries;

  return candidates
    .map((entry) => `| ${entry.name} | ${entry.id} |`)
    .join("\n");
}

export function resolveMappedCategory(
  options: ResolveCategoryOptions
): CategoryResolution {
  const entries = parseCategoryEntries(options.categoryMapping);
  if (entries.length === 0) {
    throw new Error("Category mapping is unavailable.");
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const manual = options.manualCategoryId === undefined
    ? undefined
    : byId.get(options.manualCategoryId);
  const invalidManualCategory =
    options.manualCategoryId !== undefined && manual === undefined;
  if (manual) {
    return {
      category: manual,
      source: "manual",
      defaulted: false,
      invalidManualCategory: false
    };
  }

  const categoryHint = options.categoryHint?.trim() || "";
  const query = categoryHint || options.fallbackText?.trim() || "";
  const ranked = rankCategoryEntries(entries, query);
  if (categoryHint && ranked[0]?.highConfidence) {
    return {
      category: categoryOnly(ranked[0]),
      source: "hint",
      defaulted: false,
      invalidManualCategory
    };
  }

  const generated = options.generatedCategoryId === undefined
    ? undefined
    : byId.get(options.generatedCategoryId);
  if (generated) {
    return {
      category: generated,
      source: "model",
      defaulted: false,
      invalidManualCategory
    };
  }

  if (ranked[0]) {
    return {
      category: categoryOnly(ranked[0]),
      source: "local",
      defaulted: false,
      invalidManualCategory
    };
  }

  const general = byId.get(1);
  if (!general) {
    throw new Error("Category mapping is unavailable.");
  }
  return {
    category: general,
    source: "default",
    defaulted: true,
    invalidManualCategory
  };
}
