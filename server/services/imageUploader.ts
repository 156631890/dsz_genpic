export interface ImgbbUploadRequest {
  url: string;
  headers: Record<string, string>;
}

export function buildImgbbUploadRequest(input: {
  apiKey: string;
  baseUrl?: string;
}): ImgbbUploadRequest {
  const baseUrl = input.baseUrl || "https://api.imgbb.com/1/upload";

  return {
    url: `${baseUrl}?key=${encodeURIComponent(input.apiKey)}`,
    headers: {}
  };
}

export async function uploadImagesToImgbb(input: {
  files: Express.Multer.File[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrls: string[] }> {
  const env = input.env || process.env;
  const apiKey = env.IMGBB_API_KEY;

  if (!apiKey) {
    throw new Error("Missing IMGBB_API_KEY. Image files must be uploaded to URL storage before Dropshipzone submission.");
  }

  const fetcher = input.fetchImpl || fetch;
  const request = buildImgbbUploadRequest({ apiKey });
  const imageUrls: string[] = [];

  for (const file of input.files) {
    const form = new FormData();
    const imageBytes = new Uint8Array(file.buffer);

    form.append(
      "image",
      new Blob([imageBytes], {
        type: file.mimetype || "application/octet-stream"
      }),
      file.originalname || "product-image.png"
    );

    const response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body: form
    });

    if (!response.ok) {
      throw new Error(`ImgBB upload failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: {
        url?: string;
        display_url?: string;
      };
    };
    const url = data.data?.display_url || data.data?.url;

    if (!url) {
      throw new Error("ImgBB upload returned no image URL");
    }

    imageUrls.push(url);
  }

  return { imageUrls };
}
