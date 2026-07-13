export interface PackyResponsesOutput {
  text: string;
  annotatedUrls: string[];
}

export async function readPackyResponses(
  response: Response
): Promise<PackyResponsesOutput> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return {
      text: extractResponsesText(await readJsonResponse(response)) || "",
      annotatedUrls: []
    };
  }

  const deltas: string[] = [];
  const annotatedUrls = new Set<string>();

  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

    let event: unknown;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      throw new Error("Packy Responses API returned an invalid response.");
    }

    if (!isRecord(event)) continue;

    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      deltas.push(event.delta);
    }

    if (
      event.type === "response.output_text.annotation.added" &&
      isRecord(event.annotation) &&
      event.annotation.type === "url_citation" &&
      typeof event.annotation.url === "string" &&
      isHttpsUrl(event.annotation.url)
    ) {
      annotatedUrls.add(event.annotation.url);
    }
  }

  return { text: deltas.join(""), annotatedUrls: Array.from(annotatedUrls) };
}

function extractResponsesText(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.output_text === "string") return data.output_text;
  if (!Array.isArray(data.output)) return undefined;

  for (const output of data.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;

    for (const content of output.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  return undefined;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Packy Responses API returned an invalid response.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
