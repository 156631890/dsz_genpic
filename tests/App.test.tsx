import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";
import {
  requestProductCopy,
  requestProductImageRole,
  uploadProductFields,
  uploadSourceImages
} from "../src/productWorkflow";
import {
  PRODUCT_IMAGE_ROLES,
  type ProductImageRole,
  type ProductInput
} from "../shared/product";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DSZ product workbench layout", () => {
  test("presents the studio heading, four accessible tabs, and one generation action", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "DSZ Product Studio", level: 1 })).toBeVisible();
    const tabs = within(screen.getByRole("tablist", { name: "Product editor sections" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Details",
      "Price",
      "Shipping (Incl. GST)",
      "Images"
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs.slice(1).every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    expect(screen.getAllByRole("button", { name: "开始 AI 生成" })).toHaveLength(1);
    expect(screen.queryByLabelText("包裹重量 kg")).not.toBeInTheDocument();
  });

  test("moves tab selection and focus with the standard keyboard pattern", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tabs = within(screen.getByRole("tablist", { name: "Product editor sections" })).getAllByRole("tab");

    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(tabs[3]).toHaveFocus();
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tabs[3]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  test("owns the approved details fields and marks only AI-authored fields", () => {
    render(<App />);

    for (const label of [
      "Category", "Product Name", "SKU", "Status", "EAN Code", "Quantity",
      "Package Weight kg", "Length cm", "Width cm", "Height cm", "CBM m3",
      "Brand Name", "Colour", "Enable Product", "Vendor Product Description"
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    const aiFields = document.querySelectorAll('[data-ai-field="true"]');
    expect(Array.from(aiFields, (field) => field.textContent?.trim())).toEqual([
      expect.stringContaining("Product Name"),
      expect.stringContaining("Vendor Product Description")
    ]);
    expect(screen.getByLabelText("Colour").closest("label")).not.toHaveAttribute("data-ai-field");
    expect(screen.getByLabelText("CBM m3")).toHaveAttribute("readonly");
  });

  test("switches tabs and exposes price and approved shipping ownership", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Price" }));
    expect(screen.getByRole("tab", { name: "Price" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Price" })).toBeVisible();
    expect(screen.getByLabelText("Vendor Price")).toBeInTheDocument();
    expect(screen.getByLabelText("Vendor RRP")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Shipping (Incl. GST)" }));
    const panel = screen.getByRole("tabpanel", { name: "Shipping (Incl. GST)" });
    expect(panel).toHaveTextContent("Australian zones");
    expect(panel).toHaveTextContent("Free");
    expect(panel).toHaveTextContent("Below 3 kg");
    expect(panel).toHaveTextContent("AUD 20");
    expect(panel).toHaveTextContent("3 kg and above");
    expect(panel).toHaveTextContent("AUD 40");
    expect(panel).toHaveTextContent("max(actual, L × W × H / 5000)");
    expect(panel).not.toHaveTextContent("166");
  });

  test("keeps five fixed image roles in order with meaningful empty-state labels", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Images" }));
    const cards = within(screen.getByRole("tabpanel", { name: "Images" }))
      .getAllByTestId(/^image-role-/);
    expect(cards.map((card) => card.getAttribute("data-role"))).toEqual(PRODUCT_IMAGE_ROLES);
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Main product image",
      "Side product image",
      "Product detail image",
      "Lifestyle image 1",
      "Lifestyle image 2"
    ]);
  });

  test("preserves decimal edit buffers and commits exact finite values on blur", async () => {
    const user = userEvent.setup();
    render(<App />);

    const weight = screen.getByLabelText("Package Weight kg");
    await user.clear(weight);
    await user.type(weight, "0.5");
    expect(weight).toHaveValue("0.5");

    const length = screen.getByLabelText("Length cm");
    await user.clear(length);
    await user.type(length, "2.75");
    expect(length).toHaveValue("2.75");

    const width = screen.getByLabelText("Width cm");
    await user.clear(width);
    await user.type(width, "12.50");
    expect(width).toHaveValue("12.50");
    const height = screen.getByLabelText("Height cm");
    await user.clear(height);
    await user.type(height, "10");
    await user.tab();

    expect(weight).toHaveValue("0.5");
    expect(length).toHaveValue("2.75");
    expect(width).toHaveValue("12.50");
    expect(screen.getByLabelText("CBM m3")).toHaveValue("0.000344");
  });
});

describe("service health presentation", () => {
  test("shows loading and configured model context", async () => {
    const health = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => health.promise));
    render(<App />);
    expect(screen.getByText("Checking services")).toBeVisible();

    health.resolve(response({
      textConfigured: true,
      imageConfigured: true,
      textModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2"
    }));
    expect(await screen.findByText("AI services configured")).toBeVisible();
    expect(screen.getByText("gpt-5.6-sol · gpt-image-2")).toBeVisible();
  });

  test.each([
    [{ textConfigured: true, imageConfigured: false, textModel: "copy", imageModel: "image" }, "Service setup incomplete"],
    [{ unexpected: true }, "Service status unavailable"]
  ])("renders safe health state for %j", async (payload, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload)));
    render(<App />);
    expect(await screen.findByText(expected)).toBeVisible();
  });

  test("renders unknown state when the health request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider body must stay private")));
    render(<App />);
    expect(await screen.findByText("Service status unavailable")).toBeVisible();
    expect(screen.queryByText("provider body must stay private")).not.toBeInTheDocument();
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

