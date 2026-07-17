import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PRODUCT_IMAGE_ROLES, type DszProductFields } from "../shared/product";
import {
  deleteProductWorkspace,
  findDuplicateUpload,
  loadProductSourceFiles,
  loadProductStudioState,
  loadProductWorkspace,
  loadUploadHistory,
  REFRESH_INTERRUPTED_ERROR,
  saveProductSourceFiles,
  saveProductStudioState,
  saveProductWorkspace,
  saveUploadHistory,
  type ProductWorkspaceSnapshot,
  type UploadHistoryEntry
} from "../src/workspaceStorage";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
});

describe("workspace persistence", () => {
  test("restores the product queue and repairs its active and next job metadata", () => {
    saveProductStudioState({
      version: 1,
      jobs: [{ id: "product-2", number: 2 }, { id: "product-7", number: 7, name: "Folder item" }],
      activeJobId: "missing",
      nextJobNumber: 3
    });

    expect(loadProductStudioState()).toEqual({
      version: 1,
      jobs: [{ id: "product-2", number: 2 }, { id: "product-7", number: 7, name: "Folder item" }],
      activeJobId: "product-2",
      nextJobNumber: 8
    });
  });

  test("turns interrupted requests into retryable errors while preserving completed images", () => {
    const snapshot = workspaceSnapshot();
    snapshot.copyTask = { status: "loading", error: "" };
    snapshot.imageRoles.main = { status: "success", error: "", imageUrl: "https://cdn.example.com/main.png" };
    snapshot.imageRoles.side = { status: "loading", error: "", imageUrl: "" };
    snapshot.uploadStatus = "loading";
    saveProductWorkspace(snapshot);

    const restored = loadProductWorkspace("product-1");

    expect(restored?.copyTask).toEqual({ status: "error", error: REFRESH_INTERRUPTED_ERROR });
    expect(restored?.imageRoles.main).toEqual(snapshot.imageRoles.main);
    expect(restored?.imageRoles.side).toEqual({
      status: "error",
      error: REFRESH_INTERRUPTED_ERROR,
      imageUrl: ""
    });
    expect(restored?.uploadStatus).toBe("error");
  });

  test("stores source files in IndexedDB and removes them with the workspace", async () => {
    const source = new File(["image"], "source.png", { type: "image/png" });
    await saveProductSourceFiles("product-1", [source]);

    const restored = await loadProductSourceFiles("product-1");
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("source.png");

    saveProductWorkspace(workspaceSnapshot());
    await deleteProductWorkspace("product-1");
    expect(loadProductWorkspace("product-1")).toBeNull();
    expect(await loadProductSourceFiles("product-1")).toEqual([]);
  });
});

describe("upload history", () => {
  test("persists history and finds duplicate SKU or EAN values", () => {
    const entry: UploadHistoryEntry = {
      id: "history-1",
      jobId: "product-1",
      productName: "Saved product",
      sku: "Elosung10001",
      eanCode: "1234567890",
      uploadedAt: "2026-07-17T08:00:00.000Z",
      result: { id: 42 }
    };
    saveUploadHistory([entry]);

    expect(loadUploadHistory()).toEqual([entry]);
    expect(findDuplicateUpload([entry], "elosung10001", "")).toEqual(entry);
    expect(findDuplicateUpload([entry], "", "1234567890")).toEqual(entry);
    expect(findDuplicateUpload([entry], "Elosung99999", "9999999999")).toBeUndefined();
  });
});

function workspaceSnapshot(): ProductWorkspaceSnapshot {
  return {
    version: 1,
    jobId: "product-1",
    updatedAt: "2026-07-17T08:00:00.000Z",
    sourceFileCount: 0,
    sourceFileNames: [],
    sellingPoints: "Soft cotton",
    optionalInputs: { categoryHint: "Underwear", purchasePriceCny: "10" },
    fields: {} as DszProductFields,
    copyTask: { status: "success", error: "" },
    uploadSourceTask: { status: "success", error: "" },
    imageRoles: Object.fromEntries(PRODUCT_IMAGE_ROLES.map((role) => [
      role,
      { status: "idle", error: "", imageUrl: "" }
    ])) as ProductWorkspaceSnapshot["imageRoles"],
    uploadStatus: "idle",
    message: "Saved",
    uploadResult: null,
    activeTab: "details",
    researchEvidence: null,
    researchIssues: [],
    manualFields: [],
    fieldEditVersions: {} as ProductWorkspaceSnapshot["fieldEditVersions"]
  };
}
