export const MAX_SOURCE_IMAGES = 4;
export const MAX_SOURCE_IMAGE_BATCH_BYTES = 4_000_000;

export interface ProductFolderBatch {
  name: string;
  files: File[];
}

export interface ProductFolderImportResult {
  products: ProductFolderBatch[];
  rejected: Array<{ name: string; reason: string }>;
}

export function groupProductFolderFiles(files: File[]): ProductFolderImportResult {
  const imageFiles = files.filter(isSupportedImage);
  const paths = imageFiles.map((file) => relativeSegments(file));
  const commonRoot = paths.length > 0 && paths.every((segments) =>
    segments.length >= 3 && segments[0] === paths[0][0]
  );
  const groups = new Map<string, File[]>();

  imageFiles.forEach((file, index) => {
    const segments = paths[index];
    const name = commonRoot ? segments[1] : segments[0];
    const groupName = name || `商品 ${groups.size + 1}`;
    groups.set(groupName, [...(groups.get(groupName) || []), file]);
  });

  const products: ProductFolderBatch[] = [];
  const rejected: ProductFolderImportResult["rejected"] = [];
  for (const [name, productFiles] of groups) {
    if (productFiles.length > MAX_SOURCE_IMAGES) {
      rejected.push({ name, reason: `超过 ${MAX_SOURCE_IMAGES} 张图片` });
      continue;
    }
    if (productFiles.reduce((total, file) => total + file.size, 0) > MAX_SOURCE_IMAGE_BATCH_BYTES) {
      rejected.push({ name, reason: "图片总大小超过 4 MB" });
      continue;
    }
    products.push({ name, files: productFiles });
  }

  if (imageFiles.length === 0 && files.length > 0) {
    rejected.push({ name: "所选文件夹", reason: "没有支持的 JPG、PNG 或 WebP 图片" });
  }
  return { products, rejected };
}

function relativeSegments(file: File): string[] {
  const path = file.webkitRelativePath || file.name;
  return path.split("/").filter(Boolean);
}

function isSupportedImage(file: File): boolean {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return true;
  return /\.(?:jpe?g|png|webp)$/i.test(file.name);
}