type FetchHandler = (url: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function appFetch(handler: FetchHandler) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (url === "/api/health") return Promise.resolve(response({
      textConfigured: true,
      imageConfigured: true,
      textModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2"
    }));
    return handler(url, init);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fillRequiredInputs(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("原始产品图片"),
    new File(["image"], "source.png", { type: "image/png" })
  );
  await user.type(screen.getByLabelText("卖点"), "Soft breathable cotton stretch");
}

async function fillSubmissionFields(user: ReturnType<typeof userEvent.setup>) {
  const values = [
    ["SKU", "Elosung10001"],
    ["Category", "947"],
    ["EAN Code", "1234567890"],
    ["Package Weight kg", "1"],
    ["Length cm", "10"],
    ["Width cm", "10"],
    ["Height cm", "10"],
    ["Vendor Price", "10"],
    ["Vendor RRP", "20"]
  ] as const;
  for (const [label, value] of values) {
    await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText(label), value);
  }
}

function roleFromRequest(init?: RequestInit): ProductImageRole {
  return String((init?.body as FormData).get("role")) as ProductImageRole;
}

describe("browser product workflow helpers", () => {
  test("uses stable errors when failed responses are non-JSON or empty", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("not json", { status: 502 }))
      .mockResolvedValueOnce(new Response("", { status: 500 })));

    await expect(uploadSourceImages([new File(["x"], "x.png")]))
      .rejects.toThrow("图片上传失败");
    await expect(requestProductCopy({
      sellingPoints: "soft cotton",
      images: ["x.png"],
      imageUrls: ["https://cdn.example.com/x.png"]
    })).rejects.toThrow("商品文案生成失败");
  });

  test.each([
    ["upload", () => uploadSourceImages([new File(["x"], "x.png")])],
    ["copy", () => requestProductCopy({
      sellingPoints: "soft cotton",
      images: ["x.png"],
      imageUrls: ["https://cdn.example.com/x.png"]
    })],
    ["image", () => requestProductImageRole({
      role: "main",
      files: [new File(["x"], "x.png")],
      productType: "Underwear",
      sellingPoints: "soft cotton"
    })]
  ])("rejects malformed 200 responses for %s with a stable error", async (_name, request) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ unexpected: true })));
    await expect(request()).rejects.toThrow(/失败/);
  });

  test("validates HTTPS URLs, matching roles, and forwards AbortSignals", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ imageUrls: ["http://cdn.example.com/x.png"] }))
      .mockResolvedValueOnce(response({ role: "side", imageUrl: "https://cdn.example.com/x.png" }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadSourceImages([new File(["x"], "x.png")], signal))
      .rejects.toThrow("图片上传失败");
    await expect(requestProductImageRole({
      role: "main",
      files: [new File(["x"], "x.png")],
      productType: "Underwear",
      sellingPoints: "soft cotton"
    }, signal)).rejects.toThrow("商品图片生成失败");
    await expect(uploadProductFields({} as never, signal)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal === signal)).toBe(true);
  });

  test("preserves DSZ field validation errors from failed uploads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      errors: ["SKU is invalid", "Five images are required"]
    }, 400)));

    await expect(uploadProductFields({} as never))
      .rejects.toThrow("SKU is invalid；Five images are required");
  });
});

