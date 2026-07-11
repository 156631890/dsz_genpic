import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";
import {
  requestProductCopy,
  uploadSourceImages
} from "../src/productWorkflow";
import { PRODUCT_IMAGE_ROLES, type ProductImageRole } from "../shared/product";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
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
});

describe("App independent AI workflow", () => {
  test("one click starts five role calls before the upload/copy chain finishes", async () => {
    const user = userEvent.setup();
    const upload = deferred<Response>();
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
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

  test("copy success and one image failure retain four images; role retry is isolated", async () => {
    const user = userEvent.setup();
    const roleCounts = new Map<ProductImageRole, number>();
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
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
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(4));
    const detail = screen.getByTestId("image-role-detail");
    expect(detail).toHaveTextContent("detail failed");

    await user.click(within(detail).getByRole("button", { name: "重试" }));
    expect(await within(detail).findByAltText("生成图片 detail")).toBeInTheDocument();
    expect(roleCounts.get("detail")).toBe(2);
    for (const role of PRODUCT_IMAGE_ROLES.filter((item) => item !== "detail")) {
      expect(roleCounts.get(role)).toBe(1);
    }
  });

  test("copy failure preserves manual text; copy retry uploads and copies only", async () => {
    const user = userEvent.setup();
    let copyCalls = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
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
    const title = screen.getByLabelText("标题");
    const description = screen.getByLabelText("HTML Description");
    await user.type(title, "Manual title");
    await user.type(description, "Manual description");
    await fillRequiredInputs(user);
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(5));
    expect(title).toHaveValue("Manual title");
    expect(description).toHaveValue("Manual description");
    const copyStatus = screen.getByTestId("copy-task-status");
    expect(copyStatus).toHaveTextContent("copy failed");

    await user.click(within(copyStatus).getByRole("button", { name: "重试" }));
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
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
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
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
      url === "/api/generate-product-image-role")).toHaveLength(5));

    for (const role of ["lifestyle_2", "detail", "side", "lifestyle_1", "main"] as ProductImageRole[]) {
      pending[role].resolve(response({ role, imageUrl: `https://cdn.example.com/${role}.png` }));
    }
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(5));
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual(
      PRODUCT_IMAGE_ROLES.map((role) => `生成图片 ${role}`)
    );

    await user.click(screen.getByRole("button", { name: "上传到后台" }));
    await waitFor(() => expect(uploadedFields).toBeDefined());
    expect(uploadedFields?.images).toEqual(
      PRODUCT_IMAGE_ROLES.map((role) => `https://cdn.example.com/${role}.png`)
    );
  });

  test("missing source image or selling points makes no network calls", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText("原始产品图片"),
      new File(["image"], "source.png", { type: "image/png" })
    );
    await user.click(screen.getByRole("button", { name: "开始 AI 生成" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("manual package edits recompute CBM and shipping while boolean editing works", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText("Weight kg"));
    await user.type(screen.getByLabelText("Weight kg"), "1");
    await user.clear(screen.getByLabelText("Length cm"));
    await user.type(screen.getByLabelText("Length cm"), "50");
    await user.clear(screen.getByLabelText("Width cm"));
    await user.type(screen.getByLabelText("Width cm"), "40");
    await user.clear(screen.getByLabelText("Height cm"));
    await user.type(screen.getByLabelText("Height cm"), "30");
    await user.click(screen.getByLabelText("Enabled"));

    const payload = screen.getByText((_, element) =>
      element?.tagName === "PRE" && element.textContent?.includes('"cbm": 0.06') === true
    );
    expect(payload).toHaveTextContent('"nz": 40');
    expect(payload).toHaveTextContent('"enabled": false');
  });
});
