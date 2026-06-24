import type { GeneratedCopy, ProductDraft } from "../../shared/product";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildCopyMessages(draft: ProductDraft): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是跨境电商商品文案编辑，只输出可解析 JSON，不要输出 Markdown。"
    },
    {
      role: "user",
      content: [
        "请根据以下商品事实生成中文独立站商品文案。",
        "输出 JSON，字段必须是 title、bullets、description。",
        "title 控制在 35 个中文字符以内，bullets 输出 4 条，description 输出 120-180 字。",
        `SKU: ${draft.sku}`,
        `产品类型: ${draft.productType}`,
        `面料: ${draft.material}`,
        `颜色: ${draft.colors}`,
        `尺码: ${draft.sizes}`,
        `包装: ${draft.packaging}`,
        `重量: ${draft.weight}`,
        `装箱规格: ${draft.cartonSpec}`,
        `卖点: ${draft.sellingPoints}`
      ].join("\n")
    }
  ];
}

export function parseGeneratedCopy(rawContent: string): GeneratedCopy {
  const trimmed = rawContent.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(withoutFence) as Partial<GeneratedCopy>;

  if (
    typeof parsed.title !== "string" ||
    !Array.isArray(parsed.bullets) ||
    !parsed.bullets.every((item) => typeof item === "string") ||
    typeof parsed.description !== "string"
  ) {
    throw new Error("AI 文案返回格式不正确");
  }

  return {
    title: parsed.title,
    bullets: parsed.bullets,
    description: parsed.description
  };
}

export async function generateCopyWithPacky(input: {
  draft: ProductDraft;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<GeneratedCopy> {
  const env = input.env || process.env;
  const apiKey = env.PACKY_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 PACKY_API_KEY，无法生成商品文案");
  }

  const baseUrl = (env.PACKY_BASE_URL || "https://www.packyapi.com").replace(
    /\/+$/,
    ""
  );
  const fetcher = input.fetchImpl || fetch;
  const response = await fetcher(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.PACKY_TEXT_MODEL || "gpt-5-mini",
      messages: buildCopyMessages(input.draft),
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`Packy 文案接口失败：${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Packy 文案接口没有返回内容");
  }

  return parseGeneratedCopy(content);
}
