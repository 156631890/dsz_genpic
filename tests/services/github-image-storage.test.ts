// @vitest-environment node

import { describe, expect, test, vi } from "vitest";
import { uploadImagesToGithub } from "../../server/services/githubImageStorage";

const pngBuffer = Buffer.from("89504e470d0a1a0a", "hex");
const files = [{
  buffer: pngBuffer,
  mimetype: "image/png",
  originalname: "generated.png"
}] as Express.Multer.File[];

const env = {
  GITHUB_IMAGE_TOKEN: "github-token",
  GITHUB_IMAGE_REPOSITORY: "156631890/dsz_genpic",
  GITHUB_IMAGE_BRANCH: "generated-images"
};

describe("GitHub generated image storage", () => {
  test("writes a unique PNG to the configured branch and returns a raw URL", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toMatch(
        /^https:\/\/api\.github\.com\/repos\/156631890\/dsz_genpic\/contents\/generated-images\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/
      );
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer github-token",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        branch: "generated-images",
        content: pngBuffer.toString("base64")
      });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;

    const result = await uploadImagesToGithub({ files, env, fetchImpl });

    expect(result.imageUrls).toHaveLength(1);
    expect(result.imageUrls[0]).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/156631890\/dsz_genpic\/generated-images\/generated-images\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("retries a branch-head conflict three times", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 409 })
    ) as unknown as typeof fetch;

    await expect(
      uploadImagesToGithub({ files, env, fetchImpl })
    ).rejects.toThrow("GitHub image upload failed: 409");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("returns a safe provider error without leaking credentials or response text", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(
        "github-token should never escape",
        { status: 401 }
      )
    ) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await uploadImagesToGithub({ files, env, fetchImpl });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("GitHub image upload failed: 401");
    expect((thrown as Error).message).not.toContain("github-token");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
