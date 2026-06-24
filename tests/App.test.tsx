import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  test("renders the new image and selling-points first homepage", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "商品上传工作台" })).toBeInTheDocument();
    expect(screen.getByText("原始产品图片")).toBeInTheDocument();
    expect(screen.getByLabelText("卖点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片并生成字段" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DSZ 生成字段" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "上传预览" })).toBeInTheDocument();
  });

  test("uploads multiple images and displays generated DSZ fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/api/upload-images") {
        return {
          ok: true,
          json: async () => ({
            imageUrls: [
              "https://cdn.example.com/1.jpg",
              "https://cdn.example.com/2.jpg",
              "https://cdn.example.com/3.jpg",
              "https://cdn.example.com/4.jpg"
            ]
          })
        } as Response;
      }

      if (url === "/api/generate-product-fields") {
        return {
          ok: true,
          json: async () => ({
            result: {
              source: "ai",
              fields: {
                category: 947,
                categories: "947",
                categoryName: "Fashion / Women's Fashion / Women's Intimates",
                product_name: "Women Cotton Thong Underwear - Stretch Cotton Blend",
                sku: "Elosung10001",
                status: 1,
                ean_code: "4748549810",
                stock: 1000,
                weight: 0.08,
                length: 15,
                width: 17,
                height: 2,
                cbm: 0.00051,
                brand_name: "Elosung",
                colour: "Black / White / Beige",
                enabled: true,
                description: "<p><strong>Product Overview</strong></p><p>Comfortable daily underwear.</p>",
                vendor_price: 19.74,
                rrp: 39.48,
                zone_rates: { nz: 10 },
                images: [
                  "https://cdn.example.com/1.jpg",
                  "https://cdn.example.com/2.jpg",
                  "https://cdn.example.com/3.jpg",
                  "https://cdn.example.com/4.jpg"
                ],
                risk_flags: [],
                review_notes: []
              }
            }
          })
        } as Response;
      }

      if (url === "/api/generate-main-images") {
        return {
          ok: true,
          json: async () => ({
            imageUrls: [
              "https://cdn.example.com/main-1.png",
              "https://cdn.example.com/main-2.png",
              "https://cdn.example.com/main-3.png",
              "https://cdn.example.com/main-4.png",
              "https://cdn.example.com/main-5.png",
              "https://cdn.example.com/main-6.png"
            ]
          })
        } as Response;
      }

      return { ok: false, json: async () => ({ error: "unexpected" }) } as Response;
    });

    render(<App />);

    await user.upload(screen.getByLabelText("原始产品图片"), [
      new File(["1"], "one.png", { type: "image/png" }),
      new File(["2"], "two.png", { type: "image/png" }),
      new File(["3"], "three.png", { type: "image/png" }),
      new File(["4"], "four.png", { type: "image/png" })
    ]);
    await user.type(screen.getByLabelText("卖点"), "Soft cotton breathable stretch everyday fit");
    await user.click(screen.getByRole("button", { name: "上传图片并生成字段" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Elosung10001")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("947")).toBeInTheDocument();
    expect(screen.getByText("https://cdn.example.com/1.jpg")).toBeInTheDocument();
    expect(screen.getByText("https://cdn.example.com/main-1.png")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload-images",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate-product-fields",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate-main-images",
      expect.objectContaining({ method: "POST" })
    );
  });
});