describe("App independent AI workflow", () => {
  test("one click starts five role calls before the upload/copy chain finishes", async () => {
    const user = userEvent.setup();
    const upload = deferred<Response>();
    const fetchMock = appFetch((url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return upload.promise;
      if (url === "/api/generate-product-copy") {
        return Promise.resolve(response({ title: "AI title", description: "AI description" }));
      }
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return Promise.resolve(response({ role, imageUrl: `https://cdn.example.com/${role}.png` }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-image-role"))
        .toHaveLength(5);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/upload-images")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-copy")).toHaveLength(0);

    upload.resolve(response({ imageUrls: ["https://cdn.example.com/source.png"] }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-copy"))
        .toHaveLength(1);
    });
  });

  test("input changes invalidate an active operation and ignore all stale responses", async () => {
    const user = userEvent.setup();
    const upload = deferred<Response>();
    const roles = Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [role, deferred<Response>()])) as
      Record<ProductImageRole, ReturnType<typeof deferred<Response>>>;
    const fetchMock = appFetch((url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return upload.promise;
      if (url === "/api/generate-product-image-role") return roles[roleFromRequest(init)].promise;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await user.type(screen.getByLabelText("卖点"), " changed");
    upload.resolve(response({ imageUrls: ["https://cdn.example.com/stale-source.png"] }));
    for (const role of PRODUCT_IMAGE_ROLES) {
      roles[role].resolve(response({ role, imageUrl: `https://cdn.example.com/stale-${role}.png` }));
    }

    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-copy")).toHaveLength(0);
    expect(screen.queryByText(/stale-/)).not.toBeInTheDocument();
  });

  test.each([
    ["title", true, false],
    ["description", false, true],
    ["both", true, true]
  ] as const)("applies copy fields independently when %s is edited during generation", async (
    _case,
    editTitle,
    editDescription
  ) => {
    const user = userEvent.setup();
    const copy = deferred<Response>();
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return copy.promise;
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getByTestId("copy-task-status")).toHaveTextContent("loading"));
    if (editTitle) await user.type(screen.getByLabelText("Product Name"), "Manual title");
    if (editDescription) await user.type(screen.getByLabelText("Vendor Product Description"), "Manual description");
    copy.resolve(response({ title: "Late title", description: "Late description" }));

    const copyStatus = screen.getByTestId("copy-task-status");
    await waitFor(() => expect(copyStatus).toHaveTextContent(
      editTitle && editDescription ? "error" : "success"
    ));
    expect(screen.getByLabelText("Product Name")).toHaveValue(editTitle ? "Manual title" : "Late title");
    expect(screen.getByLabelText("Vendor Product Description")).toHaveValue(
      editDescription ? "Manual description" : "Late description"
    );
    if (editTitle && editDescription) {
      expect(within(copyStatus).getByRole("button", { name: "重试标题与描述" })).toBeVisible();
    }
  });

  test.each([
    ["类目提示", "Underwear", "all"],
    ["采购价 CNY", "12.50", "copy"],
    ["Package Weight kg", "2", "copy"],
    ["Length cm", "20", "copy"],
    ["Width cm", "15", "copy"],
    ["Height cm", "10", "copy"]
  ] as const)("completed outputs become stale after changing %s", async (label, value, scope) => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);
    await fillRequiredInputs(user);
    await fillSubmissionFields(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "验证并提交审核" })).toBeEnabled());

    const input = screen.getByLabelText(label);
    await user.clear(input);
    await user.type(input, value);
    await user.tab();

    expect(screen.getByRole("button", { name: "验证并提交审核" })).toBeDisabled();
    expect(screen.getByTestId("copy-task-status")).toHaveTextContent("stale");
    expect(screen.getByTestId("copy-task-status")).toHaveTextContent("已过期");
    expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5);
    for (const role of PRODUCT_IMAGE_ROLES) {
      expect(screen.getByTestId(`image-role-${role}`)).toHaveAttribute(
        "data-status",
        scope === "all" ? "stale" : "success"
      );
    }
  });

  test.each(["selling points", "source files"] as const)(
    "completed copy and images become stale after changing %s",
    async (dependency) => {
      const user = userEvent.setup();
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
        if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
        if (url === "/api/generate-product-image-role") {
          const role = roleFromRequest(init);
          return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
        }
        throw new Error(`Unexpected request: ${url}`);
      }));

      render(<App />);
      await fillRequiredInputs(user);
      await fillSubmissionFields(user);
      await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "验证并提交审核" })).toBeEnabled());

      if (dependency === "selling points") {
        await user.type(screen.getByLabelText("卖点"), " changed");
      } else {
        await user.upload(
          screen.getByLabelText("原始产品图片"),
          new File(["replacement"], "replacement.png", { type: "image/png" })
        );
      }

      expect(screen.getByTestId("copy-task-status")).toHaveTextContent("stale");
      expect(screen.getByTestId("copy-task-status")).toHaveTextContent("已过期");
      expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5);
      for (const role of PRODUCT_IMAGE_ROLES) {
        expect(screen.getByTestId(`image-role-${role}`)).toHaveAttribute("data-status", "stale");
      }
      expect(screen.getByRole("button", { name: "验证并提交审核" })).toBeDisabled();
    }
  );

  test("a second run keeps prior role images and replaces only validated successes", async () => {
    const user = userEvent.setup();
    let generation = 1;
    const secondRun = Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [role, deferred<Response>()])) as
      Record<ProductImageRole, ReturnType<typeof deferred<Response>>>;
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: `Title ${generation}`, description: `Description ${generation}` });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return generation === 1
          ? response({ role, imageUrl: `https://cdn.example.com/v1-${role}.png` })
          : secondRun[role].promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);
    await fillRequiredInputs(user);
    await fillSubmissionFields(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));

    generation = 2;
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    expect(screen.getAllByRole("img", { hidden: true }).map((image) => image.getAttribute("src"))).toEqual(
      PRODUCT_IMAGE_ROLES.map((role) => `https://cdn.example.com/v1-${role}.png`)
    );
    for (const role of PRODUCT_IMAGE_ROLES) {
      secondRun[role].resolve(role === "detail"
        ? response({ error: "second detail failed" }, 500)
        : response({ role, imageUrl: `https://cdn.example.com/v2-${role}.png` }));
    }

    const detail = screen.getByTestId("image-role-detail");
    await waitFor(() => expect(detail).toHaveAttribute("data-status", "error"));
    expect(within(detail).getByRole("img", { hidden: true })).toHaveAttribute(
      "src",
      "https://cdn.example.com/v1-detail.png"
    );
    for (const role of PRODUCT_IMAGE_ROLES.filter((item) => item !== "detail")) {
      expect(within(screen.getByTestId(`image-role-${role}`)).getByRole("img", { hidden: true })).toHaveAttribute(
        "src",
        `https://cdn.example.com/v2-${role}.png`
      );
    }
    expect(screen.getByRole("button", { name: "验证并提交审核" })).toBeDisabled();
  });

  test("copy success and one image failure retain four images; role retry is isolated", async () => {
    const user = userEvent.setup();
    const roleCounts = new Map<ProductImageRole, number>();
    const fetchMock = appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") {
        return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      }
      if (url === "/api/generate-product-copy") {
        return response({ title: "Generated title", description: "Generated description" });
      }
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        const count = (roleCounts.get(role) || 0) + 1;
        roleCounts.set(role, count);
        if (role === "detail" && count === 1) return response({ error: "detail failed" }, 502);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

    expect(await screen.findByDisplayValue("Generated title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Generated description")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(4));
    expect(screen.getByText("4 / 5 已完成")).toBeVisible();
    expect(screen.getByText("1 个失败")).toBeVisible();
    expect(screen.queryByText("5 / 5 已完成")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Images" }));
    const detail = screen.getByTestId("image-role-detail");
    expect(detail).toHaveTextContent("detail failed");

    await user.click(within(detail).getByRole("button", { name: "重试图片 detail" }));
    expect(await within(detail).findByAltText("Product detail image generated preview")).toBeInTheDocument();
    expect(roleCounts.get("detail")).toBe(2);
    for (const role of PRODUCT_IMAGE_ROLES.filter((item) => item !== "detail")) {
      expect(roleCounts.get(role)).toBe(1);
    }
  });

  test("copy failure preserves manual text; copy retry uploads and copies only", async () => {
    const user = userEvent.setup();
    let copyCalls = 0;
    const fetchMock = appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") {
        return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      }
      if (url === "/api/generate-product-copy") {
        copyCalls += 1;
        return copyCalls === 1
          ? response({ error: "copy failed" }, 500)
          : response({ title: "Retried title", description: "Retried description" });
      }
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const title = screen.getByLabelText("Product Name");
    const description = screen.getByLabelText("Vendor Product Description");
    await user.type(title, "Manual title");
    await user.type(description, "Manual description");
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
    expect(title).toHaveValue("Manual title");
    expect(description).toHaveValue("Manual description");
    const copyStatus = screen.getByTestId("copy-task-status");
    expect(copyStatus).toHaveTextContent("copy failed");

    await user.click(within(copyStatus).getByRole("button", { name: "重试标题与描述" }));
    expect(await screen.findByDisplayValue("Retried title")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/upload-images")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-copy")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/generate-product-image-role"))
      .toHaveLength(5);
  });

  test("out-of-order image completion renders and uploads strict role order", async () => {
    const user = userEvent.setup();
    const pending = Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [role, deferred<Response>()])) as
      Record<ProductImageRole, ReturnType<typeof deferred<Response>>>;
    let uploadedFields: { images: string[] } | undefined;
    const fetchMock = appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") return pending[roleFromRequest(init)].promise;
      if (url === "/api/upload-product") {
        uploadedFields = JSON.parse(String(init?.body)).fields;
        return response({ mode: "mock" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await fillRequiredInputs(user);
    await fillSubmissionFields(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
      url === "/api/generate-product-image-role")).toHaveLength(5));

    for (const role of ["lifestyle_2", "detail", "side", "lifestyle_1", "main"] as ProductImageRole[]) {
      pending[role].resolve(response({ role, imageUrl: `https://cdn.example.com/${role}.png` }));
    }
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
    expect(screen.getAllByRole("img", { hidden: true }).map((image) => image.getAttribute("alt"))).toEqual([
      "Main product image generated preview",
      "Side product image generated preview",
      "Product detail image generated preview",
      "Lifestyle image 1 generated preview",
      "Lifestyle image 2 generated preview"
    ]);

    await user.click(screen.getByRole("button", { name: "验证并提交审核" }));
    await waitFor(() => expect(uploadedFields).toBeDefined());
    expect(uploadedFields?.images).toEqual(
      PRODUCT_IMAGE_ROLES.map((role) => `https://cdn.example.com/${role}.png`)
    );
  });

  test("applies an HTTPS role replacement and uploads it in fixed role order", async () => {
    const user = userEvent.setup();
    let uploadedFields: { images: string[] } | undefined;
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      if (url === "/api/upload-product") {
        uploadedFields = JSON.parse(String(init?.body)).fields;
        return response({ mode: "mock" });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);
    await fillRequiredInputs(user);
    await fillSubmissionFields(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
    await user.click(screen.getByRole("tab", { name: "Images" }));

    const detail = screen.getByTestId("image-role-detail");
    const replacement = "https://operator.example.com/detail-approved.png";
    await user.type(within(detail).getByLabelText("Replacement URL for detail"), replacement);
    await user.click(within(detail).getByRole("button", { name: "应用替换 detail" }));
    expect(within(detail).getByRole("img")).toHaveAttribute("src", replacement);
    expect(detail).toHaveAttribute("data-status", "success");

    await user.click(screen.getByRole("button", { name: "验证并提交审核" }));
    await waitFor(() => expect(uploadedFields).toBeDefined());
    expect(uploadedFields?.images).toEqual(
      PRODUCT_IMAGE_ROLES.map((role) => role === "detail" ? replacement : `https://cdn.example.com/${role}.png`)
    );
  });

  test("rejects a non-HTTPS role replacement without discarding the current preview", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
    await user.click(screen.getByRole("tab", { name: "Images" }));
    const detail = screen.getByTestId("image-role-detail");
    const oldPreview = within(detail).getByRole("img").getAttribute("src");

    await user.type(within(detail).getByLabelText("Replacement URL for detail"), "http://unsafe.example.com/detail.png");
    await user.click(within(detail).getByRole("button", { name: "应用替换 detail" }));
    expect(within(detail).getByRole("alert")).toHaveTextContent("请输入绝对 HTTPS URL");
    expect(within(detail).getByRole("img")).toHaveAttribute("src", oldPreview);
  });

  test("submit remains disabled until all DSZ fields and five role images are ready", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);
    const submit = screen.getByRole("button", { name: "验证并提交审核" });
    expect(submit).toBeDisabled();
    await fillRequiredInputs(user);
    await fillSubmissionFields(user);
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(5));
    expect(submit).toBeEnabled();
  });

  test("copy body uses editable package fields as the measurement source of truth", async () => {
    const user = userEvent.setup();
    let copyBody: ProductInput | undefined;
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") {
        copyBody = JSON.parse(String(init?.body)).input;
        return response({ title: "Title", description: "Description" });
      }
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);
    await fillRequiredInputs(user);
    for (const [label, value] of [["Package Weight kg", "2"], ["Length cm", "30"], ["Width cm", "20"], ["Height cm", "10"]]) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(copyBody).toBeDefined());
    expect(copyBody).toMatchObject({ packageWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 });
  });

  test("category text keeps numeric category metadata synchronized", async () => {
    const user = userEvent.setup();
    render(<App />);
    const categories = screen.getByLabelText("Category");
    await user.type(categories, "947");
    expect(screen.getByText((_, node) => node?.tagName === "PRE" &&
      node.textContent?.includes('"category": 947') === true)).toBeInTheDocument();
    await user.clear(categories);
    expect(screen.getByText((_, node) => node?.tagName === "PRE" &&
      node.textContent?.includes('"category": 0') === true &&
      node.textContent?.includes('"categoryName": ""') === true)).toBeInTheDocument();
  });

  test("derived live summary remains generating during an isolated retry and another pending role", async () => {
    const user = userEvent.setup();
    const detailRetry = deferred<Response>();
    const lifestyle = deferred<Response>();
    let detailCalls = 0;
    vi.stubGlobal("fetch", appFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/upload-images") return response({ imageUrls: ["https://cdn.example.com/source.png"] });
      if (url === "/api/generate-product-copy") return response({ title: "Title", description: "Description" });
      if (url === "/api/generate-product-image-role") {
        const role = roleFromRequest(init);
        if (role === "lifestyle_2") return lifestyle.promise;
        if (role === "detail" && ++detailCalls === 1) return response({ error: "failed" }, 500);
        if (role === "detail") return detailRetry.promise;
        return response({ role, imageUrl: `https://cdn.example.com/${role}.png` });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await user.click(screen.getByRole("tab", { name: "Images" }));
    const detail = await screen.findByTestId("image-role-detail");
    await waitFor(() => expect(within(detail).getByRole("button", { name: "重试图片 detail" })).toBeVisible());
    expect(screen.getByTestId("image-task-status")).toHaveAttribute("data-status", "loading");
    expect(screen.getByTestId("image-task-status")).toHaveTextContent("1 个失败");
    await user.click(within(detail).getByRole("button", { name: "重试图片 detail" }));
    expect(screen.getByRole("status")).toHaveTextContent("生成中");
    detailRetry.resolve(response({ role: "detail", imageUrl: "https://cdn.example.com/detail.png" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("生成中"));
    lifestyle.resolve(response({ role: "lifestyle_2", imageUrl: "https://cdn.example.com/lifestyle_2.png" }));
  });

  test("missing source image or selling points makes no network calls", async () => {
    const user = userEvent.setup();
    const workflowFetch = vi.fn();
    const fetchMock = appFetch(workflowFetch);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    expect(workflowFetch).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText("原始产品图片"),
      new File(["image"], "source.png", { type: "image/png" })
    );
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    expect(workflowFetch).not.toHaveBeenCalled();
  });

  test("manual package edits recompute CBM and shipping while boolean editing works", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText("Package Weight kg"));
    await user.type(screen.getByLabelText("Package Weight kg"), "1");
    await user.clear(screen.getByLabelText("Length cm"));
    await user.type(screen.getByLabelText("Length cm"), "50");
    await user.clear(screen.getByLabelText("Width cm"));
    await user.type(screen.getByLabelText("Width cm"), "40");
    await user.clear(screen.getByLabelText("Height cm"));
    await user.type(screen.getByLabelText("Height cm"), "30");
    await user.click(screen.getByLabelText("Enable Product"));

    const payload = screen.getByText((_, element) =>
      element?.tagName === "PRE" && element.textContent?.includes('"cbm": 0.06') === true
    );
    expect(payload).toHaveTextContent('"nz": 40');
    expect(payload).toHaveTextContent('"enabled": false');
  });
});
