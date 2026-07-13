import { randomUUID } from "node:crypto";

const GITHUB_API_VERSION = "2022-11-28";
const MAX_CONFLICT_ATTEMPTS = 3;

export async function uploadImagesToGithub(input: {
  files: Express.Multer.File[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrls: string[] }> {
  const env = input.env || process.env;
  const token = env.GITHUB_IMAGE_TOKEN;
  const repository = env.GITHUB_IMAGE_REPOSITORY;
  const branch = env.GITHUB_IMAGE_BRANCH;

  if (!token || !repository || !branch) {
    throw new Error("GitHub image storage is not configured");
  }

  const repositoryMatch =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!repositoryMatch || !/^[A-Za-z0-9._-]+$/.test(branch)) {
    throw new Error("GitHub image storage configuration is invalid");
  }

  const fetcher = input.fetchImpl || fetch;
  const imageUrls: string[] = [];

  for (const file of input.files) {
    const extension = imageExtension(file.mimetype);
    if (!extension || file.buffer.length === 0) {
      throw new Error("Generated image file is invalid");
    }

    const now = new Date();
    const path = [
      "generated-images",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${randomUUID()}.${extension}`
    ].join("/");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const apiUrl =
      `https://api.github.com/repos/${repositoryMatch[1]}/${repositoryMatch[2]}` +
      `/contents/${encodedPath}`;
    const request = {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Store generated product image ${path}`,
        content: file.buffer.toString("base64"),
        branch
      })
    };

    for (let attempt = 1; attempt <= MAX_CONFLICT_ATTEMPTS; attempt += 1) {
      const response = await fetcher(apiUrl, request);
      if (response.ok) break;

      if (response.status !== 409 || attempt === MAX_CONFLICT_ATTEMPTS) {
        throw new Error(`GitHub image upload failed: ${response.status}`);
      }
    }

    imageUrls.push(
      `https://raw.githubusercontent.com/${repositoryMatch[1]}/` +
      `${repositoryMatch[2]}/${encodeURIComponent(branch)}/${encodedPath}`
    );
  }

  return { imageUrls };
}

function imageExtension(mimetype: string): "png" | "jpg" | "webp" | undefined {
  if (mimetype === "image/png") return "png";
  if (mimetype === "image/jpeg") return "jpg";
  if (mimetype === "image/webp") return "webp";
  return undefined;
}

