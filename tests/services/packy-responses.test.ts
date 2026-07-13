// @vitest-environment node

import { describe, expect, test } from "vitest";
import { readPackyResponses } from "../../server/services/packyResponses";

function streamResponse(events: unknown[], extraLines: string[] = []): Response {
  return new Response([
    ...events.map((event) => `data: ${JSON.stringify(event)}`),
    ...extraLines,
    "data: [DONE]",
    ""
  ].join("\n\n"), {
    headers: { "content-type": "text/event-stream" }
  });
}

describe("Packy Responses parsing", () => {
  test("joins streamed output text deltas", async () => {
    const response = streamResponse([
      { type: "response.output_text.delta", delta: "First " },
      { type: "response.output_text.delta", delta: "second" }
    ]);

    await expect(readPackyResponses(response)).resolves.toEqual({
      text: "First second",
      annotatedUrls: []
    });
  });

  test("collects unique HTTPS URL citations from streamed annotations", async () => {
    const response = streamResponse([
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "https://example.test/one" }
      },
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "https://example.test/two" }
      },
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "https://example.test/one" }
      }
    ]);

    await expect(readPackyResponses(response)).resolves.toEqual({
      text: "",
      annotatedUrls: [
        "https://example.test/one",
        "https://example.test/two"
      ]
    });
  });

  test("ignores non-HTTPS annotation URLs", async () => {
    const response = streamResponse([
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "http://example.test/insecure" }
      },
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", url: "javascript:alert(1)" }
      },
      {
        type: "response.output_text.annotation.added",
        annotation: { type: "file_citation", url: "https://example.test/file" }
      }
    ]);

    await expect(readPackyResponses(response)).resolves.toEqual({
      text: "",
      annotatedUrls: []
    });
  });

  test("rejects malformed SSE JSON with a safe error", async () => {
    const malformedLine = "data: {upstream-secret";

    try {
      await readPackyResponses(streamResponse([], [malformedLine]));
      throw new Error("Expected malformed SSE JSON to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Packy Responses API returned an invalid response."
      );
      expect((error as Error).message).not.toContain(malformedLine);
    }
  });

  test("reads top-level output_text from a non-stream response", async () => {
    const response = new Response(JSON.stringify({ output_text: "Top-level text" }), {
      headers: { "content-type": "application/json" }
    });

    await expect(readPackyResponses(response)).resolves.toEqual({
      text: "Top-level text",
      annotatedUrls: []
    });
  });

  test("reads nested output text from a non-stream response", async () => {
    const response = new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "Nested text" }]
      }]
    }), {
      headers: { "content-type": "application/json" }
    });

    await expect(readPackyResponses(response)).resolves.toEqual({
      text: "Nested text",
      annotatedUrls: []
    });
  });
});
