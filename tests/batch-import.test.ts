import { describe, expect, test } from "vitest";
import { groupProductFolderFiles } from "../src/batchImport";

describe("product folder import", () => {
  test("uses each first child folder as one product", () => {
    const files = [
      folderFile("batch/Product A/1.png"),
      folderFile("batch/Product A/2.png"),
      folderFile("batch/Product B/1.png")
    ];

    const result = groupProductFolderFiles(files);

    expect(result.rejected).toEqual([]);
    expect(result.products.map((product) => [product.name, product.files.length])).toEqual([
      ["Product A", 2],
      ["Product B", 1]
    ]);
  });

  test("supports selecting one product folder directly", () => {
    const result = groupProductFolderFiles([
      folderFile("Product C/front.jpg", "image/jpeg"),
      folderFile("Product C/side.webp", "image/webp")
    ]);

    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe("Product C");
    expect(result.products[0].files).toHaveLength(2);
  });

  test("rejects product folders that exceed image count or byte limits", () => {
    const tooMany = Array.from({ length: 5 }, (_, index) =>
      folderFile(`batch/Too many/${index}.png`)
    );
    const tooLarge = [
      folderFile("batch/Too large/1.png", "image/png", 2_000_001),
      folderFile("batch/Too large/2.png", "image/png", 2_000_001)
    ];

    const result = groupProductFolderFiles([...tooMany, ...tooLarge]);

    expect(result.products).toEqual([]);
    expect(result.rejected).toEqual([
      { name: "Too many", reason: "超过 4 张图片" },
      { name: "Too large", reason: "图片总大小超过 4 MB" }
    ]);
  });
});

function folderFile(path: string, type = "image/png", size = 1): File {
  const file = new File([new Uint8Array(size)], path.split("/").at(-1) || "image.png", { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
